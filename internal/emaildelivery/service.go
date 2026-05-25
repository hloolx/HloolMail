package emaildelivery

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"gptmail/internal/mailer"
	"gptmail/internal/models"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

const (
	DefaultMaxAttempts = 3

	StageQueued    = "queued"
	StagePreparing = "preparing"
	StageSucceeded = "succeeded"
	StageFailed    = "failed"
)

type EnqueueInput struct {
	Purpose      string
	ReferenceID  string
	Recipient    string
	SettingsHash string
	Settings     mailer.Settings
	Message      mailer.Message
	MaxAttempts  int
}

type StageEntry struct {
	At     time.Time `json:"at"`
	Stage  string    `json:"stage"`
	Detail string    `json:"detail,omitempty"`
}

func Enqueue(db *gorm.DB, input EnqueueInput) (*models.EmailDelivery, error) {
	recipient := strings.ToLower(strings.TrimSpace(input.Recipient))
	if recipient == "" {
		return nil, fmt.Errorf("recipient is required")
	}
	message := input.Message
	message.To = recipient
	settingsJSON, err := json.Marshal(input.Settings)
	if err != nil {
		return nil, err
	}
	messageJSON, err := json.Marshal(message)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	maxAttempts := input.MaxAttempts
	if maxAttempts <= 0 {
		maxAttempts = DefaultMaxAttempts
	}
	delivery := &models.EmailDelivery{
		ID:            uuid.NewString(),
		Purpose:       strings.TrimSpace(input.Purpose),
		ReferenceID:   strings.TrimSpace(input.ReferenceID),
		Recipient:     recipient,
		Subject:       strings.TrimSpace(message.Subject),
		MessageJSON:   string(messageJSON),
		SettingsJSON:  string(settingsJSON),
		SettingsHash:  strings.TrimSpace(input.SettingsHash),
		Status:        models.EmailDeliveryStatusPending,
		Stage:         StageQueued,
		MaxAttempts:   maxAttempts,
		NextAttemptAt: ptrTime(now),
		StageLog:      encodeStageLog([]StageEntry{{At: now, Stage: StageQueued, Detail: "delivery queued"}}),
	}
	if err := db.Create(delivery).Error; err != nil {
		return nil, err
	}
	return delivery, nil
}

func DTO(delivery models.EmailDelivery) map[string]any {
	return map[string]any{
		"id":              delivery.ID,
		"purpose":         delivery.Purpose,
		"reference_id":    delivery.ReferenceID,
		"recipient":       delivery.Recipient,
		"subject":         delivery.Subject,
		"status":          delivery.Status,
		"stage":           delivery.Stage,
		"attempt_count":   delivery.AttemptCount,
		"max_attempts":    delivery.MaxAttempts,
		"next_attempt_at": delivery.NextAttemptAt,
		"last_attempt_at": delivery.LastAttemptAt,
		"succeeded_at":    delivery.SucceededAt,
		"error":           delivery.Error,
		"stage_log":       DecodeStageLog(delivery.StageLog),
		"created_at":      delivery.CreatedAt,
		"updated_at":      delivery.UpdatedAt,
	}
}

func PublicDTO(delivery models.EmailDelivery) map[string]any {
	result := map[string]any{
		"id":              delivery.ID,
		"purpose":         delivery.Purpose,
		"status":          delivery.Status,
		"stage":           delivery.Stage,
		"attempt_count":   delivery.AttemptCount,
		"max_attempts":    delivery.MaxAttempts,
		"next_attempt_at": delivery.NextAttemptAt,
		"last_attempt_at": delivery.LastAttemptAt,
		"succeeded_at":    delivery.SucceededAt,
		"created_at":      delivery.CreatedAt,
		"updated_at":      delivery.UpdatedAt,
	}
	if delivery.Status == models.EmailDeliveryStatusFailed {
		result["error"] = "email delivery failed"
	}
	return result
}

func DecodeStageLog(raw string) []StageEntry {
	var entries []StageEntry
	if strings.TrimSpace(raw) == "" {
		return entries
	}
	if err := json.Unmarshal([]byte(raw), &entries); err != nil {
		return nil
	}
	return entries
}

func appendStageLog(raw string, entry StageEntry) string {
	entries := DecodeStageLog(raw)
	entries = append(entries, entry)
	if len(entries) > 40 {
		entries = entries[len(entries)-40:]
	}
	return encodeStageLog(entries)
}

func encodeStageLog(entries []StageEntry) string {
	data, err := json.Marshal(entries)
	if err != nil {
		return "[]"
	}
	return string(data)
}

func ptrTime(t time.Time) *time.Time {
	return &t
}
