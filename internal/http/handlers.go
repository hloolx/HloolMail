package httpapi

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"strconv"
	"strings"
	"time"

	"gptmail/internal/db"
	domaindb "gptmail/internal/domain"
	"gptmail/internal/mailhtml"
	"gptmail/internal/models"
	"gptmail/internal/version"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const rootReadyDomainSQL = "mode = ? AND active = ? AND mx_verified = ?"

func rootReadyDomainArgs(mode string) []interface{} {
	return []interface{}{mode, true, true}
}

func publicReadyDomainArgs() []interface{} {
	return rootReadyDomainArgs(models.DomainModePublic)
}

func publicReadyDomainQuery(query *gorm.DB) *gorm.DB {
	return query.Where(rootReadyDomainSQL, publicReadyDomainArgs()...)
}

func privateReadyDomainQuery(query *gorm.DB) *gorm.DB {
	return query.Where(rootReadyDomainSQL, rootReadyDomainArgs(models.DomainModePrivate)...)
}

func ownerRootReadyPublicDomainQuery(query *gorm.DB, ownerID uint) *gorm.DB {
	args := append([]interface{}{ownerID}, publicReadyDomainArgs()...)
	return query.Where("owner_id = ? AND "+rootReadyDomainSQL, args...)
}

func visibleDomainsForOwner(query *gorm.DB, ownerID uint) *gorm.DB {
	args := append([]interface{}{ownerID}, publicReadyDomainArgs()...)
	return query.Where("owner_id = ? OR ("+rootReadyDomainSQL+")", args...)
}

type requestActor struct {
	User   *models.User
	APIKey *models.APIKey
	Global bool
}

func (h *Handler) currentActor(c *gin.Context) *requestActor {
	if key := currentAPIKey(c); key != nil {
		return &requestActor{
			User:   currentAPIKeyUser(c),
			APIKey: key,
			Global: key.OwnerID == nil,
		}
	}
	if user := currentUser(c); user != nil {
		return &requestActor{User: user}
	}
	return nil
}

func (h *Handler) requireActor(c *gin.Context) (*requestActor, bool) {
	actor := h.currentActor(c)
	if actor == nil {
		fail(c, http.StatusUnauthorized, "login or api key required")
		return nil, false
	}
	return actor, true
}

func (a *requestActor) isAdmin() bool {
	return a != nil && (a.Global || (a.User != nil && a.User.Role == models.UserRoleAdmin))
}

func (a *requestActor) ownerID() (uint, bool) {
	if a == nil || a.User == nil {
		return 0, false
	}
	return a.User.ID, true
}

func (a *requestActor) name() string {
	if a == nil {
		return "system"
	}
	if a.User != nil {
		return a.User.Email
	}
	if a.APIKey != nil {
		return a.APIKey.KeyPrefix
	}
	return "system"
}

func (h *Handler) health(c *gin.Context) {
	ok(c, gin.H{"status": "ok", "time": time.Now().Format(time.RFC3339)})
}

func (h *Handler) versionInfo(c *gin.Context) {
	ok(c, gin.H{
		"version":   version.Version,
		"commit":    version.Commit,
		"buildTime": version.BuildTime,
	})
}

func (h *Handler) versionCheck(c *gin.Context) {
	currentVersion := version.Version

	latestVersion := currentVersion
	updateAvailable := false
	releaseURL := ""

	req, err := http.NewRequestWithContext(c.Request.Context(), "GET", "https://api.github.com/repos/hloolx/HloolMail/releases/latest", nil)
	if err == nil {
		req.Header.Set("Accept", "application/vnd.github+json")
		req.Header.Set("User-Agent", "hloolmail-version-check")
		resp, fetchErr := http.DefaultClient.Do(req)
		if fetchErr == nil {
			defer resp.Body.Close()
			if resp.StatusCode == 200 {
				var release struct {
					TagName string `json:"tag_name"`
					HTMLURL string `json:"html_url"`
				}
				if json.NewDecoder(resp.Body).Decode(&release) == nil && release.TagName != "" {
					tagVersion := strings.TrimPrefix(release.TagName, "v")
					if tagVersion != "" && tagVersion != currentVersion && currentVersion != "dev" {
						latestVersion = tagVersion
						updateAvailable = true
						releaseURL = release.HTMLURL
					} else if tagVersion != "" {
						latestVersion = tagVersion
					}
				}
			}
		}
	}

	ok(c, gin.H{
		"currentVersion":  currentVersion,
		"latestVersion":   latestVersion,
		"updateAvailable": updateAvailable,
		"releaseURL":      releaseURL,
	})
}

func (h *Handler) stats(c *gin.Context) {
	actor, allowed := h.requireActor(c)
	if !allowed {
		return
	}
	scope := h.scopeMessages(actor)
	domainScope := h.scopeDomains(actor)
	var messages, domains, apiKeys, mailboxes, publicDomains, apiUsageToday int64
	scope.Count(&messages)
	domainScope.Count(&domains)
	publicReadyDomainQuery(domainScope.Session(&gorm.Session{})).Count(&publicDomains)
	h.scopeAPIKeys(actor).Count(&apiKeys)
	scope.Session(&gorm.Session{}).Distinct("recipient").Count(&mailboxes)
	h.scopeAPIUsage(actor).Where("created_at >= ?", startOfDay(time.Now())).Count(&apiUsageToday)
	data := gin.H{
		"messages":        messages,
		"domains":         domains,
		"api_keys":        apiKeys,
		"mailboxes":       mailboxes,
		"public_domains":  publicDomains,
		"api_calls_today": apiUsageToday,
	}
	if currentAPIKey(c) == nil {
		var visibleDomains []models.Domain
		if err := domainScope.Session(&gorm.Session{}).Order("domain asc").Find(&visibleDomains).Error; err != nil {
			fail(c, http.StatusInternalServerError, err.Error())
			return
		}
		data["domain_list"] = availableDomainDTOsWithCountsOrEmpty(h.DB, visibleDomains)
		webOK(c, data)
		return
	}
	publicOK(c, data)
}

func (h *Handler) statsTimeseries(c *gin.Context) {
	user, loggedIn := h.requireLogin(c)
	if !loggedIn {
		return
	}
	actor := &requestActor{User: user}
	days := parseLimit(c.Query("days"), 7, 30)
	if days < 2 {
		days = 7
	}
	now := time.Now()
	today := startOfDay(now)
	labels := make([]string, days)
	messages := make([]int64, days)
	apiCalls := make([]int64, days)
	domains := make([]int64, days)
	earliest := today.AddDate(0, 0, -(days - 1))

	messageScope := h.scopeMessages(actor)
	apiScope := h.scopeAPIUsage(actor)
	domainScope := h.scopeDomains(actor)

	var totalDomainsBeforeWindow int64
	domainScope.Session(&gorm.Session{}).Where("created_at < ?", earliest).Count(&totalDomainsBeforeWindow)
	runningDomains := totalDomainsBeforeWindow

	for i := 0; i < days; i++ {
		dayStart := earliest.AddDate(0, 0, i)
		dayEnd := dayStart.AddDate(0, 0, 1)
		labels[i] = dayStart.Format("2006-01-02")
		var msgCount, apiCount, domainAdded int64
		messageScope.Session(&gorm.Session{}).Where("created_at >= ? AND created_at < ?", dayStart, dayEnd).Count(&msgCount)
		apiScope.Session(&gorm.Session{}).Where("created_at >= ? AND created_at < ?", dayStart, dayEnd).Count(&apiCount)
		domainScope.Session(&gorm.Session{}).Where("created_at >= ? AND created_at < ?", dayStart, dayEnd).Count(&domainAdded)
		runningDomains += domainAdded
		messages[i] = msgCount
		apiCalls[i] = apiCount
		domains[i] = runningDomains
	}
	ok(c, gin.H{
		"days":      labels,
		"messages":  messages,
		"domains":   domains,
		"api_calls": apiCalls,
	})
}

func (h *Handler) scopeMessages(actor *requestActor) *gorm.DB {
	query := h.DB.Model(&models.Message{})
	if actor == nil || actor.isAdmin() {
		return query
	}
	ownerID, ok := actor.ownerID()
	if !ok {
		return query.Where("1 = 0")
	}
	return h.scopeOwnedMessages(query, ownerID)
}

func (h *Handler) scopeDomains(actor *requestActor) *gorm.DB {
	query := h.DB.Model(&models.Domain{})
	if actor == nil || actor.isAdmin() {
		return query
	}
	ownerID, ok := actor.ownerID()
	if !ok {
		return publicReadyDomainQuery(query)
	}
	return visibleDomainsForOwner(query, ownerID)
}

func (h *Handler) scopeAPIKeys(actor *requestActor) *gorm.DB {
	query := h.DB.Model(&models.APIKey{})
	if actor == nil || actor.isAdmin() {
		return query
	}
	ownerID, ok := actor.ownerID()
	if !ok {
		return query.Where("1 = 0")
	}
	return query.Where("owner_id = ?", ownerID)
}

