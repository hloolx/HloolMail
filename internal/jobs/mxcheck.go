package jobs

import (
	"context"
	"fmt"
	"log/slog"
	"strconv"
	"time"

	"gptmail/internal/domain"
	"gptmail/internal/events"
	"gptmail/internal/models"
	"gptmail/internal/scheduler"

	"gorm.io/gorm"
)

type MXCheckJob struct {
	DB      *gorm.DB
	Checker domain.DNSChecker
	Hub     *events.Hub
}

func StartMXCheck(ctx context.Context, db *gorm.DB, checker domain.DNSChecker, hub *events.Hub) {
	job := &MXCheckJob{DB: db, Checker: checker, Hub: hub}
	go scheduler.DailyAt(ctx, "mx-check-daily", 3, 0, true, func(taskCtx context.Context) {
		job.run(taskCtx)
	})
}

func StartMXAutoRetry(ctx context.Context, checker domain.DNSChecker) {
	go scheduler.Every(ctx, "mx-auto-retry", time.Minute, true, func(taskCtx context.Context) {
		runMXAutoRetry(taskCtx, checker)
	})
}

func runMXAutoRetry(ctx context.Context, checker domain.DNSChecker) {
	runMXAutoRetryAt(ctx, checker, time.Now)
}

func runMXAutoRetryAt(ctx context.Context, checker domain.DNSChecker, nowFunc func() time.Time) {
	now := nowFunc()
	var domains []models.Domain
	if err := checker.DB.Where("mx_auto_retry_enabled = ? AND mx_auto_retry_next_at IS NOT NULL AND mx_auto_retry_next_at <= ?", true, now).Find(&domains).Error; err != nil {
		slog.Warn("mx auto retry failed to list domains", "error", err)
		return
	}
	for _, d := range domains {
		select {
		case <-ctx.Done():
			return
		default:
		}
		result, err := checker.Check(ctx, d.Domain)
		retryAt := nowFunc()
		next := retryAt.Add(10 * time.Minute)
		if d.MXAutoRetryUntil != nil && next.After(*d.MXAutoRetryUntil) {
			next = *d.MXAutoRetryUntil
		}
		updates := map[string]interface{}{
			"mx_auto_retry_last_at": retryAt,
			"mx_auto_retry_next_at": next,
			"mx_auto_retry_count":   gorm.Expr("mx_auto_retry_count + ?", 1),
		}
		if err != nil {
			updates["last_check_message"] = err.Error()
		}
		ready := err == nil && mxRetryResultReady(d, result)
		if ready {
			updates["mx_auto_retry_enabled"] = false
			updates["mx_auto_retry_next_at"] = nil
		} else if d.MXAutoRetryUntil != nil && !retryAt.Before(*d.MXAutoRetryUntil) {
			if domainExpiredPendingDelete(d, retryAt) {
				hasData, dataErr := domainHasBusinessData(checker.DB, d)
				if dataErr != nil {
					slog.Warn("mx auto retry failed to inspect pending domain usage", "domain", d.Domain, "error", dataErr)
				} else if !hasData {
					if err := checker.DB.Delete(&models.Domain{}, d.ID).Error; err != nil {
						slog.Warn("mx auto retry failed to delete expired pending domain", "domain", d.Domain, "error", err)
					}
					continue
				} else {
					updates["last_check_message"] = "verification window expired; domain retained because it has mail data"
				}
			}
			updates["mx_auto_retry_enabled"] = false
			updates["mx_auto_retry_next_at"] = nil
			updates["last_health_status"] = DomainHealthStatusUnhealthy
			updates["last_unhealthy_at"] = retryAt
			if d.FirstVerifiedAt != nil {
				createMXRetryExpiredNotification(checker.DB, d, "Domain "+d.Domain+" DNS has remained unhealthy past the automatic retry window")
			}
		}
		if err := checker.DB.Model(&models.Domain{}).Where("id = ?", d.ID).Updates(updates).Error; err != nil {
			slog.Warn("mx auto retry failed to update domain", "domain", d.Domain, "error", err)
		}
	}
}

