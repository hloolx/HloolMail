package jobs

import (
	"context"
	"time"

	"gptmail/internal/config"
	"gptmail/internal/models"
	"gptmail/internal/scheduler"

	"gorm.io/gorm"
)

const cleanupInterval = 5 * time.Minute
const defaultAuditLogRetentionDays = 180
const defaultAuditActivityRetentionDays = 30

func StartCleanup(ctx context.Context, db *gorm.DB, cfg config.Config) {
	go scheduler.Every(ctx, "cleanup", cleanupInterval, false, func(context.Context) {
		_ = RunCleanupWithConfig(db, time.Now(), cfg)
	})
}

func RunCleanup(db *gorm.DB, now time.Time) error {
	return RunCleanupWithConfig(db, now, config.Config{})
}

func RunCleanupWithConfig(db *gorm.DB, now time.Time, cfg config.Config) error {
	if err := RunPendingDomainCleanup(db, now); err != nil {
		return err
	}
	if err := RunExpiredMessageCleanup(db, now); err != nil {
		return err
	}
	return RunAuditLogCleanup(db, now, auditRetentionDays(cfg.AuditLogRetentionDays, defaultAuditLogRetentionDays), auditRetentionDays(cfg.AuditActivityRetentionDays, defaultAuditActivityRetentionDays))
}

func RunExpiredMessageCleanup(db *gorm.DB, now time.Time) error {
	return db.Unscoped().Where("expires_at < ?", now).Delete(&models.Message{}).Error
}

func RunPendingDomainCleanup(db *gorm.DB, now time.Time) error {
	cutoff := now.Add(-models.PendingDomainTTL)
	return db.Where(
		"active = ? AND created_at < ? AND (mx_verified = ? OR (wildcard_requested = ? AND wildcard_enabled = ?))",
		true,
		cutoff,
		false,
		true,
		false,
	).Delete(&models.Domain{}).Error
}

func RunAuditLogCleanup(db *gorm.DB, now time.Time, securityRetentionDays, activityRetentionDays int) error {
	if activityRetentionDays > 0 {
		cutoff := now.AddDate(0, 0, -activityRetentionDays)
		if err := db.Where("category = ? AND created_at < ?", "activity", cutoff).Delete(&models.AuditLog{}).Error; err != nil {
			return err
		}
	}
	if securityRetentionDays > 0 {
		cutoff := now.AddDate(0, 0, -securityRetentionDays)
		return db.Where("(category <> ? OR category = '' OR category IS NULL) AND created_at < ?", "activity", cutoff).Delete(&models.AuditLog{}).Error
	}
	return nil
}

func auditRetentionDays(value, fallback int) int {
	if value < 0 {
		return 0
	}
	if value == 0 {
		return fallback
	}
	return value
}