func (h *Handler) scopeAPIUsage(actor *requestActor) *gorm.DB {
	query := h.DB.Model(&models.APIUsageLog{})
	if actor == nil || actor.isAdmin() {
		return query
	}
	if actor.APIKey != nil {
		return query.Where("api_key_id = ?", actor.APIKey.ID)
	}
	ownerID, ok := actor.ownerID()
	if !ok {
		return query.Where("1 = 0")
	}
	return query.Where("user_id = ?", ownerID)
}

func (h *Handler) adminStats(c *gin.Context) {
	if !h.requireAdmin(c) {
		return
	}
	var totalMessages, activeDomains, failedDomains, pendingDomains, totalDomains, usageToday int64
	var users, enabledUsers, disabledUsers, apiKeys, activeAPIKeys, disabledAPIKeys, staleDomains int64
	h.DB.Model(&models.Message{}).Count(&totalMessages)
	h.DB.Model(&models.Domain{}).Count(&totalDomains)
	h.DB.Model(&models.Domain{}).Where("active = ?", true).Count(&activeDomains)
	h.DB.Model(&models.Domain{}).Where("active = ? AND mx_verified = ?", true, false).Count(&failedDomains)
	h.DB.Model(&models.Domain{}).Where("active = ? AND first_verified_at IS NULL AND pending_delete_at IS NOT NULL", true).Count(&pendingDomains)
	h.DB.Model(&models.Domain{}).Where("last_mx_check_at IS NULL OR last_mx_check_at < ?", time.Now().Add(-24*time.Hour)).Count(&staleDomains)
	h.DB.Model(&models.User{}).Count(&users)
	h.DB.Model(&models.User{}).Where("enabled = ?", true).Count(&enabledUsers)
	h.DB.Model(&models.User{}).Where("enabled = ?", false).Count(&disabledUsers)
	h.DB.Model(&models.APIKey{}).Count(&apiKeys)
	h.DB.Model(&models.APIKey{}).Where("enabled = ?", true).Count(&activeAPIKeys)
	h.DB.Model(&models.APIKey{}).Where("enabled = ?", false).Count(&disabledAPIKeys)
	h.DB.Model(&models.APIUsageLog{}).Where("created_at >= ?", startOfDay(time.Now())).Count(&usageToday)
	ok(c, gin.H{
		"messages":                totalMessages,
		"total_domains":           totalDomains,
		"active_domains":          activeDomains,
		"failed_domains":          failedDomains,
		"pending_domains":         pendingDomains,
		"stale_domains":           staleDomains,
		"users":                   users,
		"enabled_users":           enabledUsers,
		"disabled_users":          disabledUsers,
		"api_keys":                apiKeys,
		"active_api_keys":         activeAPIKeys,
		"disabled_api_keys":       disabledAPIKeys,
		"api_usage_today":         usageToday,
		"dev_mode":                h.Config.DevMode,
		"admin_token_enabled":     h.Config.AdminToken != "",
		"admin_token_is_default":  h.Config.AdminToken == "dev-admin-token",
		"expected_mx":             h.Config.ExpectedMX,
		"message_retention_hours": int64(h.Config.MessageRetention / time.Hour),
	})
}

type generateEmailRequest struct {
	Prefix string          `json:"prefix"`
	Domain string          `json:"domain"`
	Share  json.RawMessage `json:"share"`
}

type generateEmailShareOptions struct {
	Enabled   bool
	ExpiresAt *time.Time
}

type generateEmailShareDTO struct {
	ID           uint       `json:"id"`
	ResourceType string     `json:"resource_type"`
	Token        string     `json:"token,omitempty"`
	Key          string     `json:"key,omitempty"`
	TokenPrefix  string     `json:"token_prefix"`
	URL          string     `json:"url"`
	AccessURL    string     `json:"access_url"`
	ExpiresAt    *time.Time `json:"expires_at,omitempty"`
}

func (h *Handler) generateEmail(c *gin.Context) {
	actor, allowed := h.requireActor(c)
	if !allowed {
		return
	}
	if currentAPIKey(c) == nil && !h.consumeUserQuota(c) {
		return
	}
	var input generateEmailRequest
	if err := c.ShouldBindJSON(&input); err != nil && !errors.Is(err, io.EOF) {
		fail(c, http.StatusBadRequest, "invalid json")
		return
	}
	shareOptions, err := parseGenerateEmailShareOptions(input.Share)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	d, err := h.selectDomainForActor(input.Domain, actor)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	ownerID, err := h.mailboxOwnerID(actor)
	if err != nil {
		fail(c, http.StatusForbidden, err.Error())
		return
	}
	local := sanitizeLocal(input.Prefix)
	maxRetries := 10
	if local == "" {
		maxRetries = 10
	}
	attempt := 0
	for {
		if local == "" {
			local = randomLocal()
		}
		email := local + "@" + d.Domain
		host := d.Domain
		var existing models.Mailbox
		err := h.DB.Where("email = ?", email).First(&existing).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			shareDraft, err := newPendingMailboxShare(shareOptions)
			if err != nil {
				fail(c, http.StatusInternalServerError, err.Error())
				return
			}
			mailbox, link, err := h.createMailboxWithAccounting(ownerID, d, email, local, host, actor, shareDraft)
			if err != nil {
				if isUniqueConstraintError(err) {
					attempt++
					if attempt >= maxRetries {
						fail(c, http.StatusConflict, "email address already in use; change the prefix or generate a random address")
						return
					}
					local = ""
					continue
				}
				var httpErr httpStatusError
				if errors.As(err, &httpErr) {
					fail(c, httpErr.Status, httpErr.Message)
					return
				}
				fail(c, http.StatusInternalServerError, err.Error())
				return
			}
			h.audit("mailbox.create", actor.name(), email, "")
			created(c, h.generateEmailResponse(c, mailbox, d, false, link, shareDraft))
			return
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) && err != nil {
			fail(c, http.StatusInternalServerError, err.Error())
			return
		}
		if existing.OwnerID == ownerID || actor.isAdmin() {
			var link *models.ShareLink
			var token string
			var accessKey string
			if shareOptions.Enabled {
				createdLink, createdToken, createdAccessKey, err := h.createMailboxShare(existing, shareOptions.ExpiresAt)
				if err != nil {
					fail(c, http.StatusInternalServerError, err.Error())
					return
				}
				link = createdLink
				token = createdToken
				accessKey = createdAccessKey
			}
			h.audit("mailbox.reuse", actor.name(), email, "")
			ok(c, h.generateEmailResponseWithShare(c, existing, d, true, link, token, accessKey))
			return
		}
		attempt++
		if attempt >= maxRetries {
			fail(c, http.StatusConflict, "邮箱地址已被占用，请更换前缀或先随机生成")
			return
		}
		local = ""
	}
}

func parseGenerateEmailShareOptions(raw json.RawMessage) (generateEmailShareOptions, error) {
	value := strings.TrimSpace(string(raw))
	if value == "" || value == "null" {
		return generateEmailShareOptions{}, nil
	}
	var enabled bool
	if err := json.Unmarshal(raw, &enabled); err == nil {
		return generateEmailShareOptions{Enabled: enabled}, nil
	}
	var input struct {
		Enabled   *bool  `json:"enabled"`
		ExpiresAt string `json:"expires_at"`
	}
	if err := json.Unmarshal(raw, &input); err != nil {
		return generateEmailShareOptions{}, fmt.Errorf("share must be a boolean or object")
	}
	enabled = true
	if input.Enabled != nil {
		enabled = *input.Enabled
	}
	expiresAt, err := parseShareExpiresAt(input.ExpiresAt, true)
	if err != nil {
		return generateEmailShareOptions{}, err
	}
	return generateEmailShareOptions{Enabled: enabled, ExpiresAt: expiresAt}, nil
}

type pendingMailboxShare struct {
	Token         string
	AccessKey     string
	TokenHash     string
	TokenPrefix   string
	AccessKeyHash string
	ExpiresAt     *time.Time
}

func newPendingMailboxShare(options generateEmailShareOptions) (*pendingMailboxShare, error) {
	if !options.Enabled {
		return nil, nil
	}
	token, prefix, tokenHash, err := newShareToken()
	if err != nil {
		return nil, err
	}
	accessKey, accessKeyHash, err := newShareAccessKey()
	if err != nil {
		return nil, err
	}
	return &pendingMailboxShare{
		Token:         token,
		AccessKey:     accessKey,
		TokenHash:     tokenHash,
		TokenPrefix:   prefix,
		AccessKeyHash: accessKeyHash,
		ExpiresAt:     options.ExpiresAt,
	}, nil
}

func (h *Handler) generateEmailResponse(c *gin.Context, mailbox models.Mailbox, domain *models.Domain, reuse bool, link *models.ShareLink, share *pendingMailboxShare) gin.H {
	token := ""
	accessKey := ""
	if share != nil {
		token = share.Token
		accessKey = share.AccessKey
	}
	return h.generateEmailResponseWithShare(c, mailbox, domain, reuse, link, token, accessKey)
}

func (h *Handler) generateEmailResponseWithShare(c *gin.Context, mailbox models.Mailbox, domain *models.Domain, reuse bool, link *models.ShareLink, token, accessKey string) gin.H {
	out := gin.H{"email": mailbox.Email, "domain_id": domain.ID, "domain": domain}
	if reuse {
		out["reuse"] = true
	}
	if link != nil {
		out["share"] = h.generateEmailShareDTO(c, *link, token, accessKey)
	}
	return out
}

