package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"gptmail/internal/db"
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

type auditLogListResponse struct {
	Items      []models.AuditLog `json:"items"`
	Total      int64             `json:"total"`
	Page       int               `json:"page"`
	PerPage    int               `json:"per_page"`
	TotalPages int               `json:"total_pages"`
}

type domainHealthListResponse struct {
	Items      []adminDomainHealthItem `json:"items"`
	Total      int64                   `json:"total"`
	Page       int                     `json:"page"`
	PerPage    int                     `json:"per_page"`
	TotalPages int                     `json:"total_pages"`
}

func (h *Handler) adminDomainHealth(c *gin.Context) {
	if !h.requireAdmin(c) {
		return
	}
	page := parsePage(c.Query("page"))
	perPage := parseLimit(c.Query("per_page"), 10, 100)

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

	total := int64(len(items))
	start := (page - 1) * perPage
	if start >= len(items) {
		start = 0
	}
	end := start + perPage
	if end > len(items) {
		end = len(items)
	}

	ok(c, domainHealthListResponse{
		Items:      items[start:end],
		Total:      total,
		Page:       page,
		PerPage:    perPage,
		TotalPages: pageCount(total, perPage),
	})
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
	page := 1
	if p := c.Query("page"); p != "" {
		if parsed, err := strconv.Atoi(p); err == nil && parsed > 0 {
			page = parsed
		}
	}
	perPage := parseLimit(c.Query("per_page"), 10, 100)

	var total int64
	if err := h.DB.Model(&models.DomainCheckRun{}).Count(&total).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}

	var runs []models.DomainCheckRun
	offset := (page - 1) * perPage
	if err := h.DB.Order("started_at desc").Offset(offset).Limit(perPage).Find(&runs).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	totalPages := int((total + int64(perPage) - 1) / int64(perPage))
	ok(c, gin.H{"runs": runs, "total": total, "page": page, "per_page": perPage, "total_pages": totalPages})
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

type quotaAlertListResponse struct {
	Items      []adminQuotaAlert `json:"items"`
	Total      int64             `json:"total"`
	Page       int               `json:"page"`
	PerPage    int               `json:"per_page"`
	TotalPages int               `json:"total_pages"`
}

func (h *Handler) adminQuotaAlerts(c *gin.Context) {
	if !h.requireAdmin(c) {
		return
	}
	page := parsePage(c.Query("page"))
	perPage := parseLimit(c.Query("per_page"), 8, 100)

	alerts := make([]adminQuotaAlert, 0)

	var users []models.User
	if err := h.DB.Order("public_mailbox_today desc, total_used desc").Find(&users).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	for _, user := range users {
		if alert, ok := quotaAlert("user", user.ID, user.Email, "", user.Enabled, user.DailyLimit, user.PublicMailboxToday, user.TotalLimit, user.TotalUsed, user.LastUsedAt); ok {
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

	total := int64(len(alerts))
	start := (page - 1) * perPage
	if start >= len(alerts) {
		start = 0
	}
	end := start + perPage
	if end > len(alerts) {
		end = len(alerts)
	}

	ok(c, quotaAlertListResponse{
		Items:      alerts[start:end],
		Total:      total,
		Page:       page,
		PerPage:    perPage,
		TotalPages: pageCount(total, perPage),
	})
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
	page := parsePage(c.Query("page"))
	perPage := parseLimit(c.Query("per_page"), 20, 100)

	query := h.DB.Model(&models.AuditLog{})
	query = filterAuditLogs(query, c)

	var total int64
	if err := query.Count(&total).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}

	var logs []models.AuditLog
	offset := (page - 1) * perPage
	if err := query.Order("created_at desc, id desc").Limit(perPage).Offset(offset).Find(&logs).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}

	ok(c, auditLogListResponse{
		Items:      logs,
		Total:      total,
		Page:       page,
		PerPage:    perPage,
		TotalPages: pageCount(total, perPage),
	})
}

