package emaildelivery

import (
	"context"
	"encoding/json"
	"errors"
	"math/rand"
	"net"
	"strings"
	"time"

	"gptmail/internal/mailer"
	"gptmail/internal/models"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

var retryDelays = []time.Duration{
	time.Minute,
	5 * time.Minute,
	15 * time.Minute,
	time.Hour,
}

type Sender interface {
	Send(context.Context, mailer.Settings, mailer.Message) error
}

type Worker struct {
	DB        *gorm.DB
	Sender    Sender
	Now       func() time.Time
	LockedBy  string
	MaxBatch  int
	OnSuccess func(context.Context, *gorm.DB, models.EmailDelivery, time.Time) error
}

func NewWorker(db *gorm.DB, sender Sender) *Worker {
	if sender == nil {
		sender = mailer.DefaultSender{}
	}
	return &Worker{
		DB:       db,
		Sender:   sender,
		Now:      func() time.Time { return time.Now().UTC() },
		LockedBy: "email-delivery-worker-" + uuid.NewString(),
		MaxBatch: 5,
	}
}

func Start(ctx context.Context, db *gorm.DB, sender Sender, onSuccess func(context.Context, *gorm.DB, models.EmailDelivery, time.Time) error) {
	worker := NewWorker(db, sender)
	worker.OnSuccess = onSuccess
	go worker.Run(ctx)
}

func (w *Worker) Run(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		_ = w.RunOnce(ctx)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (w *Worker) RunOnce(ctx context.Context) error {
	deliveries, err := w.claimDueDeliveries(ctx)
	if err != nil {
		return err
	}
	for i := range deliveries {
		if err := w.deliver(ctx, &deliveries[i]); err != nil {
			return err
		}
	}
	return nil
}

func (w *Worker) claimDueDeliveries(ctx context.Context) ([]models.EmailDelivery, error) {
	now := w.now()
	staleBefore := now.Add(-10 * time.Minute)
	limit := w.MaxBatch
	if limit <= 0 {
		limit = 5
	}
	var candidates []models.EmailDelivery
	err := w.DB.WithContext(ctx).
		Where("((status IN ? AND (next_attempt_at IS NULL OR next_attempt_at <= ?)) OR (status = ? AND locked_at < ?))",
			[]string{models.EmailDeliveryStatusPending, models.EmailDeliveryStatusRetry},
			now,
			models.EmailDeliveryStatusDelivering,
			staleBefore,
		).
		Order("next_attempt_at asc, created_at asc").
		Limit(limit).
		Find(&candidates).Error
	if err != nil {
		return nil, err
	}
	claimed := make([]models.EmailDelivery, 0, len(candidates))
	for _, candidate := range candidates {
		result := w.DB.WithContext(ctx).Model(&models.EmailDelivery{}).
			Where("id = ? AND ((status IN ? AND (next_attempt_at IS NULL OR next_attempt_at <= ?)) OR (status = ? AND locked_at < ?))",
				candidate.ID,
				[]string{models.EmailDeliveryStatusPending, models.EmailDeliveryStatusRetry},
				now,
				models.EmailDeliveryStatusDelivering,
				staleBefore,
			).
			Updates(map[string]any{
				"status":    models.EmailDeliveryStatusDelivering,
				"stage":     StagePreparing,
				"locked_at": now,
				"locked_by": w.lockedBy(),
			})
		if result.Error != nil {
			return nil, result.Error
		}
		if result.RowsAffected == 0 {
			continue
		}
		var delivery models.EmailDelivery
		if err := w.DB.WithContext(ctx).First(&delivery, "id = ?", candidate.ID).Error; err != nil {
			return nil, err
		}
		claimed = append(claimed, delivery)
	}
	return claimed, nil
}

func (w *Worker) deliver(ctx context.Context, delivery *models.EmailDelivery) error {
	now := w.now()
	var settings mailer.Settings
	if err := json.Unmarshal([]byte(delivery.SettingsJSON), &settings); err != nil {
		return w.finishFailure(ctx, delivery, now, "decode settings: "+err.Error(), false)
	}
	var message mailer.Message
	if err := json.Unmarshal([]byte(delivery.MessageJSON), &message); err != nil {
		return w.finishFailure(ctx, delivery, now, "decode message: "+err.Error(), false)
	}
	attempt := delivery.AttemptCount + 1
	stageLog := appendStageLog(delivery.StageLog, StageEntry{At: now, Stage: StagePreparing, Detail: "delivery attempt started"})
	result := w.DB.WithContext(ctx).Model(&models.EmailDelivery{}).
		Where("id = ? AND status = ? AND locked_by = ?", delivery.ID, models.EmailDeliveryStatusDelivering, delivery.LockedBy).
		Updates(map[string]any{
			"attempt_count":   attempt,
			"last_attempt_at": now,
			"error":           "",
			"stage":           StagePreparing,
			"stage_log":       stageLog,
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return nil
	}
	delivery.AttemptCount = attempt
	delivery.StageLog = stageLog

	stageCtx := mailer.WithStageRecorder(ctx, func(stage, detail string) {
		_ = w.recordStage(context.Background(), delivery.ID, stage, detail)
	})
	err := w.sender().Send(stageCtx, settings, message)
	if err != nil {
		return w.finishFailure(ctx, delivery, now, err.Error(), isRetryableError(err))
	}
	return w.finishSuccess(ctx, delivery, now)
}

func (w *Worker) recordStage(ctx context.Context, id, stage, detail string) error {
	var current models.EmailDelivery
	if err := w.DB.WithContext(ctx).Select("id", "status", "stage_log", "locked_by").First(&current, "id = ?", id).Error; err != nil {
		return err
	}
	if current.Status != models.EmailDeliveryStatusDelivering || current.LockedBy != w.lockedBy() {
		return nil
	}
	return w.DB.WithContext(ctx).Model(&models.EmailDelivery{}).Where("id = ? AND status = ? AND locked_by = ?", id, models.EmailDeliveryStatusDelivering, current.LockedBy).Updates(map[string]any{
		"stage":     stage,
		"stage_log": appendStageLog(current.StageLog, StageEntry{At: w.now(), Stage: stage, Detail: detail}),
	}).Error
}

func (w *Worker) finishSuccess(ctx context.Context, delivery *models.EmailDelivery, now time.Time) error {
	return w.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var current models.EmailDelivery
		if err := tx.First(&current, "id = ? AND status = ? AND locked_by = ?", delivery.ID, models.EmailDeliveryStatusDelivering, delivery.LockedBy).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}
		stageLog := appendStageLog(current.StageLog, StageEntry{At: now, Stage: StageSucceeded, Detail: "message accepted by configured SMTP path"})
		updates := map[string]any{
			"status":        models.EmailDeliveryStatusSucceeded,
			"stage":         StageSucceeded,
			"locked_at":     nil,
			"locked_by":     "",
			"succeeded_at":  now,
			"error":         "",
			"stage_log":     stageLog,
			"message_json":  "{}",
			"settings_json": "{}",
		}
		result := tx.Model(&models.EmailDelivery{}).Where("id = ? AND status = ? AND locked_by = ?", delivery.ID, models.EmailDeliveryStatusDelivering, delivery.LockedBy).Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 || w.OnSuccess == nil {
			return nil
		}
		current.Status = models.EmailDeliveryStatusSucceeded
		current.Stage = StageSucceeded
		current.SucceededAt = &now
		current.StageLog = stageLog
		return w.OnSuccess(ctx, tx, current, now)
	})
}