func (h *Handler) generateEmailShareDTO(c *gin.Context, link models.ShareLink, token, accessKey string) generateEmailShareDTO {
	shareURL := h.shareWebURL(c, token)
	return generateEmailShareDTO{
		ID:           link.ID,
		ResourceType: link.ResourceType,
		Token:        token,
		Key:          accessKey,
		TokenPrefix:  link.TokenPrefix,
		URL:          shareURL,
		AccessURL:    shareAccessURL(shareURL, accessKey),
		ExpiresAt:    link.ExpiresAt,
	}
}

func (h *Handler) listEmails(c *gin.Context) {
	parts, d, allowed := h.authorizeInbox(c, c.Query("email"))
	if !allowed {
		return
	}
	if currentAPIKey(c) == nil && !h.consumeUserQuota(c) {
		return
	}
	messageQuery, err := h.scopeInboxMessages(h.DB.Model(&models.Message{}), h.currentActor(c), parts.Recipient, d)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	paged := c.Query("page") != "" || c.Query("per_page") != ""
	if paged {
		page := parsePage(c.Query("page"))
		perPage := parseLimit(c.Query("per_page"), 10, 100)
		var total int64
		if err := messageQuery.Session(&gorm.Session{}).Count(&total).Error; err != nil {
			fail(c, http.StatusInternalServerError, err.Error())
			return
		}
		totalPages := pageCount(total, perPage)
		if page > totalPages {
			page = totalPages
		}
		var messages []models.Message
		if err := messageQuery.Session(&gorm.Session{}).
			Order("created_at desc").
			Limit(perPage).
			Offset((page - 1) * perPage).
			Find(&messages).Error; err != nil {
			fail(c, http.StatusInternalServerError, err.Error())
			return
		}
		summaries, err := h.messageSummariesWithAttachmentCounts(messages)
		if err != nil {
			fail(c, http.StatusInternalServerError, err.Error())
			return
		}
		ok(c, paginatedResponse[messageSummary]{
			Items:      summaries,
			Page:       page,
			PerPage:    perPage,
			Total:      total,
			TotalPages: totalPages,
		})
		return
	}
	limit := parseLimit(c.Query("limit"), 50, 200)
	var messages []models.Message
	if err := messageQuery.
		Order("created_at desc").
		Limit(limit).
		Find(&messages).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	summaries, err := h.messageSummariesWithAttachmentCounts(messages)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	ok(c, summaries)
}

func (h *Handler) nextEmail(c *gin.Context) {
	parts, d, allowed := h.authorizeInbox(c, c.Query("email"))
	if !allowed {
		return
	}
	if currentAPIKey(c) == nil && !h.consumeUserQuota(c) {
		return
	}
	messageQuery, err := h.scopeInboxMessages(h.DB.Model(&models.Message{}), h.currentActor(c), parts.Recipient, d)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	for attempt := 0; attempt < 5; attempt++ {
		var msg models.Message
		err := messageQuery.Session(&gorm.Session{}).Where("seen = ?", false).
			Order("created_at desc").
			First(&msg).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			ok(c, gin.H{"has_email": false, "message": nil})
			return
		}
		if err != nil {
			fail(c, http.StatusInternalServerError, err.Error())
			return
		}
		result := h.DB.Model(&models.Message{}).
			Where("id = ? AND seen = ?", msg.ID, false).
			Update("seen", true)
		if result.Error != nil {
			fail(c, http.StatusInternalServerError, result.Error.Error())
			return
		}
		if result.RowsAffected == 0 {
			continue
		}
		msg.Seen = true
		msg.HTMLContent = mailhtml.Sanitize(msg.HTMLContent)
		attachments, err := h.attachmentMetadataForMessage(msg.ID)
		if err != nil {
			fail(c, http.StatusInternalServerError, err.Error())
			return
		}
		ok(c, gin.H{"has_email": true, "message": nextEmailMessageDTO{
			Message:         msg,
			AttachmentCount: int64(len(attachments)),
			Attachments:     attachments,
		}})
		return
	}
	ok(c, gin.H{"has_email": false, "message": nil})
}

func (h *Handler) getEmail(c *gin.Context) {
	var msg models.Message
	if err := h.DB.First(&msg, "id = ?", c.Param("id")).Error; err != nil {
		fail(c, http.StatusNotFound, "message not found")
		return
	}
	if _, _, allowed := h.authorizeInbox(c, msg.Recipient); !allowed {
		return
	}
	canAccess, err := h.actorCanAccessMessage(h.currentActor(c), msg)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	if !canAccess {
		fail(c, http.StatusNotFound, "message not found")
		return
	}
	msg.HTMLContent = mailhtml.Sanitize(msg.HTMLContent)
	attachments, err := h.attachmentMetadataForMessage(msg.ID)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	if currentAPIKey(c) != nil {
		publicOK(c, publicMessageDetail(msg, attachments))
		return
	}
	webOK(c, webMessageDetail(msg, attachments))
}

func (h *Handler) markEmailRead(c *gin.Context) {
	var msg models.Message
	if err := h.DB.First(&msg, "id = ?", c.Param("id")).Error; err != nil {
		fail(c, http.StatusNotFound, "message not found")
		return
	}
	if _, _, allowed := h.authorizeInbox(c, msg.Recipient); !allowed {
		return
	}
	canAccess, err := h.actorCanAccessMessage(h.currentActor(c), msg)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	if !canAccess {
		fail(c, http.StatusNotFound, "message not found")
		return
	}
	if err := h.DB.Model(&msg).Update("seen", true).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	ok(c, gin.H{"id": msg.ID, "seen": true})
}

func (h *Handler) deleteEmail(c *gin.Context) {
	var msg models.Message
	if err := h.DB.First(&msg, "id = ?", c.Param("id")).Error; err != nil {
		fail(c, http.StatusNotFound, "message not found")
		return
	}
	if _, _, allowed := h.authorizeInbox(c, msg.Recipient); !allowed {
		return
	}
	canAccess, err := h.actorCanAccessMessage(h.currentActor(c), msg)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	if !canAccess {
		fail(c, http.StatusNotFound, "message not found")
		return
	}
	if err := h.DB.Transaction(func(tx *gorm.DB) error {
		messageQuery := tx.Model(&models.Message{}).Where("id = ?", msg.ID)
		if err := deleteMessageDependentsForQuery(tx, messageQuery); err != nil {
			return err
		}
		return tx.Unscoped().Delete(&msg).Error
	}); err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	ok(c, gin.H{"deleted": true})
}

func (h *Handler) clearEmails(c *gin.Context) {
	parts, d, allowed := h.authorizeInbox(c, c.Query("email"))
	if !allowed {
		return
	}
	if err := h.DB.Transaction(func(tx *gorm.DB) error {
		messageQuery, err := h.scopeInboxMessages(tx.Model(&models.Message{}), h.currentActor(c), parts.Recipient, d)
		if err != nil {
			return err
		}
		if err := deleteMessageDependentsForQuery(tx, messageQuery); err != nil {
			return err
		}
		return messageQuery.Unscoped().Delete(&models.Message{}).Error
	}); err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	ok(c, gin.H{"cleared": true})
}

func (h *Handler) inboxStream(c *gin.Context) {
	user, loggedIn := h.requireLogin(c)
	if !loggedIn {
		return
	}
	parts, _, allowed := h.authorizeInboxForUser(c, c.Query("email"), user)
	if !allowed {
		return
	}
	if h.Hub == nil {
		fail(c, http.StatusServiceUnavailable, "inbox stream unavailable")
		return
	}
	ch, cancel := h.Hub.Subscribe(parts.Recipient)
	defer cancel()
	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.Header().Set("Connection", "keep-alive")
	c.Writer.Header().Set("X-Accel-Buffering", "no")
	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		fail(c, http.StatusInternalServerError, "streaming unsupported")
		return
	}
	fmt.Fprint(c.Writer, ": connected\n\n")
	flusher.Flush()
	ticker := time.NewTicker(25 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-c.Request.Context().Done():
			return
		case <-ticker.C:
			fmt.Fprint(c.Writer, ": heartbeat\n\n")
			flusher.Flush()
		case event := <-ch:
			c.SSEvent("message", event)
			flusher.Flush()
		}
	}
}

