package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"gptmail/internal/jobs"
	"gptmail/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type adminDomainHealthItem struct {
	models.Domain
	MessageCount int64  `json:"message_count"`
	Severity     string `json:"severity"`
	Issue        string `json:"issue"`
	OwnerEmail   string `json:"owner_email,omitempty"`
}

type adminQuotaAlert struct {
	Kind       string     `json:"kind"`
	ID         uint       `json:"id"`
	Label      string     `json:"label"`
	Owner      string     `json:"owner,omitempty"`
	Enabled    bool       `json:"enabled"`
	DailyLimit int64      `json:"daily_limit"`
	UsedToday  int64      `json:"used_today"`
	TotalLimit int64      `json:"total_limit"`
	TotalUsed  int64      `json:"total_used"`
	LastUsedAt *time.Time `json:"last_used_at,omitempty"`
	Severity   string     `json:"severity"`
	Reason     string     `json:"reason"`
}

func (h *Handler) adminDomainHealth(c *gin.Context) {
	if !h.requireAdmin(c) {
		return
	}
	var domains []models.Domain
	if err := h.DB.Order("domain asc").Find(&domains).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	now := time.Now()
	items := make([]adminDomainHealthItem, 0, len(domains))
	for _, d := range domains {
		dto := domainWithCount(h.DB, d)
		severity, issue := classifyDomainHealth(d, now)
		items = append(items, adminDomainHealthItem{
			Domain:       dto.Domain,
			MessageCount: dto.MessageCount,
			Severity:     severity,
			Issue:        issue,
			OwnerEmail:   domainOwnerEmail(h.DB, d.OwnerID),
		})
	}
	sort.SliceStable(items, func(i, j int) bool {
		left := severityRank(items[i].Severity)
		right := severityRank(items[j].Severity)
		if left != right {
			return left > right
		}
		return items[i].Domain.Domain < items[j].Domain.Domain
	})
	ok(c, items)
}

type domainCheckSettingsDTO struct {
	models.DomainCheckSettings
	Resolvers []string                `json:"resolvers"`
	LastRun   *models.DomainCheckRun  `json:"last_run,omitempty"`
	Recent    []models.DomainCheckRun `json:"recent_runs,omitempty"`
}

func (h *Handler) adminDomainCheckSettings(c *gin.Context) {
	if !h.requireAdmin(c) {
		return
	}
	settings, err := jobs.EnsureDomainCheckSettings(h.DB)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	ok(c, h.domainCheckSettingsDTO(settings))
}

