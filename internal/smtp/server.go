package smtpserver

import (
	"context"
	"log/slog"

	"gptmail/internal/config"
	"gptmail/internal/domain"
	"gptmail/internal/events"

	gosmtp "github.com/emersion/go-smtp"
	"gorm.io/gorm"
)

type Service struct {
	Config   config.Config
	DB       *gorm.DB
	Resolver domain.Resolver
	Hub      *events.Hub
}

func Start(ctx context.Context, service Service) *gosmtp.Server {
	server := gosmtp.NewServer(&Backend{Service: service})
	server.Addr = service.Config.SMTPAddr
	server.Domain = service.Config.MailHostname
	server.MaxMessageBytes = service.Config.MaxMessageBytes
	server.MaxRecipients = 100
	server.AllowInsecureAuth = true

	go func() {
		slog.Info("smtp listening", "addr", server.Addr)
		if err := server.ListenAndServe(); err != nil && ctx.Err() == nil {
			slog.Error("smtp server stopped", "error", err)
		}
	}()
	return server
}
