package webhook

import (
	"encoding/json"
	"time"

	"gptmail/internal/models"

	"gorm.io/gorm"
)

const (
	RedactionReasonMessageDeleted = "message_deleted"
	RedactionReasonMessageExpired = "message_expired"
	RedactionReasonMailboxDeleted = "mailbox_deleted"
	RedactionReasonDomainDeleted  = "domain_deleted"
)

var activeDeliveryStatuses = []string{
	models.WebhookDeliveryStatusPending,
	models.WebhookDeliveryStatusRetry,
	models.WebhookDeliveryStatusDelivering,
}

type redactedPayload struct {
	Redacted       bool   `json:"redacted"`
	RedactedReason string `json:"redacted_reason"`
}

func RedactMessageDeliveriesForQuery(tx *gorm.DB, messageQuery *gorm.DB, now time.Time, reason string) error {
	if tx == nil || messageQuery == nil || !tx.Migrator().HasTable(&models.WebhookDelivery{}) {
		return nil
	}
	messageSubquery := func() *gorm.DB {
		return messageQuery.Session(&gorm.Session{}).Select("id")
	}
	return redactDeliveries(tx, func(query *gorm.DB) *gorm.DB {
		return query.Where("message_id IN (?)", messageSubquery())
	}, now, reason)
}

func RedactMessageDeliveriesForDomainQuery(tx *gorm.DB, domainQuery *gorm.DB, now time.Time, reason string) error {
	if tx == nil || domainQuery == nil || !tx.Migrator().HasTable(&models.WebhookDelivery{}) || !tx.Migrator().HasTable(&models.Message{}) {
		return nil
	}
	domainIDs := domainQuery.Session(&gorm.Session{}).Model(&models.Domain{}).Select("id")
	domainNames := domainQuery.Session(&gorm.Session{}).Model(&models.Domain{}).Select("domain")
	messageQuery := tx.Model(&models.Message{}).
		Where("domain_id IN (?) OR root_domain IN (?)", domainIDs, domainNames)
	return RedactMessageDeliveriesForQuery(tx, messageQuery, now, reason)
}

func RedactMessageDeliveriesByID(tx *gorm.DB, messageID string, now time.Time, reason string) error {
	if tx == nil || messageID == "" || !tx.Migrator().HasTable(&models.WebhookDelivery{}) {
		return nil
	}
	return redactDeliveries(tx, func(query *gorm.DB) *gorm.DB {
		return query.Where("message_id = ?", messageID)
	}, now, reason)
}

func redactDeliveries(tx *gorm.DB, scope func(*gorm.DB) *gorm.DB, now time.Time, reason string) error {
	if now.IsZero() {
		now = time.Now()
	}
	payload := redactedPayloadJSON(reason)
	if err := scope(tx.Model(&models.WebhookDelivery{})).Updates(map[string]any{
		"payload_json":  payload,
		"response_body": "",
	}).Error; err != nil {
		return err
	}
	return scope(tx.Model(&models.WebhookDelivery{})).
		Where("status IN ?", activeDeliveryStatuses).
		Updates(map[string]any{
			"status":          models.WebhookDeliveryStatusFailed,
			"next_attempt_at": nil,
			"locked_at":       nil,
			"locked_by":       "",
			"error":           reason,
			"response_body":   "",
		}).Error
}

func redactedPayloadJSON(reason string) string {
	raw, err := json.Marshal(redactedPayload{
		Redacted:       true,
		RedactedReason: reason,
	})
	if err != nil {
		return `{"redacted":true}`
	}
	return string(raw)
}