func filterAuditLogs(query *gorm.DB, c *gin.Context) *gorm.DB {
	if category := normalizedAuditFilter(c.Query("category")); category != "" && category != "all" {
		if category == auditCategorySecurity {
			query = query.Where("category = ? OR category = '' OR category IS NULL", category)
		} else {
			query = query.Where("category = ?", category)
		}
	}
	if severity := normalizedAuditFilter(c.Query("severity")); severity != "" && severity != "all" {
		query = query.Where("severity = ?", severity)
	}
	if action := normalizedAuditFilter(c.Query("action")); action != "" && action != "all" {
		query = query.Where("action = ?", action)
	}
	if actor := strings.TrimSpace(c.Query("actor")); actor != "" {
		query = query.Where("actor = ?", actor)
	}
	if targetType := normalizedAuditFilter(c.Query("target_type")); targetType != "" && targetType != "all" {
		query = query.Where("target_type = ?", targetType)
	}
	if target := strings.TrimSpace(c.Query("target")); target != "" {
		query = query.Where("target_id = ? OR target = ?", target, target)
	}
	if from, ok := parseAuditTime(c.Query("from")); ok {
		query = query.Where("created_at >= ?", from)
	}
	if to, ok := parseAuditTime(c.Query("to")); ok {
		query = query.Where("created_at <= ?", to)
	}
	if q := strings.TrimSpace(c.Query("q")); q != "" {
		like := "%" + strings.ToLower(q) + "%"
		query = query.Where(
			"LOWER(action) LIKE ? OR LOWER(actor) LIKE ? OR LOWER(target) LIKE ? OR LOWER(metadata) LIKE ?",
			like,
			like,
			like,
			like,
		)
	}
	return query
}

func normalizedAuditFilter(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func parseAuditTime(value string) (time.Time, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return time.Time{}, false
	}
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02"} {
		parsed, err := time.Parse(layout, value)
		if err == nil {
			return parsed.UTC(), true
		}
	}
	return time.Time{}, false
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

func (h *Handler) adminQuotaSettings(c *gin.Context) {
	if !h.requireAdmin(c) {
		return
	}
	settings, err := db.EnsureSystemQuotaSettings(h.DB)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	ok(c, settings)
}