func (h *Handler) requestDomain(c *gin.Context) {
	user, loggedIn := h.requireLogin(c)
	if !loggedIn {
		return
	}
	var input struct {
		Domain          string `json:"domain"`
		Mode            string `json:"mode"`
		WildcardEnabled *bool  `json:"wildcard_enabled"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		fail(c, http.StatusBadRequest, "invalid json")
		return
	}
	mode := input.Mode
	if mode != models.DomainModePublic && mode != models.DomainModePrivate {
		mode = models.DomainModePrivate
	}
	wildcard := true
	if input.WildcardEnabled != nil {
		wildcard = *input.WildcardEnabled
	}
	d, dns, err := h.upsertDomain(input.Domain, mode, wildcard, &user.ID, user.Email)
	if err != nil {
		if errors.Is(err, domaindb.ErrVerificationToken) {
			fail(c, http.StatusInternalServerError, err.Error())
			return
		}
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	created(c, gin.H{"domain": domainWithCount(h.DB, *d), "dns": dns})
}

func (h *Handler) batchRequestDomain(c *gin.Context) {
	user, loggedIn := h.requireLogin(c)
	if !loggedIn {
		return
	}
	var input struct {
		Domains []struct {
			Raw      string `json:"raw"`
			Domain   string `json:"domain"`
			Wildcard bool   `json:"wildcard"`
		} `json:"domains"`
		Mode string `json:"mode"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		fail(c, http.StatusBadRequest, "invalid json")
		return
	}
	mode := input.Mode
	if mode != models.DomainModePublic && mode != models.DomainModePrivate {
		mode = models.DomainModePrivate
	}
	if len(input.Domains) > 50 {
		input.Domains = input.Domains[:50]
	}
	type batchDomainItemResult struct {
		Raw          string                    `json:"raw"`
		Domain       string                    `json:"domain"`
		Status       string                    `json:"status"`
		DomainRecord *domainDTO                `json:"domain_record,omitempty"`
		DNS          *domaindb.DNSInstructions `json:"dns,omitempty"`
		Error        string                    `json:"error,omitempty"`
	}
	results := make([]batchDomainItemResult, 0, len(input.Domains))
	for _, item := range input.Domains {
		raw := strings.TrimSpace(item.Raw)
		candidate := strings.TrimSpace(item.Domain)
		if candidate == "" {
			candidate = raw
		}
		domainName := domaindb.NormalizeDomain(candidate)
		wildcard := item.Wildcard || domainWantsWildcard(raw) || domainWantsWildcard(candidate)
		result := batchDomainItemResult{
			Raw:    raw,
			Domain: domainName,
		}
		if domainName == "" || !strings.Contains(domainName, ".") {
			result.Status = "invalid"
			result.Error = "valid domain required"
			results = append(results, result)
			continue
		}
		var existing models.Domain
		lookupErr := h.DB.Where("domain = ?", domainName).First(&existing).Error
		if lookupErr != nil && !errors.Is(lookupErr, gorm.ErrRecordNotFound) {
			result.Status = "error"
			result.Error = lookupErr.Error()
			results = append(results, result)
			continue
		}
		if lookupErr == nil && existing.OwnerID != nil && *existing.OwnerID != user.ID {
			result.Status = "owned_by_other"
			result.Error = "domain is already owned by another user"
			results = append(results, result)
			continue
		}
		d, dns, err := h.upsertDomain(domainName, mode, wildcard, &user.ID, user.Email)
		if err != nil {
			result.Status = "error"
			result.Error = err.Error()
			results = append(results, result)
			continue
		}
		status := "created"
		if lookupErr == nil {
			status = "already_exists"
		}
		dto := domainWithCount(h.DB, *d)
		result.Status = status
		result.DomainRecord = &dto
		result.DNS = &dns
		results = append(results, result)
		h.scheduleDomainMXAutoRetry(*d)
	}
	created(c, gin.H{"results": results})
}

func (h *Handler) scheduleDomainMXAutoRetry(d models.Domain) {
	if !d.IsWaitingVerification() {
		return
	}
	if d.FirstVerifiedAt != nil || d.PendingDeleteAt == nil {
		return
	}
	now := time.Now()
	until := *d.PendingDeleteAt
	if !until.After(now) {
		return
	}
	if err := h.DB.Model(&models.Domain{}).Where("id = ? AND active = ?", d.ID, true).Updates(map[string]interface{}{
		"mx_auto_retry_enabled":    true,
		"mx_auto_retry_started_at": now,
		"mx_auto_retry_until":      until,
		"mx_auto_retry_next_at":    now,
		"mx_auto_retry_last_at":    nil,
		"mx_auto_retry_count":      0,
	}).Error; err != nil {
		return
	}
}

func (h *Handler) checkMX(c *gin.Context) {
	if _, loggedIn := h.requireLogin(c); !loggedIn {
		return
	}
	var input struct {
		Domain string `json:"domain"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		fail(c, http.StatusBadRequest, "invalid json")
		return
	}
	var d models.Domain
	if err := h.DB.Where("domain = ?", domaindb.NormalizeDomain(input.Domain)).First(&d).Error; err != nil {
		fail(c, http.StatusNotFound, "domain not found")
		return
	}
	if !h.canManageDomain(c, d) && !(d.Mode == models.DomainModePublic && d.IsRootMailboxReady()) {
		fail(c, http.StatusForbidden, "domain access denied")
		return
	}
	result, err := h.DNSChecker.Check(c.Request.Context(), d.Domain)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	ok(c, result)
}

func (h *Handler) listDomains(c *gin.Context) {
	user, loggedIn := h.requireLogin(c)
	if !loggedIn {
		return
	}
	actor := &requestActor{User: user}
	var domains []models.Domain
	query := h.scopeDomains(actor).Order("domain asc")
	if err := query.Find(&domains).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	ok(c, webDomainsWithCounts(h.DB, domains))
}

type availableDomainsResponse struct {
	Domains                 []string             `json:"domains"`
	PublicDomains           []availableDomainDTO `json:"public_domains"`
	PrivateDomains          []availableDomainDTO `json:"private_domains"`
	PublicUnavailableReason string               `json:"public_unavailable_reason,omitempty"`
}

func (h *Handler) availableDomains(c *gin.Context) {
	actor, allowed := h.requireActor(c)
	if !allowed {
		return
	}
	var publicDomains []models.Domain
	if err := publicReadyDomainQuery(h.DB.Order("domain asc")).Find(&publicDomains).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	publicDomains, publicUnavailableReason, err := h.filterAvailablePublicDomains(publicDomains, actor)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	privateQuery := privateReadyDomainQuery(h.DB.Order("domain asc"))
	if !actor.isAdmin() {
		ownerID, hasOwner := actor.ownerID()
		if !hasOwner {
			ok(c, availableDomainsResponse{
				Domains:                 domainNames(publicDomains),
				PublicDomains:           availableDomainDTOsWithCountsOrEmpty(h.DB, publicDomains),
				PrivateDomains:          []availableDomainDTO{},
				PublicUnavailableReason: publicUnavailableReason,
			})
			return
		}
		privateQuery = privateQuery.Where("owner_id = ?", ownerID)
	}
	var privateDomains []models.Domain
	if err := privateQuery.Find(&privateDomains).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	ok(c, availableDomainsResponse{
		Domains:                 domainNames(publicDomains),
		PublicDomains:           availableDomainDTOsWithCountsOrEmpty(h.DB, publicDomains),
		PrivateDomains:          availableDomainDTOsWithCountsOrEmpty(h.DB, privateDomains),
		PublicUnavailableReason: publicUnavailableReason,
	})
}

func (h *Handler) getDomain(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		fail(c, http.StatusNotFound, "domain not found")
		return
	}
	user, loggedIn := h.requireLogin(c)
	if !loggedIn {
		return
	}
	actor := &requestActor{User: user}
	var d models.Domain
	if err := h.DB.First(&d, "id = ?", id).Error; err != nil {
		fail(c, http.StatusNotFound, "domain not found")
		return
	}
	if !h.canViewDomain(actor, d) {
		fail(c, http.StatusForbidden, "domain access denied")
		return
	}
	ok(c, domainWithCount(h.DB, d))
}

func (h *Handler) patchDomain(c *gin.Context) {
	user := currentUser(c)
	adminByToken := user == nil && h.Config.AdminToken != "" && c.GetHeader("X-Admin-Token") == h.Config.AdminToken
	if user == nil && !adminByToken {
		fail(c, http.StatusUnauthorized, "login required")
		return
	}
	var d models.Domain
	if err := h.DB.First(&d, "id = ?", c.Param("id")).Error; err != nil {
		fail(c, http.StatusNotFound, "domain not found")
		return
	}
	isAdmin := adminByToken || (user != nil && user.Role == models.UserRoleAdmin)
	isOwner := user != nil && d.OwnerID != nil && *d.OwnerID == user.ID
	if !isAdmin && !isOwner {
		fail(c, http.StatusForbidden, "domain access denied")
		return
	}
	var input struct {
		Active          *bool  `json:"active"`
		MXVerified      *bool  `json:"mx_verified"`
		WildcardEnabled *bool  `json:"wildcard_enabled"`
		Mode            string `json:"mode"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		fail(c, http.StatusBadRequest, "invalid json")
		return
	}
	if isAdmin && input.Active != nil {
		d.Active = *input.Active
	}
	if isAdmin && input.MXVerified != nil {
		d.MXVerified = *input.MXVerified
	}
	if input.WildcardEnabled != nil {
		d.WildcardRequested = *input.WildcardEnabled
		if !*input.WildcardEnabled {
			d.WildcardEnabled = false
		}
	}
	if input.Mode == models.DomainModePublic || input.Mode == models.DomainModePrivate {
		d.Mode = input.Mode
	}
	applyDomainVerificationLifecycle(&d, time.Now(), false)
	if err := h.DB.Save(&d).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	h.audit("domain.patch", actor(c), d.Domain, "")
	ok(c, d)
}

