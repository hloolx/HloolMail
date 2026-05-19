package httpapi

import (
	"context"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"gptmail/internal/models"

	"gorm.io/gorm"
)

const (
	auditCategorySecurity = "security"
	auditCategoryActivity = "activity"
	auditCategorySystem   = "system"

	auditSeverityInfo     = "info"
	auditSeverityWarning  = "warning"
	auditSeverityCritical = "critical"

	auditBatchSize     = 100
	auditQueueSize     = 4096
	auditFlushInterval = 200 * time.Millisecond
)

type auditProfile struct {
	category   string
	severity   string
	targetType string
}

type AuditLogger struct {
	db      *gorm.DB
	events  chan models.AuditLog
	closing chan struct{}
	done    chan struct{}
	closed  atomic.Bool
	once    sync.Once
}

func NewAuditLogger(db *gorm.DB) *AuditLogger {
	logger := &AuditLogger{
		db:      db,
		events:  make(chan models.AuditLog, auditQueueSize),
		closing: make(chan struct{}),
		done:    make(chan struct{}),
	}
	go logger.run()
	return logger
}

func (l *AuditLogger) Record(log models.AuditLog) {
	if l == nil || l.db == nil {
		return
	}
	if l.closed.Load() {
		l.writeOne(log)
		return
	}
	select {
	case l.events <- log:
	default:
		if auditLogNeedsDurableFallback(log) {
			l.writeOne(log)
		}
	}
}

func (l *AuditLogger) Close(ctx context.Context) error {
	if l == nil {
		return nil
	}
	l.once.Do(func() {
		l.closed.Store(true)
		close(l.closing)
	})
	select {
	case <-l.done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (l *AuditLogger) run() {
	defer close(l.done)
	ticker := time.NewTicker(auditFlushInterval)
	defer ticker.Stop()

	batch := make([]models.AuditLog, 0, auditBatchSize)
	flush := func() {
		if len(batch) == 0 {
			return
		}
		if err := l.db.CreateInBatches(batch, auditBatchSize).Error; err != nil {
			slog.Warn("audit log batch write failed", "error", err, "count", len(batch))
		}
		batch = batch[:0]
	}
	drain := func() {
		for {
			select {
			case event := <-l.events:
				batch = append(batch, event)
				if len(batch) >= auditBatchSize {
					flush()
				}
			default:
				flush()
				return
			}
		}
	}

	for {
		select {
		case event := <-l.events:
			batch = append(batch, event)
			if len(batch) >= auditBatchSize {
				flush()
			}
		case <-ticker.C:
			flush()
		case <-l.closing:
			drain()
			return
		}
	}
}

func (l *AuditLogger) writeOne(log models.AuditLog) {
	if err := l.db.Create(&log).Error; err != nil {
		slog.Warn("audit log write failed", "error", err, "action", log.Action)
	}
}

func (h *Handler) audit(action, actor, target, metadata string) {
	profile := classifyAuditAction(action)
	log := models.AuditLog{
		Category:   profile.category,
		Severity:   profile.severity,
		Action:     strings.TrimSpace(action),
		Actor:      strings.TrimSpace(actor),
		TargetType: profile.targetType,
		TargetID:   auditTargetID(profile.targetType, target),
		Target:     strings.TrimSpace(target),
		Metadata:   strings.TrimSpace(metadata),
		CreatedAt:  time.Now().UTC(),
	}
	if log.Actor == "" {
		log.Actor = "system"
	}
	if h.AuditLogger != nil {
		h.AuditLogger.Record(log)
		return
	}
	if h.DB != nil {
		_ = h.DB.Create(&log).Error
	}
}

func auditLogNeedsDurableFallback(log models.AuditLog) bool {
	return log.Category == auditCategorySecurity || log.Severity == auditSeverityCritical || log.Severity == auditSeverityWarning
}

func classifyAuditAction(action string) auditProfile {
	switch action {
	case "mailbox.create", "mailbox.reuse", "mailbox.delete":
		return auditProfile{category: auditCategoryActivity, severity: auditSeverityInfo, targetType: "mailbox"}
	case "oauth.login", "oauth.bind", "oauth.unbind":
		return auditProfile{category: auditCategoryActivity, severity: auditSeverityInfo, targetType: "oauth_provider"}
	case "domain_check_run.create":
		return auditProfile{category: auditCategorySystem, severity: auditSeverityInfo, targetType: "domain_check_run"}
	case "domain_check_settings.patch":
		return auditProfile{category: auditCategorySecurity, severity: auditSeverityInfo, targetType: "domain_check_settings"}
	case "oauth_provider.patch":
		return auditProfile{category: auditCategorySecurity, severity: auditSeverityWarning, targetType: "oauth_provider"}
	case "api_key.reveal", "api_key.delete":
		return auditProfile{category: auditCategorySecurity, severity: auditSeverityWarning, targetType: "api_key"}
	case "api_key.create", "api_key.patch":
		return auditProfile{category: auditCategorySecurity, severity: auditSeverityInfo, targetType: "api_key"}
	case "user.delete":
		return auditProfile{category: auditCategorySecurity, severity: auditSeverityCritical, targetType: "user"}
	case "user.create", "user.patch":
		return auditProfile{category: auditCategorySecurity, severity: auditSeverityWarning, targetType: "user"}
	case "domain.delete":
		return auditProfile{category: auditCategorySecurity, severity: auditSeverityWarning, targetType: "domain"}
	case "domain.request", "domain.patch":
		return auditProfile{category: auditCategorySecurity, severity: auditSeverityInfo, targetType: "domain"}
	default:
		return auditProfile{category: auditCategorySecurity, severity: auditSeverityInfo, targetType: auditTargetTypeFromAction(action)}
	}
}

func auditTargetTypeFromAction(action string) string {
	prefix, _, ok := strings.Cut(action, ".")
	if !ok {
		return "resource"
	}
	return strings.TrimSpace(prefix)
}

func auditTargetID(targetType, target string) string {
	target = strings.TrimSpace(target)
	if target == "" {
		return ""
	}
	if targetType == "mailbox" || targetType == "domain" || targetType == "oauth_provider" || targetType == "api_key" || targetType == "user" || targetType == "domain_check_run" || targetType == "domain_check_settings" {
		return target
	}
	return target
}
