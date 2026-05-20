package webhook

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"gptmail/internal/config"
	"gptmail/internal/messagekit"
	"gptmail/internal/models"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	defaultMaxAttempts = 8
)

type MessageReceivedPayload struct {
	Event   string                              `json:"event"`
	Message messagekit.WebhookMessagePayloadDTO `json:"message"`
}

type TestPayload struct {
	Event      string    `json:"event"`
	EndpointID uint      `json:"endpoint_id"`
	SentAt     time.Time `json:"sent_at"`
}

func EnqueueMessage(db *gorm.DB, cfg config.Config, msg models.Message) error {
	if !cfg.WebhooksEnabled {
		return nil
	}
	owner, exists, err := messagekit.OwnerForMessage(db, msg)
	if err != nil || !exists {
		return err
	}
	var attachments []models.MessageAttachment
	if err := db.Where("message_id = ?", msg.ID).Order("sequence asc").Find(&attachments).Error; err != nil {
		return err
	}
	payload := MessageReceivedPayload{
		Event:   models.WebhookEventMessageReceived,
		Message: messagekit.WebhookMessagePayload(msg, messagekit.AttachmentMetadataDTOs(attachments)),
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	var endpoints []models.WebhookEndpoint
	if err := db.
		Where("owner_id = ? AND enabled = ? AND disabled_at IS NULL", owner.OwnerID, true).
		Order("id asc").
		Find(&endpoints).Error; err != nil {
		return err
	}
	now := time.Now().UTC()
	for _, endpoint := range endpoints {
		if !endpointIncludesEvent(endpoint, models.WebhookEventMessageReceived) || !endpointMatchesOwnerScope(endpoint, owner) {
			continue
		}
		if err := createDelivery(db, endpoint, models.WebhookEventMessageReceived, msg.ID, string(raw), now); err != nil {
			return err
		}
	}
	return nil
}

func EnqueueTestDelivery(db *gorm.DB, endpoint models.WebhookEndpoint, now time.Time) (*models.WebhookDelivery, error) {
	payload := TestPayload{
		Event:      models.WebhookEventEndpointTest,
		EndpointID: endpoint.ID,
		SentAt:     now.UTC(),
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	delivery := &models.WebhookDelivery{
		ID:            uuid.NewString(),
		EndpointID:    endpoint.ID,
		OwnerID:       endpoint.OwnerID,
		EventType:     models.WebhookEventEndpointTest,
		PayloadJSON:   string(raw),
		DedupKey:      fmt.Sprintf("%d:%s:%d", endpoint.ID, models.WebhookEventEndpointTest, now.UnixNano()),
		Status:        models.WebhookDeliveryStatusPending,
		MaxAttempts:   defaultMaxAttempts,
		NextAttemptAt: ptrTime(now.UTC()),
	}
	if err := db.Create(delivery).Error; err != nil {
		return nil, err
	}
	return delivery, nil
}

func createDelivery(db *gorm.DB, endpoint models.WebhookEndpoint, eventType, messageID, payloadJSON string, now time.Time) error {
	delivery := models.WebhookDelivery{
		ID:            uuid.NewString(),
		EndpointID:    endpoint.ID,
		OwnerID:       endpoint.OwnerID,
		EventType:     eventType,
		MessageID:     messageID,
		PayloadJSON:   payloadJSON,
		DedupKey:      fmt.Sprintf("%d:%s:%s", endpoint.ID, eventType, messageID),
		Status:        models.WebhookDeliveryStatusPending,
		MaxAttempts:   defaultMaxAttempts,
		NextAttemptAt: ptrTime(now),
	}
	return db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "dedup_key"}},
		DoNothing: true,
	}).Create(&delivery).Error
}

func endpointMatchesOwnerScope(endpoint models.WebhookEndpoint, owner messagekit.OwnerInfo) bool {
	if endpoint.OwnerID != owner.OwnerID {
		return false
	}
	switch endpoint.Scope {
	case "", models.WebhookScopeAll:
		return true
	case models.WebhookScopeDomain:
		return endpoint.DomainID != nil && owner.DomainID != nil && *endpoint.DomainID == *owner.DomainID
	case models.WebhookScopeMailbox:
		return endpoint.MailboxID != nil && owner.MailboxID != nil && *endpoint.MailboxID == *owner.MailboxID
	default:
		return false
	}
}

func endpointIncludesEvent(endpoint models.WebhookEndpoint, event string) bool {
	events, err := EventsFromJSON(endpoint.EventsJSON)
	if err != nil {
		return false
	}
	for _, candidate := range events {
		if candidate == event {
			return true
		}
	}
	return false
}

func NormalizeEvents(events []string) ([]string, error) {
	if len(events) == 0 {
		return []string{models.WebhookEventMessageReceived}, nil
	}
	seen := map[string]bool{}
	out := make([]string, 0, len(events))
	for _, event := range events {
		switch event {
		case models.WebhookEventMessageReceived:
			if !seen[event] {
				seen[event] = true
				out = append(out, event)
			}
		default:
			return nil, fmt.Errorf("unsupported webhook event %q", event)
		}
	}
	if len(out) == 0 {
		return []string{models.WebhookEventMessageReceived}, nil
	}
	return out, nil
}

func EventsJSON(events []string) (string, error) {
	normalized, err := NormalizeEvents(events)
	if err != nil {
		return "", err
	}
	raw, err := json.Marshal(normalized)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

func EventsFromJSON(raw string) ([]string, error) {
	var events []string
	if raw == "" {
		return []string{models.WebhookEventMessageReceived}, nil
	}
	if err := json.Unmarshal([]byte(raw), &events); err != nil {
		return nil, err
	}
	return NormalizeEvents(events)
}

func ptrTime(t time.Time) *time.Time {
	return &t
}

func CountDue(ctx context.Context, db *gorm.DB, now time.Time) (int64, error) {
	var count int64
	err := db.WithContext(ctx).Model(&models.WebhookDelivery{}).
		Where("status IN ? AND (next_attempt_at IS NULL OR next_attempt_at <= ?)", []string{models.WebhookDeliveryStatusPending, models.WebhookDeliveryStatusRetry}, now).
		Count(&count).Error
	return count, err
}
