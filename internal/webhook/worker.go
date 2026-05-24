package webhook

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"strings"
	"time"

	"gptmail/internal/config"
	"gptmail/internal/models"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

var retryDelays = []time.Duration{
	time.Minute,
	5 * time.Minute,
	15 * time.Minute,
	time.Hour,
	3 * time.Hour,
	6 * time.Hour,
	12 * time.Hour,
	24 * time.Hour,
}

type Worker struct {
	DB                *gorm.DB
	Client            *http.Client
	Resolve           Resolver
	Now               func() time.Time
	Jitter            func(time.Duration) time.Duration
	LockedBy          string
	MaxBatch          int
	ResponseBodyLimit int64
}

func NewWorker(db *gorm.DB) *Worker {
	return &Worker{
		DB: db,
		Client: &http.Client{
			Timeout: 10 * time.Second,
		},
		Resolve:           DefaultResolver,
		Now:               func() time.Time { return time.Now().UTC() },
		Jitter:            defaultJitter,
		LockedBy:          "webhook-worker-" + uuid.NewString(),
		MaxBatch:          10,
		ResponseBodyLimit: 4096,
	}
}

func Start(ctx context.Context, db *gorm.DB, cfg config.Config) {
	if !cfg.WebhooksEnabled {
		return
	}
	worker := NewWorker(db)
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

func (w *Worker) claimDueDeliveries(ctx context.Context) ([]models.WebhookDelivery, error) {
	now := w.now()
	staleBefore := now.Add(-10 * time.Minute)
	limit := w.MaxBatch
	if limit <= 0 {
		limit = 10
	}
	var candidates []models.WebhookDelivery
	err := w.DB.WithContext(ctx).
		Where("((status IN ? AND (next_attempt_at IS NULL OR next_attempt_at <= ?)) OR (status = ? AND locked_at < ?))",
			[]string{models.WebhookDeliveryStatusPending, models.WebhookDeliveryStatusRetry},
			now,
			models.WebhookDeliveryStatusDelivering,
			staleBefore,
		).
		Order("next_attempt_at asc, created_at asc").
		Limit(limit).
		Find(&candidates).Error
	if err != nil {
		return nil, err
	}
	claimed := make([]models.WebhookDelivery, 0, len(candidates))
	for _, candidate := range candidates {
		result := w.DB.WithContext(ctx).Model(&models.WebhookDelivery{}).
			Where("id = ? AND ((status IN ? AND (next_attempt_at IS NULL OR next_attempt_at <= ?)) OR (status = ? AND locked_at < ?))",
				candidate.ID,
				[]string{models.WebhookDeliveryStatusPending, models.WebhookDeliveryStatusRetry},
				now,
				models.WebhookDeliveryStatusDelivering,
				staleBefore,
			).
			Updates(map[string]any{
				"status":    models.WebhookDeliveryStatusDelivering,
				"locked_at": now,
				"locked_by": w.lockedBy(),
			})
		if result.Error != nil {
			return nil, result.Error
		}
		if result.RowsAffected == 0 {
			continue
		}
		var delivery models.WebhookDelivery
		if err := w.DB.WithContext(ctx).Preload("Endpoint").First(&delivery, "id = ?", candidate.ID).Error; err != nil {
			return nil, err
		}
		claimed = append(claimed, delivery)
	}
	return claimed, nil
}

func (w *Worker) deliver(ctx context.Context, delivery *models.WebhookDelivery) error {
	now := w.now()
	if delivery.Endpoint.ID == 0 {
		if err := w.DB.WithContext(ctx).Preload("Endpoint").First(delivery, "id = ?", delivery.ID).Error; err != nil {
			return err
		}
	}
	deliverable, err := w.messageStillDeliverable(ctx, delivery, now)
	if err != nil {
		return err
	}
	if !deliverable {
		return nil
	}
	if !delivery.Endpoint.Enabled || delivery.Endpoint.DisabledAt != nil || delivery.Endpoint.DeletedAt.Valid {
		return w.finishFailure(ctx, delivery, now, "endpoint disabled", nil, "", false)
	}
	if err := ValidateDeliveryURL(ctx, delivery.Endpoint.URL, w.Resolve); err != nil {
		return w.finishFailure(ctx, delivery, now, err.Error(), nil, "", false)
	}
	attempt := delivery.AttemptCount + 1
	result := w.DB.WithContext(ctx).Model(&models.WebhookDelivery{}).
		Where("id = ? AND status = ?", delivery.ID, models.WebhookDeliveryStatusDelivering).
		Updates(map[string]any{
			"attempt_count":   attempt,
			"last_attempt_at": now,
			"response_status": nil,
			"response_body":   "",
			"error":           "",
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return nil
	}
	claimed, err := w.deliveryStillClaimed(ctx, delivery)
	if err != nil {
		return err
	}
	if !claimed {
		return nil
	}
	timestamp := now.UTC().Format(time.RFC3339)
	rawPayload := []byte(delivery.PayloadJSON)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, delivery.Endpoint.URL, bytes.NewReader(rawPayload))
	if err != nil {
		return w.finishFailure(ctx, delivery, now, err.Error(), nil, "", false)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "hloolmail-webhook/1")
	req.Header.Set("X-Hlool-Event", delivery.EventType)
	req.Header.Set("X-Hlool-Delivery", delivery.ID)
	req.Header.Set("X-Hlool-Timestamp", timestamp)
	req.Header.Set("X-Hlool-Signature", "v1="+Sign(delivery.Endpoint.Secret, timestamp, delivery.ID, rawPayload))
	req.Header.Set("X-Hlool-Attempt", fmt.Sprintf("%d", attempt))

	client := w.httpClient()
	resp, err := client.Do(req)
	if err != nil {
		return w.finishFailure(ctx, delivery, now, err.Error(), nil, "", isRetryableError(err))
	}
	defer resp.Body.Close()
	body, readErr := io.ReadAll(io.LimitReader(resp.Body, w.responseBodyLimit()+1))
	responseBody := string(body)
	if int64(len(body)) > w.responseBodyLimit() {
		responseBody = string(body[:w.responseBodyLimit()]) + "...(truncated)"
	}
	if readErr != nil {
		return w.finishFailure(ctx, delivery, now, readErr.Error(), &resp.StatusCode, responseBody, true)
	}
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return w.finishSuccess(ctx, delivery, now, resp.StatusCode, responseBody)
	}
	retryable := resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500
	return w.finishFailure(ctx, delivery, now, fmt.Sprintf("webhook returned HTTP %d", resp.StatusCode), &resp.StatusCode, responseBody, retryable)
}

