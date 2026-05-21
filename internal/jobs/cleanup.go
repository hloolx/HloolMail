package jobs

import (
	"context"
	"time"

	"gptmail/internal/config"
	"gptmail/internal/models"
	"gptmail/internal/scheduler"
	"gptmail/internal/webhook"

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
	if err := RunPendingDomainCleanupWithDataProtection(db, now, !cfg.DisablePendingDomainDataProtection); err != nil {
		return err
	}
	if err := RunExpiredRegistrationCleanup(db, now); err != nil {
		return err
	}
	if err := RunExpiredMessageCleanup(db, now); err != nil {
		return err
	}
	return RunAuditLogCleanup(db, now, auditRetentionDays(cfg.AuditLogRetentionDays, defaultAuditLogRetentionDays), auditRetentionDays(cfg.AuditActivityRetentionDays, defaultAuditActivityRetentionDays))
}

func RunExpiredRegistrationCleanup(db *gorm.DB, now time.Time) error {
	return db.Transaction(func(tx *gorm.DB) error {
		if tx.Migrator().HasTable(&models.PendingRegistration{}) {
			if err := tx.Where("expires_at < ?", now).Delete(&models.PendingRegistration{}).Error; err != nil {
				return err
			}
		}
		if tx.Migrator().HasTable(&models.RegistrationCaptcha{}) {
			return tx.Where("expires_at < ?", now).Delete(&models.RegistrationCaptcha{}).Error
		}
		return nil
	})
}

func RunExpiredMessageCleanup(db *gorm.DB, now time.Time) error {
	return db.Transaction(func(tx *gorm.DB) error {
		expiredMessages := tx.Model(&models.Message{}).Where("expires_at < ?", now)
		expiredShareLinks := tx.Model(&models.ShareLink{}).Where("resource_type = ? AND message_id IN (?)", models.ShareResourceTypeMessage, expiredMessages.Select("id"))
		if err := webhook.RedactMessageDeliveriesForQuery(tx, expiredMessages, now, webhook.RedactionReasonMessageExpired); err != nil {
			return err
		}
		if err := tx.Where("share_link_id IN (?)", expiredShareLinks.Select("id")).Delete(&models.ShareLinkAccessLog{}).Error; err != nil {
			return err
		}
		if err := tx.Where("resource_type = ? AND message_id IN (?)", models.ShareResourceTypeMessage, expiredMessages.Select("id")).Delete(&models.ShareLink{}).Error; err != nil {
			return err
		}
		if err := tx.Where("message_id IN (?)", expiredMessages.Select("id")).Delete(&models.MessageAttachment{}).Error; err != nil {
			return err
		}
		return tx.Unscoped().Where("expires_at < ?", now).Delete(&models.Message{}).Error
	})
}

func RunPendingDomainCleanup(db *gorm.DB, now time.Time) error {
	return RunPendingDomainCleanupWithDataProtection(db, now, true)
}

func RunPendingDomainCleanupWithDataProtection(db *gorm.DB, now time.Time, protectBusinessData bool) error {
	return db.Transaction(func(tx *gorm.DB) error {
		query := expiredPendingDomainQuery(tx, now)
		if protectBusinessData {
			query = protectDomainsWithBusinessData(query)
		}
		if err := webhook.RedactMessageDeliveriesForDomainQuery(tx, query, now, webhook.RedactionReasonDomainDeleted); err != nil {
			return err
		}
		return query.Delete(&models.Domain{}).Error
	})
}

func expiredPendingDomainQuery(db *gorm.DB, now time.Time) *gorm.DB {
	return db.Where(
		"active = ? AND first_verified_at IS NULL AND pending_delete_at IS NOT NULL AND pending_delete_at < ?",
		true,
		now,
	)
}

func protectDomainsWithBusinessData(query *gorm.DB) *gorm.DB {
	if query.Migrator().HasTable(&models.Mailbox{}) {
		query = query.Where("NOT EXISTS (SELECT 1 FROM mailboxes WHERE mailboxes.domain_id = domains.id)")
	}
	if query.Migrator().HasTable(&models.Message{}) {
		query = query.Where("NOT EXISTS (SELECT 1 FROM messages WHERE messages.domain_id = domains.id OR messages.root_domain = domains.domain)")
	}
	if query.Migrator().HasTable(&models.Notification{}) {
		query = query.Where("NOT EXISTS (SELECT 1 FROM notifications WHERE notifications.domain_id = domains.id)")
	}
	return query
}

func domainExpiredPendingDelete(d models.Domain, now time.Time) bool {
	return d.Active && d.FirstVerifiedAt == nil && d.PendingDeleteAt != nil && d.PendingDeleteAt.Before(now)
}

func domainHasBusinessData(db *gorm.DB, d models.Domain) (bool, error) {
	var count int64
	if db.Migrator().HasTable(&models.Mailbox{}) {
		if err := db.Model(&models.Mailbox{}).Where("domain_id = ?", d.ID).Limit(1).Count(&count).Error; err != nil {
			return false, err
		}
		if count > 0 {
			return true, nil
		}
	}
	if db.Migrator().HasTable(&models.Message{}) {
		if err := db.Model(&models.Message{}).
			Where("domain_id = ? OR root_domain = ?", d.ID, d.Domain).
			Limit(1).
			Count(&count).Error; err != nil {
			return false, err
		}
		if count > 0 {
			return true, nil
		}
	}
	if db.Migrator().HasTable(&models.Notification{}) {
		if err := db.Model(&models.Notification{}).Where("domain_id = ?", d.ID).Limit(1).Count(&count).Error; err != nil {
			return false, err
		}
		return count > 0, nil
	}
	return false, nil
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