func (h *Handler) setDomainMXAutoRetry(c *gin.Context) {
	var d models.Domain
	if err := h.DB.First(&d, "id = ?", c.Param("id")).Error; err != nil {
		fail(c, http.StatusNotFound, "domain not found")
		return
	}
	if !h.canManageDomain(c, d) {
		fail(c, http.StatusForbidden, "domain access denied")
		return
	}
	var input struct {
		Enabled bool `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		fail(c, http.StatusBadRequest, "invalid json")
		return
	}
	now := time.Now()
	if input.Enabled {
		if d.HasCompleteVerification() {
			fail(c, http.StatusBadRequest, "domain is already verified")
			return
		}
		var until time.Time
		if d.FirstVerifiedAt == nil {
			if d.PendingDeleteAt == nil {
				pendingDeleteAt := now.Add(models.PendingDomainTTL)
				d.PendingDeleteAt = &pendingDeleteAt
			}
			until = *d.PendingDeleteAt
		} else {
			until = now.Add(models.PendingDomainTTL)
		}
		if !until.After(now) {
			d.MXAutoRetryEnabled = false
			d.MXAutoRetryNextAt = nil
			d.LastHealthStatus = "unhealthy"
			d.LastUnhealthyAt = &now
			d.LastCheckMessage = "verification window has expired; domain was retained for safety"
			if err := h.DB.Save(&d).Error; err != nil {
				fail(c, http.StatusInternalServerError, err.Error())
				return
			}
			ok(c, domainWithCount(h.DB, d))
			return
		}
		next := now.Add(10 * time.Minute)
		if next.After(until) {
			next = until
		}
		d.MXAutoRetryEnabled = true
		d.MXAutoRetryStartedAt = &now
		d.MXAutoRetryUntil = &until
		d.MXAutoRetryNextAt = &next
		d.MXAutoRetryLastAt = nil
		d.MXAutoRetryCount = 0
		d.LastCheckMessage = "已开启后台等待验证，系统会每 10 分钟自动检测一次，最多等待 2 小时"
	} else {
		d.MXAutoRetryEnabled = false
		d.MXAutoRetryNextAt = nil
		d.LastCheckMessage = "已停止后台等待验证"
	}
	if err := h.DB.Save(&d).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	ok(c, domainWithCount(h.DB, d))
}

func (h *Handler) deleteDomain(c *gin.Context) {
	user := currentUser(c)
	adminByToken := user == nil && h.Config.AdminToken != "" && c.GetHeader("X-Admin-Token") == h.Config.AdminToken
	if user == nil && !adminByToken {
		fail(c, http.StatusUnauthorized, "login required")
		return
	}
	var d models.Domain
	if err := h.DB.First(&d, "id = ?", c.Param("id")).Error; err != nil {
		fail(c, http.StatusNotFound, "domain not found")
		return
	}
	isAdmin := adminByToken || (user != nil && user.Role == models.UserRoleAdmin)
	isOwner := user != nil && d.OwnerID != nil && *d.OwnerID == user.ID
	if !isAdmin && (!isOwner || !d.IsWaitingVerification()) {
		fail(c, http.StatusForbidden, "domain access denied")
		return
	}
	if err := h.DB.Transaction(func(tx *gorm.DB) error {
		var mailboxIDs []uint
		if err := tx.Model(&models.Mailbox{}).Where("domain_id = ?", d.ID).Pluck("id", &mailboxIDs).Error; err != nil {
			return err
		}
		if len(mailboxIDs) > 0 {
			mailboxShares := tx.Model(&models.ShareLink{}).Where("resource_type = ? AND mailbox_id IN ?", models.ShareResourceTypeMailbox, mailboxIDs)
			if err := tx.Where("share_link_id IN (?)", mailboxShares.Select("id")).Delete(&models.ShareLinkAccessLog{}).Error; err != nil {
				return err
			}
			if err := tx.Where("resource_type = ? AND mailbox_id IN ?", models.ShareResourceTypeMailbox, mailboxIDs).Delete(&models.ShareLink{}).Error; err != nil {
				return err
			}
		}
		messageQuery := tx.Model(&models.Message{}).Where("domain_id = ? OR (domain_id IS NULL AND root_domain = ?)", d.ID, d.Domain)
		if err := deleteDomainMessageDependentsForQuery(tx, messageQuery); err != nil {
			return err
		}
		if err := messageQuery.Unscoped().Delete(&models.Message{}).Error; err != nil {
			return err
		}
		endpoints := tx.Model(&models.WebhookEndpoint{}).Where("domain_id = ?", d.ID)
		if err := tx.Where("endpoint_id IN (?)", endpoints.Select("id")).Delete(&models.WebhookDelivery{}).Error; err != nil {
			return err
		}
		if err := tx.Where("domain_id = ?", d.ID).Delete(&models.WebhookEndpoint{}).Error; err != nil {
			return err
		}
		if err := tx.Where("domain_id = ?", d.ID).Delete(&models.Notification{}).Error; err != nil {
			return err
		}
		if err := tx.Where("domain_id = ?", d.ID).Delete(&models.Mailbox{}).Error; err != nil {
			return err
		}
		return tx.Delete(&d).Error
	}); err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	h.audit("domain.delete", actor(c), d.Domain, "")
	ok(c, gin.H{"deleted": true})
}

func (h *Handler) listAPIKeys(c *gin.Context) {
	user, loggedIn := h.requireLogin(c)
	if !loggedIn {
		return
	}
	var keys []models.APIKey
	query := h.DB.Order("created_at desc")
	if user.Role != models.UserRoleAdmin {
		query = query.Where("owner_id = ?", user.ID)
	}
	if err := query.Find(&keys).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	ok(c, keys)
}

func (h *Handler) createAPIKey(c *gin.Context) {
	user, loggedIn := h.requireLogin(c)
	if !loggedIn {
		return
	}
	var input struct {
		Name       string `json:"name"`
		DailyLimit *int64 `json:"daily_limit"`
		TotalLimit *int64 `json:"total_limit"`
		ExpiresAt  string `json:"expires_at"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		fail(c, http.StatusBadRequest, "invalid json")
		return
	}
	dailyLimit := h.Config.APIKeyDefaultDailyCap
	if input.DailyLimit != nil {
		dailyLimit = *input.DailyLimit
	}
	totalLimit := int64(0)
	if input.TotalLimit != nil {
		totalLimit = *input.TotalLimit
	}
	if dailyLimit < 0 || totalLimit < 0 {
		fail(c, http.StatusBadRequest, "quota limits must be zero or greater")
		return
	}
	expiresAt, err := parseAPIKeyExpiresAt(input.ExpiresAt)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	ownerID := &user.ID
	key, plain, err := h.APIKeys.CreateFor(ownerID, input.Name, dailyLimit, totalLimit, expiresAt)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	h.audit("api_key.create", actor(c), key.KeyPrefix, "")
	created(c, gin.H{"api_key": key, "plain_key": plain})
}

