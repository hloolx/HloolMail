package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"gptmail/internal/domain"
	"gptmail/internal/events"
	"gptmail/internal/models"
	"gptmail/internal/scheduler"

	"gorm.io/gorm"
)

const (
	DomainCheckTriggerSchedule = "schedule"
	DomainCheckTriggerManual   = "manual"

	DomainCheckStatusRunning  = "running"
	DomainCheckStatusSuccess  = "success"
	DomainCheckStatusFailed   = "failed"
	DomainCheckStatusCanceled = "canceled"

	DomainHealthStatusHealthy   = "healthy"
	DomainHealthStatusUnhealthy = "unhealthy"
	DomainHealthStatusError     = "error"
)

var ErrDomainCheckAlreadyRunning = errors.New("domain check run already running")

type DomainHealthJob struct {
	DB      *gorm.DB
	Checker domain.DNSChecker
	Hub     *events.Hub
}

type domainCheckOutcome struct {
	domain models.Domain
	record models.DomainCheckResultRecord
	result domain.CheckResult
	passed bool
	err    error
}

func NewDomainHealthJob(db *gorm.DB, checker domain.DNSChecker, hub *events.Hub) *DomainHealthJob {
	return &DomainHealthJob{DB: db, Checker: checker, Hub: hub}
}

func StartDomainHealthMonitor(ctx context.Context, job *DomainHealthJob) {
	if job == nil {
		return
	}
	go scheduler.Every(ctx, "domain-health-monitor", time.Minute, true, func(taskCtx context.Context) {
		if err := job.RunDue(taskCtx); err != nil && !errors.Is(err, ErrDomainCheckAlreadyRunning) {
			slog.Warn("domain health monitor tick failed", "error", err)
		}
	})
}

func EnsureDomainCheckSettings(db *gorm.DB) (models.DomainCheckSettings, error) {
	var settings models.DomainCheckSettings
	err := db.First(&settings, "id = ?", 1).Error
	if err == nil {
		settings = normalizeDomainCheckSettings(settings)
		return settings, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return settings, err
	}
	now := time.Now()
	settings = models.DomainCheckSettings{
		ID:                1,
		Enabled:           true,
		IntervalMinutes:   30,
		TimeoutMS:         3500,
		MaxConcurrency:    5,
		ResolverListJSON:  mustMarshalJSON(defaultDomainCheckResolvers()),
		CheckInactive:     false,
		FailureThreshold:  2,
		RecoveryThreshold: 1,
		NextRunAt:         &now,
	}
	if err := db.Create(&settings).Error; err != nil {
		return settings, err
	}
	return settings, nil
}

func SaveDomainCheckSettings(db *gorm.DB, settings models.DomainCheckSettings) (models.DomainCheckSettings, error) {
	settings.ID = 1
	settings = normalizeDomainCheckSettings(settings)
	if settings.NextRunAt == nil {
		next := time.Now().Add(time.Duration(settings.IntervalMinutes) * time.Minute)
		settings.NextRunAt = &next
	}
	if err := db.Save(&settings).Error; err != nil {
		return settings, err
	}
	return settings, nil
}

func DomainCheckResolvers(settings models.DomainCheckSettings) []string {
	var resolvers []string
	if err := json.Unmarshal([]byte(settings.ResolverListJSON), &resolvers); err != nil {
		return defaultDomainCheckResolvers()
	}
	out := make([]string, 0, len(resolvers))
	seen := map[string]bool{}
	for _, resolver := range resolvers {
		resolver = strings.TrimSpace(resolver)
		if resolver == "" || seen[resolver] {
			continue
		}
		seen[resolver] = true
		out = append(out, resolver)
	}
	if len(out) == 0 {
		return defaultDomainCheckResolvers()
	}
	return out
}

func (j *DomainHealthJob) RunDue(ctx context.Context) error {
	settings, err := EnsureDomainCheckSettings(j.DB)
	if err != nil {
		return err
	}
	if !settings.Enabled {
		return nil
	}
	if settings.LastRunAt != nil && settings.NextRunAt != nil && settings.NextRunAt.After(time.Now()) {
		return nil
	}
	_, err = j.StartRun(ctx, DomainCheckTriggerSchedule)
	return err
}

func (j *DomainHealthJob) StartRun(ctx context.Context, trigger string) (models.DomainCheckRun, error) {
	var existing models.DomainCheckRun
	err := j.DB.Where("status = ?", DomainCheckStatusRunning).Order("started_at desc").First(&existing).Error
	if err == nil {
		return existing, ErrDomainCheckAlreadyRunning
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return models.DomainCheckRun{}, err
	}

	settings, err := EnsureDomainCheckSettings(j.DB)
	if err != nil {
		return models.DomainCheckRun{}, err
	}
	run := models.DomainCheckRun{
		Trigger:   trigger,
		Status:    DomainCheckStatusRunning,
		StartedAt: time.Now(),
	}
	if err := j.DB.Create(&run).Error; err != nil {
		return run, err
	}
	go j.executeRun(context.WithoutCancel(ctx), run.ID, settings)
	return run, nil
}