func (w *Worker) finishFailure(ctx context.Context, delivery *models.EmailDelivery, now time.Time, message string, retryable bool) error {
	attempt := delivery.AttemptCount
	if attempt <= 0 {
		attempt = delivery.AttemptCount + 1
	}
	final := !retryable || attempt >= delivery.MaxAttempts
	nextStatus := models.EmailDeliveryStatusFailed
	stage := StageFailed
	var nextAttemptAt *time.Time
	if !final {
		nextStatus = models.EmailDeliveryStatusRetry
		stage = "retry_scheduled"
		next := now.Add(nextRetryDelay(attempt))
		nextAttemptAt = &next
	}
	return w.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var current models.EmailDelivery
		if err := tx.First(&current, "id = ? AND status = ? AND locked_by = ?", delivery.ID, models.EmailDeliveryStatusDelivering, delivery.LockedBy).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}
		stageLog := appendStageLog(current.StageLog, StageEntry{At: now, Stage: stage, Detail: message})
		updates := map[string]any{
			"status":          nextStatus,
			"stage":           stage,
			"attempt_count":   attempt,
			"locked_at":       nil,
			"locked_by":       "",
			"last_attempt_at": now,
			"next_attempt_at": nextAttemptAt,
			"error":           message,
			"stage_log":       stageLog,
		}
		if final {
			updates["message_json"] = "{}"
			updates["settings_json"] = "{}"
		}
		return tx.Model(&models.EmailDelivery{}).
			Where("id = ? AND status = ? AND locked_by = ?", delivery.ID, models.EmailDeliveryStatusDelivering, delivery.LockedBy).
			Updates(updates).Error
	})
}

func nextRetryDelay(attempt int) time.Duration {
	if attempt <= 0 {
		attempt = 1
	}
	index := attempt - 1
	if index >= len(retryDelays) {
		index = len(retryDelays) - 1
	}
	delay := retryDelays[index]
	jitter := time.Duration(rand.Int63n(int64(delay/5 + 1)))
	return delay + jitter
}

func isRetryableError(err error) bool {
	if err == nil {
		return false
	}
	if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
		return true
	}
	text := strings.ToLower(err.Error())
	return strings.Contains(text, "timeout") ||
		strings.Contains(text, "deadline exceeded") ||
		strings.Contains(text, "temporarily") ||
		strings.Contains(text, "try again") ||
		strings.HasPrefix(strings.TrimSpace(text), "4")
}

func (w *Worker) sender() Sender {
	if w.Sender == nil {
		w.Sender = mailer.DefaultSender{}
	}
	return w.Sender
}

func (w *Worker) now() time.Time {
	if w.Now != nil {
		return w.Now()
	}
	return time.Now().UTC()
}

func (w *Worker) lockedBy() string {
	if strings.TrimSpace(w.LockedBy) == "" {
		w.LockedBy = "email-delivery-worker-" + uuid.NewString()
	}
	return w.LockedBy
}