func (w *Worker) messageStillDeliverable(ctx context.Context, delivery *models.WebhookDelivery, now time.Time) (bool, error) {
	if delivery.EventType != models.WebhookEventMessageReceived || delivery.MessageID == "" {
		return true, nil
	}
	var msg models.Message
	err := w.DB.WithContext(ctx).Select("id", "expires_at").First(&msg, "id = ?", delivery.MessageID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, RedactMessageDeliveriesByID(w.DB.WithContext(ctx), delivery.MessageID, now, RedactionReasonMessageDeleted)
	}
	if err != nil {
		return false, err
	}
	if !msg.ExpiresAt.After(now) {
		return false, RedactMessageDeliveriesByID(w.DB.WithContext(ctx), delivery.MessageID, now, RedactionReasonMessageExpired)
	}
	return true, nil
}

func (w *Worker) deliveryStillClaimed(ctx context.Context, delivery *models.WebhookDelivery) (bool, error) {
	var current models.WebhookDelivery
	if err := w.DB.WithContext(ctx).Select("status", "payload_json").First(&current, "id = ?", delivery.ID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, nil
		}
		return false, err
	}
	return current.Status == models.WebhookDeliveryStatusDelivering && current.PayloadJSON == delivery.PayloadJSON, nil
}

func (w *Worker) finishSuccess(ctx context.Context, delivery *models.WebhookDelivery, now time.Time, status int, body string) error {
	return w.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&models.WebhookDelivery{}).
			Where("id = ? AND status = ?", delivery.ID, models.WebhookDeliveryStatusDelivering).
			Updates(map[string]any{
				"status":          models.WebhookDeliveryStatusSucceeded,
				"locked_at":       nil,
				"locked_by":       "",
				"succeeded_at":    now,
				"response_status": status,
				"response_body":   body,
				"error":           "",
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return nil
		}
		return tx.Model(&models.WebhookEndpoint{}).Where("id = ?", delivery.EndpointID).Updates(map[string]any{
			"last_success_at": now,
			"failure_count":   0,
		}).Error
	})
}