func (j *DomainHealthJob) executeRun(ctx context.Context, runID uint, settings models.DomainCheckSettings) {
	if err := RunPendingDomainCleanup(j.DB, time.Now()); err != nil {
		j.finishRun(runID, DomainCheckStatusFailed, err.Error())
		return
	}

	var domains []models.Domain
	query := j.DB.Order("domain asc")
	if !settings.CheckInactive {
		query = query.Where("active = ?", true)
	}
	if err := query.Find(&domains).Error; err != nil {
		j.finishRun(runID, DomainCheckStatusFailed, err.Error())
		return
	}
	if err := j.DB.Model(&models.DomainCheckRun{}).Where("id = ?", runID).Update("total", len(domains)).Error; err != nil {
		j.finishRun(runID, DomainCheckStatusFailed, err.Error())
		return
	}

	options := domain.CheckOptions{
		Resolvers:     DomainCheckResolvers(settings),
		Timeout:       time.Duration(settings.TimeoutMS) * time.Millisecond,
		MaxConcurrent: settings.MaxConcurrency,
	}
	outcomes := j.checkDomains(ctx, domains, runID, options)
	checked, passed, failed := 0, 0, 0
	for outcome := range outcomes {
		checked++
		if outcome.passed {
			passed++
		} else {
			failed++
		}
		if err := j.DB.Create(&outcome.record).Error; err != nil {
			slog.Warn("failed to save domain check result", "domain", outcome.domain.Domain, "error", err)
		}
		if outcome.err == nil {
			j.applyHealthResult(outcome.domain, outcome.result, outcome.passed, runID, settings)
		}
		_ = j.DB.Model(&models.DomainCheckRun{}).Where("id = ?", runID).Updates(map[string]interface{}{
			"checked": checked,
			"passed":  passed,
			"failed":  failed,
		}).Error
	}

	if ctx.Err() != nil {
		j.finishRun(runID, DomainCheckStatusCanceled, ctx.Err().Error())
		return
	}
	j.finishRun(runID, DomainCheckStatusSuccess, "")
}

func (j *DomainHealthJob) checkDomains(ctx context.Context, domains []models.Domain, runID uint, options domain.CheckOptions) <-chan domainCheckOutcome {
	workerCount := options.MaxConcurrent
	if workerCount < 1 {
		workerCount = 1
	}
	if workerCount > len(domains) && len(domains) > 0 {
		workerCount = len(domains)
	}
	work := make(chan models.Domain)
	outcomes := make(chan domainCheckOutcome, len(domains))
	var wg sync.WaitGroup
	for i := 0; i < workerCount; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for d := range work {
				outcomes <- j.checkOne(ctx, d, runID, options)
			}
		}()
	}
	go func() {
		defer close(outcomes)
		for _, d := range domains {
			select {
			case <-ctx.Done():
				close(work)
				wg.Wait()
				return
			case work <- d:
			}
		}
		close(work)
		wg.Wait()
	}()
	return outcomes
}

func (j *DomainHealthJob) checkOne(ctx context.Context, d models.Domain, runID uint, options domain.CheckOptions) domainCheckOutcome {
	start := time.Now()
	result, err := j.Checker.CheckDomain(ctx, d, options)
	passed := err == nil && result.MXVerified && (!result.WildcardChecked || result.WildcardEnabled)
	status := DomainHealthStatusUnhealthy
	if passed {
		status = DomainHealthStatusHealthy
	} else if err != nil {
		status = DomainHealthStatusError
	}
	record := models.DomainCheckResultRecord{
		RunID:         runID,
		DomainID:      d.ID,
		Domain:        d.Domain,
		ExpectedMX:    strings.TrimSuffix(strings.ToLower(j.Checker.Config.ExpectedMX), "."),
		MXVerified:    result.MXVerified,
		WildcardOK:    !result.WildcardChecked || result.WildcardEnabled,
		Status:        status,
		MXRecordsJSON: mustMarshalJSON(result.MXRecords),
		ProbesJSON: mustMarshalJSON(map[string][]domain.DNSProbe{
			"dns_checks":          result.DNSChecks,
			"wildcard_dns_checks": result.WildcardDNSChecks,
		}),
		DurationMS: time.Since(start).Milliseconds(),
		CreatedAt:  time.Now(),
	}
	if err != nil {
		record.ErrorMessage = err.Error()
	} else {
		record.ErrorMessage = result.CheckMessage
	}
	return domainCheckOutcome{domain: d, record: record, result: result, passed: passed, err: err}
}

