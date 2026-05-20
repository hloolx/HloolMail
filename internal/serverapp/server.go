package serverapp

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"gptmail/internal/auth"
	"gptmail/internal/config"
	"gptmail/internal/db"
	"gptmail/internal/domain"
	"gptmail/internal/events"
	httpapi "gptmail/internal/http"
	"gptmail/internal/jobs"
	"gptmail/internal/models"
	smtpserver "gptmail/internal/smtp"
	"gptmail/internal/webhook"
)

func RunWithSignals() error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	return Run(ctx)
}

func Run(ctx context.Context) error {
	cfg := config.Load()
	database, err := db.Open(cfg)
	if err != nil {
		return fmt.Errorf("database open failed: %w", err)
	}
	if err := db.AutoMigrate(database); err != nil {
		return fmt.Errorf("database migration failed: %w", err)
	}
	var adminCount int64
	if err := database.Model(&models.User{}).Where("role = ? AND enabled = ?", models.UserRoleAdmin, true).Count(&adminCount).Error; err != nil {
		return fmt.Errorf("install status check failed: %w", err)
	}
	if err := cfg.ValidateSessionSecret(adminCount > 0); err != nil {
		return fmt.Errorf("insecure session configuration: %w", err)
	}

	runCtx, stop := context.WithCancel(ctx)
	defer stop()

	hub := events.NewHub()
	resolver := domain.Resolver{DB: database}
	checker := domain.DNSChecker{DB: database, Config: cfg, ProbeRunner: domain.MiekgDNSProbeRunner{}}
	healthJob := jobs.NewDomainHealthJob(database, checker, hub)

	jobs.StartCleanup(runCtx, database, cfg)
	jobs.StartDomainHealthMonitor(runCtx, healthJob)
	jobs.StartMXAutoRetry(runCtx, checker)
	webhook.Start(runCtx, database, cfg)
	smtpServer := smtpserver.Start(runCtx, smtpserver.Service{
		Config:   cfg,
		DB:       database,
		Resolver: resolver,
		Hub:      hub,
	})
	auditLogger := httpapi.NewAuditLogger(database)

	handler := &httpapi.Handler{
		Config:       cfg,
		DB:           database,
		Resolver:     resolver,
		DNSChecker:   checker,
		APIKeys:      auth.APIKeyService{DB: database},
		Sessions:     auth.NewSessionService(cfg.SessionSecret, database),
		Hub:          hub,
		DomainHealth: healthJob,
		RateLimiter:  httpapi.NewRateLimiter(),
		AuditLogger:  auditLogger,
	}
	server := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           httpapi.NewRouter(handler),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	listenErr := make(chan error, 1)
	go func() {
		slog.Info("http listening", "addr", cfg.HTTPAddr)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("http server stopped", "error", err)
			listenErr <- err
			stop()
			return
		}
		listenErr <- nil
	}()

	var serveErr error
	listenDone := false
	select {
	case serveErr = <-listenErr:
		listenDone = true
	case <-runCtx.Done():
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	var shutdowns sync.WaitGroup
	shutdowns.Add(2)
	go func() {
		defer shutdowns.Done()
		if err := smtpServer.Shutdown(shutdownCtx); err != nil {
			slog.Warn("smtp shutdown failed", "error", err)
		}
	}()
	go func() {
		defer shutdowns.Done()
		if err := server.Shutdown(shutdownCtx); err != nil {
			slog.Warn("http shutdown failed", "error", err)
		}
	}()
	shutdowns.Wait()

	if !listenDone {
		serveErr = <-listenErr
	}

	auditShutdownCtx, cancelAuditShutdown := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelAuditShutdown()
	if err := auditLogger.Close(auditShutdownCtx); err != nil {
		slog.Warn("audit logger shutdown failed", "error", err)
	}
	return serveErr
}