func (h *Handler) patchAPIKey(c *gin.Context) {
	user, loggedIn := h.requireLogin(c)
	if !loggedIn {
		return
	}
	var key models.APIKey
	if err := h.DB.First(&key, "id = ?", c.Param("id")).Error; err != nil {
		fail(c, http.StatusNotFound, "api key not found")
		return
	}
	if user.Role != models.UserRoleAdmin && (key.OwnerID == nil || *key.OwnerID != user.ID) {
		fail(c, http.StatusForbidden, "api key access denied")
		return
	}
	var input struct {
		Enabled    *bool  `json:"enabled"`
		Name       string `json:"name"`
		DailyLimit *int64 `json:"daily_limit"`
		TotalLimit *int64 `json:"total_limit"`
		ExpiresAt  string `json:"expires_at"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		fail(c, http.StatusBadRequest, "invalid json")
		return
	}
	if input.Enabled != nil {
		key.Enabled = *input.Enabled
	}
	if strings.TrimSpace(input.Name) != "" {
		key.Name = strings.TrimSpace(input.Name)
	}
	if input.DailyLimit != nil {
		if *input.DailyLimit < 0 {
			fail(c, http.StatusBadRequest, "daily_limit must be zero or greater")
			return
		}
		key.DailyLimit = *input.DailyLimit
	}
	if input.TotalLimit != nil {
		if *input.TotalLimit < 0 {
			fail(c, http.StatusBadRequest, "total_limit must be zero or greater")
			return
		}
		key.TotalLimit = *input.TotalLimit
	}
	if strings.TrimSpace(input.ExpiresAt) != "" {
		expiresAt, err := parseAPIKeyExpiresAt(input.ExpiresAt)
		if err != nil {
			fail(c, http.StatusBadRequest, err.Error())
			return
		}
		key.ExpiresAt = expiresAt
	}
	if err := h.DB.Save(&key).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	h.audit("api_key.patch", actor(c), key.KeyPrefix, "")
	ok(c, key)
}

func (h *Handler) deleteAPIKey(c *gin.Context) {
	user, loggedIn := h.requireLogin(c)
	if !loggedIn {
		return
	}
	var key models.APIKey
	if err := h.DB.First(&key, "id = ?", c.Param("id")).Error; err != nil {
		fail(c, http.StatusNotFound, "api key not found")
		return
	}
	if user.Role != models.UserRoleAdmin && (key.OwnerID == nil || *key.OwnerID != user.ID) {
		fail(c, http.StatusForbidden, "api key access denied")
		return
	}
	if err := h.DB.Delete(&key).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	h.audit("api_key.delete", actor(c), key.KeyPrefix, "")
	ok(c, gin.H{"deleted": true})
}

func (h *Handler) revealAPIKey(c *gin.Context) {
	user, loggedIn := h.requireLogin(c)
	if !loggedIn {
		return
	}
	if currentAPIKey(c) != nil {
		fail(c, http.StatusForbidden, "api key auth not allowed for this endpoint")
		return
	}
	var key models.APIKey
	if err := h.DB.First(&key, "id = ?", c.Param("id")).Error; err != nil {
		fail(c, http.StatusNotFound, "api key not found")
		return
	}
	if user.Role != models.UserRoleAdmin && (key.OwnerID == nil || *key.OwnerID != user.ID) {
		fail(c, http.StatusForbidden, "api key access denied")
		return
	}
	h.audit("api_key.reveal", actor(c), key.KeyPrefix, "")
	ok(c, gin.H{"plain_key": key.KeyValue})
}

func parseAPIKeyExpiresAt(value string) (*time.Time, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, nil
	}
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return nil, fmt.Errorf("expires_at must be an RFC3339 time")
	}
	if !parsed.After(time.Now()) {
		return nil, fmt.Errorf("expires_at must be in the future")
	}
	return &parsed, nil
}

func (h *Handler) authorizeInbox(c *gin.Context, email string) (domaindb.RecipientParts, *models.Domain, bool) {
	parts, err := domaindb.NormalizeRecipient(email)
	if err != nil {
		fail(c, http.StatusBadRequest, "valid email required")
		return parts, nil, false
	}
	actor, allowed := h.requireActor(c)
	if !allowed {
		return parts, nil, false
	}
	if actor.isAdmin() {
		return parts, nil, true
	}
	d, err := h.Resolver.ResolveDomain(parts.Recipient)
	if err != nil {
		fail(c, http.StatusNotFound, "domain not found or not verified")
		return parts, nil, false
	}
	allowedOwner, err := h.actorOwnsMessageRecipient(actor, parts.Recipient, d)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return parts, d, false
	}
	if allowedOwner {
		return parts, d, true
	}
	fail(c, http.StatusForbidden, "邮箱访问被拒：需要是邮箱所有者、域名所有者或使用有权限的 API key")
	return parts, d, false
}

func (h *Handler) authorizeInboxForUser(c *gin.Context, email string, user *models.User) (domaindb.RecipientParts, *models.Domain, bool) {
	parts, err := domaindb.NormalizeRecipient(email)
	if err != nil {
		fail(c, http.StatusBadRequest, "valid email required")
		return parts, nil, false
	}
	if user == nil {
		fail(c, http.StatusUnauthorized, "login required")
		return parts, nil, false
	}
	if user.Role == models.UserRoleAdmin {
		return parts, nil, true
	}
	d, err := h.Resolver.ResolveDomain(parts.Recipient)
	if err != nil {
		fail(c, http.StatusNotFound, "domain not found or not verified")
		return parts, nil, false
	}
	allowedOwner, err := h.userOwnsMessageRecipient(user, parts.Recipient, d)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return parts, d, false
	}
	if allowedOwner {
		return parts, d, true
	}
	fail(c, http.StatusForbidden, "邮箱访问被拒：需要是邮箱所有者或域名所有者")
	return parts, d, false
}

func (h *Handler) canManageDomain(c *gin.Context, d models.Domain) bool {
	user := currentUser(c)
	if user == nil {
		return false
	}
	if user.Role == models.UserRoleAdmin {
		return true
	}
	return d.OwnerID != nil && *d.OwnerID == user.ID
}

func (h *Handler) canViewDomain(actor *requestActor, d models.Domain) bool {
	if actor == nil {
		return false
	}
	if d.Mode == models.DomainModePublic && d.IsRootMailboxReady() {
		return true
	}
	if actor.isAdmin() {
		return true
	}
	ownerID, ok := actor.ownerID()
	return ok && d.OwnerID != nil && *d.OwnerID == ownerID
}

func (h *Handler) selectDomainForActor(input string, actor *requestActor) (*models.Domain, error) {
	domainName := domaindb.NormalizeDomain(input)
	if domainName != "" {
		var d models.Domain
		err := h.DB.Where("domain = ?", domainName).First(&d).Error
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, fmt.Errorf("域名不存在或当前 API key 无权使用该域名")
			}
			return nil, err
		}
		if !d.Active {
			return nil, fmt.Errorf("域名已停用")
		}
		if !d.MXVerified {
			return nil, fmt.Errorf("域名 MX 未验证")
		}
		if d.Mode == models.DomainModePrivate {
			if actor.isAdmin() {
				return &d, nil
			}
			if ownerID, ok := actor.ownerID(); ok && d.OwnerID != nil && *d.OwnerID == ownerID {
				return &d, nil
			}
			return nil, fmt.Errorf("该私有域名仅域名所有者或管理员可使用")
		}
		return &d, nil
	}
	var domains []models.Domain
	if err := publicReadyDomainQuery(h.DB.Order("domain asc")).Find(&domains).Error; err != nil {
		return nil, err
	}
	domains, _, err := h.filterAvailablePublicDomains(domains, actor)
	if err != nil {
		return nil, err
	}
	if len(domains) == 0 {
		return nil, fmt.Errorf("暂无可随机选择的公有域名；如需使用私有域名，请传入 domain")
	}
	index := randomIndex(len(domains))
	return &domains[index], nil
}

func (h *Handler) mailboxOwnerID(actor *requestActor) (uint, error) {
	if ownerID, ok := actor.ownerID(); ok {
		return ownerID, nil
	}
	if actor != nil && actor.Global {
		var admin models.User
		if err := h.DB.Where("role = ? AND enabled = ?", models.UserRoleAdmin, true).Order("id asc").First(&admin).Error; err == nil {
			return admin.ID, nil
		}
	}
	return 0, fmt.Errorf("api key must be bound to an active user to create mailboxes")
}

func (h *Handler) upsertDomain(rawDomain, mode string, wildcard bool, ownerID *uint, actorName string) (*models.Domain, domaindb.DNSInstructions, error) {
	if domainWantsWildcard(rawDomain) {
		wildcard = true
	}
	domainName := domaindb.NormalizeDomain(rawDomain)
	if domainName == "" || !strings.Contains(domainName, ".") {
		return nil, domaindb.DNSInstructions{}, fmt.Errorf("valid domain required")
	}
	var d models.Domain
	err := h.DB.Where("domain = ?", domainName).First(&d).Error
	now := time.Now()
	isNewDomain := false
	wasActive := false
	if errors.Is(err, gorm.ErrRecordNotFound) {
		verificationToken, err := domaindb.NewVerificationToken()
		if err != nil {
			return nil, domaindb.DNSInstructions{}, err
		}
		isNewDomain = true
		d = models.Domain{
			Domain:            domainName,
			Mode:              mode,
			Active:            true,
			MXVerified:        h.Config.DevMode && strings.HasSuffix(domainName, ".test"),
			WildcardEnabled:   wildcard && h.Config.DevMode && strings.HasSuffix(domainName, ".test"),
			WildcardRequested: wildcard,
			VerificationToken: verificationToken,
			OwnerID:           ownerID,
		}
	} else if err != nil {
		return nil, domaindb.DNSInstructions{}, err
	} else {
		wasActive = d.Active
		if ownerID != nil && d.OwnerID != nil && *d.OwnerID != *ownerID {
			return nil, domaindb.DNSInstructions{}, fmt.Errorf("domain is already owned by another user")
		}
		d.Mode = mode
		d.Active = true
		d.WildcardRequested = wildcard
		if !wildcard {
			d.WildcardEnabled = false
		}
		if ownerID != nil {
			d.OwnerID = ownerID
		}
		if d.VerificationToken == "" {
			verificationToken, err := domaindb.NewVerificationToken()
			if err != nil {
				return nil, domaindb.DNSInstructions{}, err
			}
			d.VerificationToken = verificationToken
		}
		if h.Config.DevMode && strings.HasSuffix(domainName, ".test") {
			d.MXVerified = true
			if wildcard {
				d.WildcardEnabled = true
			}
		}
	}
	applyDomainVerificationLifecycle(&d, now, isNewDomain || !wasActive)
	if d.ID == 0 {
		err = h.DB.Create(&d).Error
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			return nil, domaindb.DNSInstructions{}, fmt.Errorf("domain %s is already registered", domainName)
		}
	} else {
		err = h.DB.Save(&d).Error
	}
	if err != nil {
		return nil, domaindb.DNSInstructions{}, err
	}
	h.audit("domain.request", actorName, d.Domain, mode)
	dns := domaindb.Instructions(d.Domain, h.Config.ExpectedMX)
	return &d, dns, nil
}

func applyDomainVerificationLifecycle(d *models.Domain, now time.Time, allowPendingDelete bool) {
	if d.HasCompleteVerification() {
		if d.FirstVerifiedAt == nil {
			d.FirstVerifiedAt = &now
		}
		d.PendingDeleteAt = nil
		return
	}
	if d.FirstVerifiedAt != nil {
		d.PendingDeleteAt = nil
		return
	}
	if allowPendingDelete {
		pendingDeleteAt := now.Add(models.PendingDomainTTL)
		d.PendingDeleteAt = &pendingDeleteAt
	}
}

func domainWantsWildcard(rawDomain string) bool {
	return strings.HasPrefix(strings.TrimSpace(rawDomain), "*")
}

type availableDomainDTO struct {
	ID           uint   `json:"id"`
	Domain       string `json:"domain"`
	Mode         string `json:"mode"`
	MessageCount int64  `json:"message_count"`
}

type webDomainDTO struct {
	ID                uint       `json:"id"`
	Domain            string     `json:"domain"`
	Mode              string     `json:"mode"`
	OwnerID           *uint      `json:"owner_id,omitempty"`
	Active            bool       `json:"active"`
	MXVerified        bool       `json:"mx_verified"`
	WildcardEnabled   bool       `json:"wildcard_enabled"`
	WildcardRequested bool       `json:"wildcard_requested"`
	LastMXCheckAt     *time.Time `json:"last_mx_check_at,omitempty"`
	DomainExpiresAt   *time.Time `json:"domain_expires_at,omitempty"`
	MessageCount      int64      `json:"message_count"`
	FirstVerifiedAt   *time.Time `json:"first_verified_at,omitempty"`
	PendingDeleteAt   *time.Time `json:"pending_delete_at,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
}

type domainDTO struct {
	models.Domain
	MessageCount int64 `json:"message_count"`
}

func domainNames(domains []models.Domain) []string {
	if len(domains) == 0 {
		return []string{}
	}
	names := make([]string, 0, len(domains))
	for _, d := range domains {
		names = append(names, d.Domain)
	}
	return names
}

func messageCountsByDomain(db *gorm.DB, domains []models.Domain) map[string]int64 {
	if len(domains) == 0 {
		return map[string]int64{}
	}
	type countResult struct {
		RootDomain string
		Count      int64
	}
	var counts []countResult
	db.Model(&models.Message{}).
		Select("root_domain, COUNT(*) as count").
		Where("root_domain IN ?", domainNames(domains)).
		Group("root_domain").
		Scan(&counts)
	countMap := make(map[string]int64, len(counts))
	for _, c := range counts {
		countMap[c.RootDomain] = c.Count
	}
	return countMap
}

func availableDomainDTOsWithCountsOrEmpty(db *gorm.DB, domains []models.Domain) []availableDomainDTO {
	if len(domains) == 0 {
		return []availableDomainDTO{}
	}
	countMap := messageCountsByDomain(db, domains)
	out := make([]availableDomainDTO, 0, len(domains))
	for _, d := range domains {
		out = append(out, availableDomainDTO{
			ID:           d.ID,
			Domain:       d.Domain,
			Mode:         d.Mode,
			MessageCount: countMap[d.Domain],
		})
	}
	return out
}

func webDomainsWithCounts(db *gorm.DB, domains []models.Domain) []webDomainDTO {
	if len(domains) == 0 {
		return []webDomainDTO{}
	}
	countMap := messageCountsByDomain(db, domains)
	out := make([]webDomainDTO, 0, len(domains))
	for _, d := range domains {
		dto := webDomainDTO{
			ID:                d.ID,
			Domain:            d.Domain,
			Mode:              d.Mode,
			OwnerID:           d.OwnerID,
			Active:            d.Active,
			MXVerified:        d.MXVerified,
			WildcardEnabled:   d.WildcardEnabled,
			WildcardRequested: d.WildcardRequested,
			LastMXCheckAt:     d.LastMXCheckAt,
			DomainExpiresAt:   d.DomainExpiresAt,
			MessageCount:      countMap[d.Domain],
			FirstVerifiedAt:   d.FirstVerifiedAt,
			PendingDeleteAt:   d.PendingDeleteAt,
			CreatedAt:         d.CreatedAt,
			UpdatedAt:         d.UpdatedAt,
		}
		out = append(out, dto)
	}
	return out
}

func domainsWithCounts(db *gorm.DB, domains []models.Domain) []domainDTO {
	if len(domains) == 0 {
		return nil
	}
	countMap := messageCountsByDomain(db, domains)
	out := make([]domainDTO, 0, len(domains))
	for _, d := range domains {
		dto := domainDTO{Domain: d, MessageCount: countMap[d.Domain]}
		out = append(out, dto)
	}
	return out
}

func domainsWithCountsOrEmpty(db *gorm.DB, domains []models.Domain) []domainDTO {
	if len(domains) == 0 {
		return []domainDTO{}
	}
	return domainsWithCounts(db, domains)
}

func domainWithCount(db *gorm.DB, d models.Domain) domainDTO {
	var count int64
	db.Model(&models.Message{}).Where("root_domain = ?", d.Domain).Count(&count)
	dto := domainDTO{Domain: d, MessageCount: count}
	return dto
}

type paginatedResponse[T any] struct {
	Items      []T   `json:"items"`
	Page       int   `json:"page"`
	PerPage    int   `json:"per_page"`
	Total      int64 `json:"total"`
	TotalPages int   `json:"total_pages"`
}

func sanitizeLocal(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	var builder strings.Builder
	for _, r := range value {
		switch {
		case r >= 'a' && r <= 'z':
			builder.WriteRune(r)
		case r >= '0' && r <= '9':
			builder.WriteRune(r)
		case r == '.', r == '-', r == '_':
			builder.WriteRune(r)
		}
	}
	return strings.Trim(builder.String(), ".-_")
}

func randomLocal() string {
	buf := make([]byte, 6)
	if _, err := rand.Read(buf); err != nil {
		return "mail" + strconv.FormatInt(time.Now().UnixNano(), 36)
	}
	return "mail" + hex.EncodeToString(buf)
}

func randomIndex(length int) int {
	if length <= 1 {
		return 0
	}
	n, err := rand.Int(rand.Reader, big.NewInt(int64(length)))
	if err != nil {
		return int(time.Now().UnixNano() % int64(length))
	}
	return int(n.Int64())
}

func isUniqueConstraintError(err error) bool {
	if err == nil {
		return false
	}
	text := strings.ToLower(err.Error())
	return strings.Contains(text, "unique") || strings.Contains(text, "duplicate")
}

func parseLimit(value string, fallback, max int) int {
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return fallback
	}
	if parsed > max {
		return max
	}
	return parsed
}

