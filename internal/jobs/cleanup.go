package jobs

import (
	"context"
	"time"

	"gptmail/internal/models"
	"gptmail/internal/scheduler"

	"gorm.io/gorm"
)

const cleanupInterval = 5 * time.Minute

func StartCleanup(ctx context.Context, db *gorm.DB) {
	go scheduler.Every(ctx, "cleanup", cleanupInterval, false, func(context.Context) {
		_ = RunCleanup(db, time.Now())
	})
}

func RunCleanup(db *gorm.DB, now time.Time) error {
	if err := RunPendingDomainCleanup(db, now); err != nil {
		return err
	}
	return RunExpiredMessageCleanup(db, now)
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