func mxRetryResultReady(d models.Domain, result domain.CheckResult) bool {
	wildcardRequired := d.WildcardRequested || result.WildcardChecked
	return result.MXVerified && (!wildcardRequired || result.WildcardEnabled)
}

func createMXRetryExpiredNotification(db *gorm.DB, d models.Domain, message string) {
	var existing models.Notification
	err := db.Where("domain_id = ? AND type = ? AND created_at > ?", d.ID, "MX_FAILED", time.Now().Add(-24*time.Hour)).First(&existing).Error
	if err == nil {
		return
	}
	notification := models.Notification{
		UserID:    d.OwnerID,
		DomainID:  &d.ID,
		Type:      "MX_FAILED",
		Message:   message,
		CreatedAt: time.Now(),
	}
	if err := db.Create(&notification).Error; err != nil {
		slog.Warn("mx auto retry failed to create timeout notification", "domain", d.Domain, "error", err)
	}
}

func (j *MXCheckJob) run(ctx context.Context) {
	slog.Info("mx check job starting")
	var domains []models.Domain
	if err := j.DB.Where("active = ?", true).Order("domain asc").Find(&domains).Error; err != nil {
		slog.Error("mx check job failed to list domains", "error", err)
		return
	}
	for _, d := range domains {
		select {
		case <-ctx.Done():
			return
		default:
		}
		result, err := j.Checker.Check(ctx, d.Domain)
		if err != nil {
			slog.Warn("mx check failed for domain", "domain", d.Domain, "error", err)
			continue
		}
		j.handleResult(d, result)
		timer := time.NewTimer(2 * time.Second)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
	slog.Info("mx check job finished", "domains", len(domains))
}

func (j *MXCheckJob) handleResult(d models.Domain, result domain.CheckResult) {
	if result.MXVerified {
		if !d.MXVerified {
			j.createNotification(d, "MX_RECOVERED", "Domain "+d.Domain+" MX records have recovered")
		}
	} else {
		message := result.CheckMessage
		if message == "" {
			message = "Domain " + d.Domain + " MX records are not verified"
		}
		j.createNotification(d, "MX_FAILED", message)
		slog.Warn("domain mx check failed", "domain", d.Domain, "message", message)
	}
	if result.DomainExpiresAt != nil {
		daysLeft := int(time.Until(*result.DomainExpiresAt).Hours() / 24)
		switch {
		case daysLeft < 0:
			j.createNotification(d, "DOMAIN_EXPIRED", "Domain "+d.Domain+" has expired")
		case daysLeft <= 30:
			j.createNotification(d, "DOMAIN_EXPIRING", fmt.Sprintf("Domain %s expires in %d days", d.Domain, daysLeft))
		}
	}
}

func (j *MXCheckJob) createNotification(domain models.Domain, ntype, message string) {
	var existing models.Notification
	err := j.DB.Where("domain_id = ? AND type = ? AND created_at > ?",
		domain.ID, ntype, time.Now().Add(-24*time.Hour)).First(&existing).Error
	if err == nil {
		return
	}
	notification := models.Notification{
		UserID:    domain.OwnerID,
		DomainID:  &domain.ID,
		Type:      ntype,
		Message:   message,
		CreatedAt: time.Now(),
	}
	if err := j.DB.Create(&notification).Error; err != nil {
		slog.Warn("failed to create notification", "domain", domain.Domain, "type", ntype, "error", err)
		return
	}
	if j.Hub != nil {
		j.Hub.PublishNotification(notificationKeys(notification.UserID), events.NotificationEvent{
			ID:        notification.ID,
			Type:      notification.Type,
			Message:   notification.Message,
			DomainID:  notification.DomainID,
			Read:      notification.Read,
			CreatedAt: notification.CreatedAt.Format(time.RFC3339),
		})
	}
}

func notificationKeys(userID *uint) []string {
	if userID == nil {
		return []string{"global"}
	}
	return []string{"user:" + strconv.FormatUint(uint64(*userID), 10)}
}