func parsePage(value string) int {
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return 1
	}
	return parsed
}

func pageCount(total int64, perPage int) int {
	if total <= 0 || perPage <= 0 {
		return 1
	}
	pages := int((total + int64(perPage) - 1) / int64(perPage))
	if pages < 1 {
		return 1
	}
	return pages
}

func stripTags(value string) string {
	var builder strings.Builder
	inTag := false
	for _, r := range value {
		switch r {
		case '<':
			inTag = true
		case '>':
			inTag = false
		default:
			if !inTag {
				builder.WriteRune(r)
			}
		}
	}
	return builder.String()
}

func startOfDay(t time.Time) time.Time {
	y, m, d := t.Local().Date()
	return time.Date(y, m, d, 0, 0, 0, 0, t.Location())
}

func (h *Handler) listMailboxes(c *gin.Context) {
	actor, allowed := h.requireActor(c)
	if !allowed {
		return
	}
	var mailboxes []models.Mailbox
	query := h.DB.Model(&models.Mailbox{})
	if !actor.isAdmin() {
		ownerID, hasOwner := actor.ownerID()
		if !hasOwner {
			fail(c, http.StatusForbidden, "api key must be bound to an active user")
			return
		}
		query = query.Where("owner_id = ?", ownerID)
	}
	search := strings.ToLower(strings.TrimSpace(c.Query("q")))
	if search != "" {
		like := "%" + search + "%"
		query = query.Where("LOWER(email) LIKE ? OR LOWER(local_part) LIKE ? OR LOWER(host) LIKE ?", like, like, like)
	}
	paged := c.Query("page") != "" || c.Query("per_page") != "" || search != ""
	page := parsePage(c.Query("page"))
	perPage := parseLimit(c.Query("per_page"), 10, 50)
	total := int64(0)
	totalPages := 1
	if paged {
		if err := query.Session(&gorm.Session{}).Count(&total).Error; err != nil {
			fail(c, http.StatusInternalServerError, err.Error())
			return
		}
		totalPages = pageCount(total, perPage)
		if page > totalPages {
			page = totalPages
		}
		query = query.Limit(perPage).Offset((page - 1) * perPage)
	}
	if err := query.Order("created_at desc").Find(&mailboxes).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	type mailboxWithCount struct {
		models.Mailbox
		MessageCount  int64      `json:"message_count"`
		LastMessageAt *time.Time `json:"last_message_at,omitempty"`
	}
	out := make([]mailboxWithCount, 0, len(mailboxes))
	for _, m := range mailboxes {
		var count int64
		h.scopeInboxMessagesForMailbox(h.DB.Model(&models.Message{}), m).Count(&count)
		var lastMsg models.Message
		lastAt := new(time.Time)
		if err := h.scopeInboxMessagesForMailbox(h.DB.Model(&models.Message{}), m).Order("created_at desc").First(&lastMsg).Error; err == nil {
			*lastAt = lastMsg.CreatedAt
		} else {
			lastAt = nil
		}
		out = append(out, mailboxWithCount{
			Mailbox:       m,
			MessageCount:  count,
			LastMessageAt: lastAt,
		})
	}
	if paged {
		ok(c, paginatedResponse[mailboxWithCount]{
			Items:      out,
			Page:       page,
			PerPage:    perPage,
			Total:      total,
			TotalPages: totalPages,
		})
		return
	}
	ok(c, out)
}