func (j *DomainHealthJob) applyHealthResult(d models.Domain, result domain.CheckResult, passed bool, runID uint, settings models.DomainCheckSettings) {
	now := time.Now()
	updates := map[string]interface{}{
		"last_health_run_id": runID,
	}
	if passed {
		recoveryCount := d.HealthRecoveryCount + 1
		updates["health_failure_count"] = 0
		updates["health_recovery_count"] = recoveryCount
		updates["last_health_status"] = DomainHealthStatusHealthy
		updates["last_healthy_at"] = now
		if err := j.DB.Model(&models.Domain{}).Where("id = ?", d.ID).Updates(updates).Error; err != nil {
			slog.Warn("failed to update healthy domain state", "domain", d.Domain, "error", err)
			return
		}
		if d.LastHealthStatus == DomainHealthStatusUnhealthy && recoveryCount >= settings.RecoveryThreshold {
			message := fmt.Sprintf("Domain %s MX records have recovered and now point to %s", d.Domain, strings.Join(result.MXRecords, ", "))
			j.notifyDomain(d, d.OwnerID, "MX_RECOVERED", message)
		}
		return
	}

	failureCount := d.HealthFailureCount + 1
	updates["health_failure_count"] = failureCount
	updates["health_recovery_count"] = 0
	updates["last_health_status"] = DomainHealthStatusUnhealthy
	updates["last_unhealthy_at"] = now
	if err := j.DB.Model(&models.Domain{}).Where("id = ?", d.ID).Updates(updates).Error; err != nil {
		slog.Warn("failed to update unhealthy domain state", "domain", d.Domain, "error", err)
		return
	}
	wasUsable := d.MXVerified && (!d.WildcardRequested || d.WildcardEnabled)
	if wasUsable && failureCount >= settings.FailureThreshold {
		current := strings.Join(result.MXRecords, ", ")
		if current == "" {
			current = "none"
		}
		message := fmt.Sprintf("Domain %s MX checks failed %d times. Current MX: %s. Expected: %s", d.Domain, failureCount, current, j.Checker.Config.ExpectedMX)
		j.notifyDomain(d, d.OwnerID, "MX_FAILED", message)
		j.notifyDomain(d, nil, "MX_FAILED", message)
	}
}

func (j *DomainHealthJob) notifyDomain(d models.Domain, userID *uint, ntype string, message string) {
	query := j.DB.Where("domain_id = ? AND type = ? AND created_at > ?", d.ID, ntype, time.Now().Add(-24*time.Hour))
	if userID == nil {
		query = query.Where("user_id IS NULL")
	} else {
		query = query.Where("user_id = ?", *userID)
	}
	var existing models.Notification
	if err := query.First(&existing).Error; err == nil {
		return
	}
	notification := models.Notification{
		UserID:    userID,
		DomainID:  &d.ID,
		Type:      ntype,
		Message:   message,
		CreatedAt: time.Now(),
	}
	if err := j.DB.Create(&notification).Error; err != nil {
		slog.Warn("failed to create domain health notification", "domain", d.Domain, "type", ntype, "error", err)
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

func (j *DomainHealthJob) finishRun(runID uint, status string, message string) {
	now := time.Now()
	updates := map[string]interface{}{
		"status":      status,
		"finished_at": &now,
	}
	if message != "" {
		updates["error_message"] = message
	}
	_ = j.DB.Model(&models.DomainCheckRun{}).Where("id = ?", runID).Updates(updates).Error

	settings, err := EnsureDomainCheckSettings(j.DB)
	if err != nil {
		slog.Warn("failed to load domain check settings after run", "error", err)
		return
	}
	next := now.Add(time.Duration(settings.IntervalMinutes) * time.Minute)
	_ = j.DB.Model(&models.DomainCheckSettings{}).Where("id = ?", 1).Updates(map[string]interface{}{
		"last_run_at": &now,
		"next_run_at": &next,
	}).Error
}

func normalizeDomainCheckSettings(settings models.DomainCheckSettings) models.DomainCheckSettings {
	if settings.IntervalMinutes <= 0 {
		settings.IntervalMinutes = 30
	}
	if settings.TimeoutMS <= 0 {
		settings.TimeoutMS = 3500
	}
	if settings.MaxConcurrency <= 0 {
		settings.MaxConcurrency = 5
	}
	if settings.FailureThreshold <= 0 {
		settings.FailureThreshold = 2
	}
	if settings.RecoveryThreshold <= 0 {
		settings.RecoveryThreshold = 1
	}
	if strings.TrimSpace(settings.ResolverListJSON) == "" {
		settings.ResolverListJSON = mustMarshalJSON(defaultDomainCheckResolvers())
	}
	return settings
}

func defaultDomainCheckResolvers() []string {
	return []string{"1.1.1.1:53", "8.8.8.8:53", "223.5.5.5:53"}
}

func mustMarshalJSON(value interface{}) string {
	raw, err := json.Marshal(value)
	if err != nil {
		return "[]"
	}
	return string(raw)
}