func (h *Handler) patchAdminQuotaSettings(c *gin.Context) {
	if !h.requireAdmin(c) {
		return
	}
	settings, err := db.EnsureSystemQuotaSettings(h.DB)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	var input struct {
		PublicDomainMailboxLimit    *int64 `json:"public_domain_mailbox_limit"`
		UserDailyPublicMailboxLimit *int64 `json:"user_daily_public_mailbox_limit"`
		RequirePublicDomainForQuota *bool  `json:"require_public_domain_for_quota"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		fail(c, http.StatusBadRequest, "invalid json")
		return
	}
	if input.PublicDomainMailboxLimit != nil {
		if *input.PublicDomainMailboxLimit < 0 {
			fail(c, http.StatusBadRequest, "public_domain_mailbox_limit must be zero or greater")
			return
		}
		settings.PublicDomainMailboxLimit = *input.PublicDomainMailboxLimit
	}
	if input.UserDailyPublicMailboxLimit != nil {
		if *input.UserDailyPublicMailboxLimit < 0 {
			fail(c, http.StatusBadRequest, "user_daily_public_mailbox_limit must be zero or greater")
			return
		}
		settings.UserDailyPublicMailboxLimit = *input.UserDailyPublicMailboxLimit
	}
	if input.RequirePublicDomainForQuota != nil {
		settings.RequirePublicDomainForQuota = *input.RequirePublicDomainForQuota
	}
	if err := h.DB.Save(settings).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	h.audit("quota_settings.patch", actor(c), "system-quota-settings", "")
	ok(c, settings)
}

func (h *Handler) mailboxStats(c *gin.Context) {
	actor, allowed := h.requireActor(c)
	if !allowed {
		return
	}
	ownerID, hasOwner := actor.ownerID()
	if !hasOwner {
		fail(c, http.StatusForbidden, "login required")
		return
	}
	var user models.User
	if err := h.DB.First(&user, "id = ?", ownerID).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	quotaSettings, err := db.EnsureSystemQuotaSettings(h.DB)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	publicLimit := quotaSettings.UserDailyPublicMailboxLimit
	if user.Role == models.UserRoleAdmin {
		publicLimit = 0
	}
	var publicDomainCount int64
	h.DB.Model(&models.Domain{}).Where("owner_id = ? AND mode = ? AND active = ?", ownerID, models.DomainModePublic, true).Count(&publicDomainCount)
	publicToday := user.PublicMailboxToday
	publicTotal := user.PublicMailboxCreated
	privateTotal := user.PrivateMailboxCreated
	if !isSameLocalDate(user.PublicMailboxDate) {
		publicToday = 0
	}
	hasPublicDomain := publicDomainCount > 0
	ok(c, gin.H{
		"public_mailbox_created":     publicTotal,
		"public_mailbox_today":       publicToday,
		"public_mailbox_daily_limit": publicLimit,
		"private_mailbox_created":    privateTotal,
		"has_public_domain":          hasPublicDomain,
		"require_public_domain":      quotaSettings.RequirePublicDomainForQuota,
	})
}

func isSameLocalDate(dateStr string) bool {
	if dateStr == "" {
		return false
	}
	return dateStr == time.Now().Format("2006-01-02")
}

func (h *Handler) adminLoginSettings(c *gin.Context) {
	if !h.requireAdmin(c) {
		return
	}
	settings, err := db.EnsureLoginSettings(h.DB)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	ok(c, loginSettingsDTO(settings))
}

func (h *Handler) patchAdminLoginSettings(c *gin.Context) {
	if !h.requireAdmin(c) {
		return
	}
	settings, err := db.EnsureLoginSettings(h.DB)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	var input struct {
		TurnstileEnabled   *bool   `json:"turnstile_enabled"`
		TurnstileSiteKey   *string `json:"turnstile_site_key"`
		TurnstileSecretKey *string `json:"turnstile_secret_key"`
		PasskeyEnabled     *bool   `json:"passkey_enabled"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		fail(c, http.StatusBadRequest, "invalid json")
		return
	}
	if input.TurnstileEnabled != nil {
		settings.TurnstileEnabled = *input.TurnstileEnabled
	}
	if input.TurnstileSiteKey != nil {
		settings.TurnstileSiteKey = strings.TrimSpace(*input.TurnstileSiteKey)
	}
	if input.TurnstileSecretKey != nil {
		if *input.TurnstileSecretKey != "***" {
			settings.TurnstileSecretKey = strings.TrimSpace(*input.TurnstileSecretKey)
		}
	}
	if input.PasskeyEnabled != nil {
		settings.PasskeyEnabled = *input.PasskeyEnabled
	}
	if settings.TurnstileEnabled && (settings.TurnstileSiteKey == "" || settings.TurnstileSecretKey == "") {
		fail(c, http.StatusBadRequest, "turnstile site key and secret key are required when turnstile is enabled")
		return
	}
	if err := h.DB.Save(settings).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	h.audit("login_settings.patch", actor(c), "login-settings", "")
	ok(c, loginSettingsDTO(settings))
}

func loginSettingsDTO(settings *models.LoginSettings) gin.H {
	secretKey := ""
	if settings.TurnstileSecretKey != "" {
		secretKey = "***"
	}
	return gin.H{
		"id":                   settings.ID,
		"turnstile_enabled":    settings.TurnstileEnabled,
		"turnstile_site_key":   settings.TurnstileSiteKey,
		"turnstile_secret_key": secretKey,
		"passkey_enabled":      settings.PasskeyEnabled,
		"updated_at":           settings.UpdatedAt,
	}
}