func (h *Handler) deleteMailbox(c *gin.Context) {
	actor, allowed := h.requireActor(c)
	if !allowed {
		return
	}
	var mailbox models.Mailbox
	if err := h.DB.First(&mailbox, "id = ?", c.Param("id")).Error; err != nil {
		fail(c, http.StatusNotFound, "mailbox not found")
		return
	}
	ownerID, hasOwner := actor.ownerID()
	if !actor.isAdmin() && (!hasOwner || mailbox.OwnerID != ownerID) {
		fail(c, http.StatusForbidden, "mailbox access denied")
		return
	}
	var messagesDeleted int64
	if err := h.DB.Transaction(func(tx *gorm.DB) error {
		if err := deleteShareLinksForMailboxQuery(tx, mailbox.ID); err != nil {
			return err
		}
		messageQuery := tx.Model(&models.Message{}).Where("mailbox_id = ? OR (owner_id = ? AND recipient = ?) OR (owner_id IS NULL AND recipient = ?)", mailbox.ID, mailbox.OwnerID, mailbox.Email, mailbox.Email)
		if err := deleteMailboxMessageDependentsForQuery(tx, messageQuery); err != nil {
			return err
		}
		result := messageQuery.Unscoped().Delete(&models.Message{})
		if result.Error != nil {
			return result.Error
		}
		messagesDeleted = result.RowsAffected
		return tx.Delete(&mailbox).Error
	}); err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	h.audit("mailbox.delete", actor.name(), mailbox.Email, "")
	ok(c, gin.H{"deleted": true, "messages_deleted": messagesDeleted})
}

type httpStatusError struct {
	Status  int
	Message string
}

func (e httpStatusError) Error() string {
	return e.Message
}

func (h *Handler) createMailboxWithAccounting(ownerID uint, d *models.Domain, email, local, host string, actor *requestActor, share *pendingMailboxShare) (models.Mailbox, *models.ShareLink, error) {
	var mailbox models.Mailbox
	var link *models.ShareLink
	err := h.DB.Transaction(func(tx *gorm.DB) error {
		var freshDomain models.Domain
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&freshDomain, "id = ?", d.ID).Error; err != nil {
			return err
		}
		if !freshDomain.IsRootMailboxReady() {
			return httpStatusError{Status: http.StatusBadRequest, Message: "域名未激活或 MX 未验证"}
		}
		if freshDomain.Mode == models.DomainModePrivate && !actor.isAdmin() {
			if freshDomain.OwnerID == nil || *freshDomain.OwnerID != ownerID {
				return httpStatusError{Status: http.StatusForbidden, Message: "该域名是私有域名，只有域名的所有者才能使用"}
			}
		}
		mailbox = models.Mailbox{
			OwnerID:   ownerID,
			Email:     email,
			LocalPart: local,
			Host:      host,
			DomainID:  freshDomain.ID,
		}
		if err := tx.Create(&mailbox).Error; err != nil {
			return err
		}
		if err := h.applyMailboxAccounting(tx, ownerID, freshDomain, actor); err != nil {
			return err
		}
		if share != nil {
			createdLink := models.ShareLink{
				OwnerID:       mailbox.OwnerID,
				TokenHash:     share.TokenHash,
				TokenPrefix:   share.TokenPrefix,
				ResourceType:  models.ShareResourceTypeMailbox,
				MailboxID:     &mailbox.ID,
				AccessKeyHash: share.AccessKeyHash,
				ExpiresAt:     share.ExpiresAt,
			}
			if err := tx.Create(&createdLink).Error; err != nil {
				return err
			}
			link = &createdLink
		}
		*d = freshDomain
		return nil
	})
	if err != nil {
		return models.Mailbox{}, nil, err
	}
	return mailbox, link, nil
}

func (h *Handler) applyMailboxAccounting(tx *gorm.DB, userID uint, d models.Domain, actor *requestActor) error {
	if d.Mode == models.DomainModePublic {
		settings, err := db.EnsureSystemQuotaSettings(tx)
		if err != nil {
			return err
		}
		if !actor.isAdmin() {
			if err := h.enforcePublicMailboxRules(tx, userID, d, settings); err != nil {
				return err
			}
		}
		if err := incrementDomainMailboxCount(tx, d.ID, d, actor, settings); err != nil {
			return err
		}
		return incrementUserPublicMailboxCount(tx, userID, settings, !actor.isAdmin())
	}
	if err := tx.Model(&models.Domain{}).Where("id = ?", d.ID).Update("mailbox_created_count", gorm.Expr("mailbox_created_count + 1")).Error; err != nil {
		return err
	}
	return tx.Model(&models.User{}).Where("id = ?", userID).Update("private_mailbox_created", gorm.Expr("private_mailbox_created + 1")).Error
}

func (h *Handler) enforcePublicMailboxRules(tx *gorm.DB, userID uint, d models.Domain, settings *models.SystemQuotaSettings) error {
	if settings.RequirePublicDomainForQuota {
		hasPublicDomain, err := hasRootReadyPublicDomain(tx, userID)
		if err != nil {
			return err
		}
		if !hasPublicDomain {
			return httpStatusError{Status: http.StatusForbidden, Message: "需要先上传并验证公开域名后才可创建公开邮箱"}
		}
	}
	return nil
}

func incrementDomainMailboxCount(tx *gorm.DB, domainID uint, d models.Domain, actor *requestActor, settings *models.SystemQuotaSettings) error {
	isOwner := false
	if ownerID, ok := actor.ownerID(); ok {
		isOwner = d.OwnerID != nil && *d.OwnerID == ownerID
	}
	query := tx.Model(&models.Domain{}).Where("id = ?", domainID)
	if d.Mode == models.DomainModePublic && !actor.isAdmin() && !isOwner && settings.PublicDomainMailboxLimit > 0 {
		query = query.Where("mailbox_created_count < ?", settings.PublicDomainMailboxLimit)
	}
	result := query.Update("mailbox_created_count", gorm.Expr("mailbox_created_count + 1"))
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return httpStatusError{Status: http.StatusForbidden, Message: "该公开域名邮箱创建已达上限，仅域名所有者可使用"}
	}
	return nil
}

func incrementUserPublicMailboxCount(tx *gorm.DB, userID uint, settings *models.SystemQuotaSettings, enforceDailyLimit bool) error {
	today := time.Now().Format("2006-01-02")
	query := tx.Model(&models.User{}).Where("id = ? AND enabled = ?", userID, true)
	if enforceDailyLimit {
		if settings.UserDailyPublicMailboxLimit > 0 {
			query = query.Where("public_mailbox_date <> ? OR public_mailbox_today < ?", today, settings.UserDailyPublicMailboxLimit)
		}
		query = query.Where("daily_limit = 0 OR public_mailbox_date <> ? OR public_mailbox_today < daily_limit", today)
	}
	result := query.Updates(map[string]interface{}{
		"public_mailbox_created": gorm.Expr("public_mailbox_created + 1"),
		"public_mailbox_today":   gorm.Expr("CASE WHEN public_mailbox_date = ? THEN public_mailbox_today + 1 ELSE 1 END", today),
		"public_mailbox_date":    today,
	})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return httpStatusError{Status: http.StatusTooManyRequests, Message: "公开邮箱每日创建额度已用完"}
	}
	return nil
}

func hasRootReadyPublicDomain(tx *gorm.DB, userID uint) (bool, error) {
	var count int64
	if err := ownerRootReadyPublicDomainQuery(tx.Model(&models.Domain{}), userID).Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

func (h *Handler) filterAvailablePublicDomains(domains []models.Domain, actor *requestActor) ([]models.Domain, string, error) {
	settings, err := db.EnsureSystemQuotaSettings(h.DB)
	if err != nil {
		return nil, "", err
	}
	if actor != nil && !actor.isAdmin() && settings.RequirePublicDomainForQuota {
		ownerID, ok := actor.ownerID()
		if !ok {
			return []models.Domain{}, "public mailbox creation requires an owned active MX-verified public domain", nil
		}
		hasPublicDomain, err := hasRootReadyPublicDomain(h.DB, ownerID)
		if err != nil {
			return nil, "", err
		}
		if !hasPublicDomain {
			return []models.Domain{}, "public mailbox creation requires an owned active MX-verified public domain", nil
		}
	}
	if settings.PublicDomainMailboxLimit <= 0 {
		return domains, "", nil
	}
	var ownerID uint
	if actor != nil {
		if id, ok := actor.ownerID(); ok {
			ownerID = id
		}
	}
	out := make([]models.Domain, 0, len(domains))
	for _, d := range domains {
		isOwner := d.OwnerID != nil && *d.OwnerID == ownerID
		if actor != nil && (actor.isAdmin() || isOwner) || d.MailboxCreatedCount < settings.PublicDomainMailboxLimit {
			out = append(out, d)
		}
	}
	return out, "", nil
}