func (h *Handler) patchAdminDomainCheckSettings(c *gin.Context) {
	if !h.requireAdmin(c) {
		return
	}
	settings, err := jobs.EnsureDomainCheckSettings(h.DB)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	var input struct {
		Enabled            *bool    `json:"enabled"`
		IntervalMinutes    *int     `json:"interval_minutes"`
		TimeoutMS          *int     `json:"timeout_ms"`
		MaxConcurrency     *int     `json:"max_concurrency"`
		Resolvers          []string `json:"resolvers"`
		ResolverListJSON   string   `json:"resolver_list_json"`
		CheckInactive      *bool    `json:"check_inactive"`
		FailureThreshold   *int     `json:"failure_threshold"`
		RecoveryThreshold  *int     `json:"recovery_threshold"`
		GlobalProbeEnabled *bool    `json:"global_probe_enabled"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		fail(c, http.StatusBadRequest, "invalid json")
		return
	}
	if input.Enabled != nil {
		settings.Enabled = *input.Enabled
	}
	if input.IntervalMinutes != nil {
		if *input.IntervalMinutes < 1 || *input.IntervalMinutes > 1440 {
			fail(c, http.StatusBadRequest, "interval_minutes must be between 1 and 1440")
			return
		}
		settings.IntervalMinutes = *input.IntervalMinutes
		next := time.Now().Add(time.Duration(settings.IntervalMinutes) * time.Minute)
		settings.NextRunAt = &next
	}
	if input.TimeoutMS != nil {
		if *input.TimeoutMS < 500 || *input.TimeoutMS > 30000 {
			fail(c, http.StatusBadRequest, "timeout_ms must be between 500 and 30000")
			return
		}
		settings.TimeoutMS = *input.TimeoutMS
	}
	if input.MaxConcurrency != nil {
		if *input.MaxConcurrency < 1 || *input.MaxConcurrency > 50 {
			fail(c, http.StatusBadRequest, "max_concurrency must be between 1 and 50")
			return
		}
		settings.MaxConcurrency = *input.MaxConcurrency
	}
	if input.Resolvers != nil {
		resolvers, err := cleanResolvers(input.Resolvers)
		if err != nil {
			fail(c, http.StatusBadRequest, err.Error())
			return
		}
		raw, _ := json.Marshal(resolvers)
		settings.ResolverListJSON = string(raw)
	} else if strings.TrimSpace(input.ResolverListJSON) != "" {
		var resolvers []string
		if err := json.Unmarshal([]byte(input.ResolverListJSON), &resolvers); err != nil {
			fail(c, http.StatusBadRequest, "resolver_list_json must be a JSON string array")
			return
		}
		resolvers, err := cleanResolvers(resolvers)
		if err != nil {
			fail(c, http.StatusBadRequest, err.Error())
			return
		}
		raw, _ := json.Marshal(resolvers)
		settings.ResolverListJSON = string(raw)
	}
	if input.CheckInactive != nil {
		settings.CheckInactive = *input.CheckInactive
	}
	if input.FailureThreshold != nil {
		if *input.FailureThreshold < 1 || *input.FailureThreshold > 20 {
			fail(c, http.StatusBadRequest, "failure_threshold must be between 1 and 20")
			return
		}
		settings.FailureThreshold = *input.FailureThreshold
	}
	if input.RecoveryThreshold != nil {
		if *input.RecoveryThreshold < 1 || *input.RecoveryThreshold > 20 {
			fail(c, http.StatusBadRequest, "recovery_threshold must be between 1 and 20")
			return
		}
		settings.RecoveryThreshold = *input.RecoveryThreshold
	}
	if input.GlobalProbeEnabled != nil {
		settings.GlobalProbeEnabled = *input.GlobalProbeEnabled
	}
	if settings.Enabled && settings.NextRunAt == nil {
		next := time.Now()
		settings.NextRunAt = &next
	}
	settings, err = jobs.SaveDomainCheckSettings(h.DB, settings)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	h.audit("domain_check_settings.patch", actor(c), "domain-check-settings", "")
	ok(c, h.domainCheckSettingsDTO(settings))
}

func (h *Handler) createAdminDomainCheckRun(c *gin.Context) {
	if !h.requireAdmin(c) {
		return
	}
	if h.DomainHealth == nil {
		fail(c, http.StatusServiceUnavailable, "domain health job is not configured")
		return
	}
	run, err := h.DomainHealth.StartRun(c.Request.Context(), jobs.DomainCheckTriggerManual)
	if errors.Is(err, jobs.ErrDomainCheckAlreadyRunning) {
		ok(c, gin.H{"run": run, "reused": true})
		return
	}
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	h.audit("domain_check_run.create", actor(c), strconv.FormatUint(uint64(run.ID), 10), "")
	created(c, gin.H{"run": run, "reused": false})
}

func (h *Handler) listAdminDomainCheckRuns(c *gin.Context) {
	if !h.requireAdmin(c) {
		return
	}
	limit := parseLimit(c.Query("limit"), 10, 100)
	var runs []models.DomainCheckRun
	if err := h.DB.Order("started_at desc").Limit(limit).Find(&runs).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	ok(c, runs)
}

func (h *Handler) getAdminDomainCheckRun(c *gin.Context) {
	if !h.requireAdmin(c) {
		return
	}
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		fail(c, http.StatusBadRequest, "invalid run id")
		return
	}
	var run models.DomainCheckRun
	if err := h.DB.First(&run, "id = ?", id).Error; err != nil {
		fail(c, http.StatusNotFound, "domain check run not found")
		return
	}
	var records []models.DomainCheckResultRecord
	if err := h.DB.Where("run_id = ?", run.ID).Order("created_at desc").Find(&records).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	ok(c, gin.H{"run": run, "records": records})
}

func (h *Handler) adminQuotaAlerts(c *gin.Context) {
	if !h.requireAdmin(c) {
		return
	}
	alerts := make([]adminQuotaAlert, 0)

	var users []models.User
	if err := h.DB.Order("used_today desc, total_used desc").Find(&users).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	for _, user := range users {
		if alert, ok := quotaAlert("user", user.ID, user.Email, "", user.Enabled, user.DailyLimit, user.UsedToday, user.TotalLimit, user.TotalUsed, user.LastUsedAt); ok {
			alerts = append(alerts, alert)
		}
	}

	var keys []models.APIKey
	if err := h.DB.Order("used_today desc, total_used desc").Find(&keys).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	owners := map[uint]string{}
	for _, key := range keys {
		owner := ""
		if key.OwnerID != nil {
			if cached, ok := owners[*key.OwnerID]; ok {
				owner = cached
			} else {
				var user models.User
				if err := h.DB.First(&user, "id = ?", *key.OwnerID).Error; err == nil {
					owner = user.Email
					owners[*key.OwnerID] = owner
				}
			}
		}
		if alert, ok := quotaAlert("api_key", key.ID, key.Name, owner, key.Enabled, key.DailyLimit, key.UsedToday, key.TotalLimit, key.TotalUsed, key.LastUsedAt); ok {
			alerts = append(alerts, alert)
		}
	}

	sort.SliceStable(alerts, func(i, j int) bool {
		left := severityRank(alerts[i].Severity)
		right := severityRank(alerts[j].Severity)
		if left != right {
			return left > right
		}
		return alerts[i].Label < alerts[j].Label
	})
	ok(c, alerts)
}

func (h *Handler) domainCheckSettingsDTO(settings models.DomainCheckSettings) domainCheckSettingsDTO {
	var lastRun *models.DomainCheckRun
	var latest models.DomainCheckRun
	if err := h.DB.Order("started_at desc").First(&latest).Error; err == nil {
		lastRun = &latest
	}
	var recent []models.DomainCheckRun
	_ = h.DB.Order("started_at desc").Limit(10).Find(&recent).Error
	return domainCheckSettingsDTO{
		DomainCheckSettings: settings,
		Resolvers:           jobs.DomainCheckResolvers(settings),
		LastRun:             lastRun,
		Recent:              recent,
	}
}

func cleanResolvers(input []string) ([]string, error) {
	out := make([]string, 0, len(input))
	seen := map[string]bool{}
	for _, resolver := range input {
		resolver = strings.TrimSpace(resolver)
		if resolver == "" || seen[resolver] {
			continue
		}
		if len(resolver) > 255 {
			return nil, errors.New("resolver entries must be shorter than 255 characters")
		}
		seen[resolver] = true
		out = append(out, resolver)
	}
	if len(out) == 0 {
		return nil, errors.New("at least one resolver is required")
	}
	if len(out) > 20 {
		return nil, errors.New("at most 20 resolvers are allowed")
	}
	return out, nil
}

func domainOwnerEmail(db *gorm.DB, ownerID *uint) string {
	if ownerID == nil {
		return ""
	}
	var user models.User
	if err := db.First(&user, "id = ?", *ownerID).Error; err != nil {
		return ""
	}
	return user.Email
}

func (h *Handler) adminAuditLogs(c *gin.Context) {
	if !h.requireAdmin(c) {
		return
	}
	limit := parseLimit(c.Query("limit"), 30, 200)
	var logs []models.AuditLog
	if err := h.DB.Order("created_at desc").Limit(limit).Find(&logs).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	ok(c, logs)
}

func classifyDomainHealth(d models.Domain, now time.Time) (string, string) {
	if !d.Active {
		return "warning", "inactive"
	}
	if !d.MXVerified {
		return "critical", "mx_failed"
	}
	if d.DomainExpiresAt != nil {
		if d.DomainExpiresAt.Before(now) {
			return "critical", "domain_expired"
		}
		if d.DomainExpiresAt.Before(now.AddDate(0, 0, 30)) {
			return "warning", "domain_expiring"
		}
	}
	if d.LastMXCheckAt == nil {
		return "warning", "never_checked"
	}
	if d.LastMXCheckAt.Before(now.Add(-24 * time.Hour)) {
		return "warning", "stale_check"
	}
	return "ok", "healthy"
}

func quotaAlert(kind string, id uint, label, owner string, enabled bool, dailyLimit, usedToday, totalLimit, totalUsed int64, lastUsedAt *time.Time) (adminQuotaAlert, bool) {
	severity := "ok"
	reason := ""
	if dailyLimit > 0 {
		if usedToday >= dailyLimit {
			severity = "critical"
			reason = "daily_exceeded"
		} else if usedToday*100 >= dailyLimit*80 {
			severity = "warning"
			reason = "daily_warning"
		}
	}
	if totalLimit > 0 {
		if totalUsed >= totalLimit {
			severity = "critical"
			reason = "total_exceeded"
		} else if severity != "critical" && totalUsed*100 >= totalLimit*80 {
			severity = "warning"
			reason = "total_warning"
		}
	}
	if severity == "ok" {
		return adminQuotaAlert{}, false
	}
	return adminQuotaAlert{
		Kind:       kind,
		ID:         id,
		Label:      label,
		Owner:      owner,
		Enabled:    enabled,
		DailyLimit: dailyLimit,
		UsedToday:  usedToday,
		TotalLimit: totalLimit,
		TotalUsed:  totalUsed,
		LastUsedAt: lastUsedAt,
		Severity:   severity,
		Reason:     reason,
	}, true
}

func severityRank(severity string) int {
	switch severity {
	case "critical":
		return 3
	case "warning":
		return 2
	case "ok":
		return 1
	default:
		return 0
	}
}

func (h *Handler) enabledAdminCountExcluding(id uint) (int64, error) {
	var count int64
	query := h.DB.Model(&models.User{}).Where("role = ? AND enabled = ?", models.UserRoleAdmin, true)
	if id > 0 {
		query = query.Where("id <> ?", id)
	}
	err := query.Count(&count).Error
	return count, err
}

func cannotRemoveAdminResponse(c *gin.Context) {
	fail(c, http.StatusBadRequest, "at least one enabled admin account is required")
}