func (w *Worker) finishFailure(ctx context.Context, delivery *models.WebhookDelivery, now time.Time, message string, status *int, body string, retryable bool) error {
	attempt := delivery.AttemptCount + 1
	final := !retryable || attempt >= delivery.MaxAttempts
	nextStatus := models.WebhookDeliveryStatusFailed
	var nextAttemptAt *time.Time
	if !final {
		nextStatus = models.WebhookDeliveryStatusRetry
		next := now.Add(nextRetryDelay(attempt, w.jitter()))
		nextAttemptAt = &next
	}
	return w.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		updates := map[string]any{
			"status":          nextStatus,
			"attempt_count":   attempt,
			"locked_at":       nil,
			"locked_by":       "",
			"last_attempt_at": now,
			"next_attempt_at": nextAttemptAt,
			"response_status": status,
			"response_body":   body,
			"error":           message,
		}
		result := tx.Model(&models.WebhookDelivery{}).
			Where("id = ? AND status = ?", delivery.ID, models.WebhookDeliveryStatusDelivering).
			Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return nil
		}
		return tx.Model(&models.WebhookEndpoint{}).Where("id = ?", delivery.EndpointID).Updates(map[string]any{
			"last_failure_at": now,
			"failure_count":   gorm.Expr("failure_count + ?", 1),
		}).Error
	})
}

func Sign(secret, timestamp, deliveryID string, rawPayload []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(timestamp))
	mac.Write([]byte("."))
	mac.Write([]byte(deliveryID))
	mac.Write([]byte("."))
	mac.Write(rawPayload)
	return hex.EncodeToString(mac.Sum(nil))
}

func nextRetryDelay(attempt int, jitter func(time.Duration) time.Duration) time.Duration {
	if attempt <= 0 {
		attempt = 1
	}
	index := attempt - 1
	if index >= len(retryDelays) {
		index = len(retryDelays) - 1
	}
	delay := retryDelays[index]
	if jitter != nil {
		delay += jitter(delay)
	}
	return delay
}

func defaultJitter(delay time.Duration) time.Duration {
	max := int64(delay / 5)
	if max <= 0 {
		return 0
	}
	n, err := rand.Int(rand.Reader, big.NewInt(max+1))
	if err != nil {
		return 0
	}
	return time.Duration(n.Int64())
}

func isRetryableError(err error) bool {
	if err == nil {
		return false
	}
	if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
		return true
	}
	return strings.Contains(strings.ToLower(err.Error()), "timeout") || strings.Contains(strings.ToLower(err.Error()), "deadline exceeded")
}

func (w *Worker) httpClient() *http.Client {
	if w.Client == nil {
		w.Client = &http.Client{Timeout: 10 * time.Second}
	}
	client := *w.Client
	if client.Transport == nil {
		transport := http.DefaultTransport.(*http.Transport).Clone()
		transport.Proxy = nil
		transport.DialContext = safeWebhookDialer{Resolve: w.Resolve}.DialContext
		client.Transport = transport
	}
	baseCheck := client.CheckRedirect
	client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) >= 3 {
			return http.ErrUseLastResponse
		}
		if err := ValidateDeliveryURL(req.Context(), req.URL.String(), w.Resolve); err != nil {
			return err
		}
		if baseCheck != nil {
			return baseCheck(req, via)
		}
		return nil
	}
	return &client
}

func (w *Worker) now() time.Time {
	if w.Now != nil {
		return w.Now().UTC()
	}
	return time.Now().UTC()
}

func (w *Worker) jitter() func(time.Duration) time.Duration {
	if w.Jitter != nil {
		return w.Jitter
	}
	return defaultJitter
}

func (w *Worker) lockedBy() string {
	if w.LockedBy != "" {
		return w.LockedBy
	}
	w.LockedBy = "webhook-worker-" + uuid.NewString()
	return w.LockedBy
}

func (w *Worker) responseBodyLimit() int64 {
	if w.ResponseBodyLimit > 0 {
		return w.ResponseBodyLimit
	}
	return 4096
}
