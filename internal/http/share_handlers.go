package httpapi

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"gptmail/internal/auth"
	"gptmail/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const shareTokenPrefixLength = 24

type createShareLinkRequest struct {
	ResourceType string `json:"resource_type"`
	MessageID    string `json:"message_id"`
	MailboxID    *uint  `json:"mailbox_id"`
	ExpiresAt    string `json:"expires_at"`
}

type patchShareLinkRequest struct {
	ExpiresAt *string `json:"expires_at"`
}

type publicSharedMailboxLockedDTO struct {
	ResourceType string                          `json:"resource_type"`
	TokenPrefix  string                          `json:"token_prefix"`
	KeyRequired  bool                            `json:"key_required"`
	Locked       bool                            `json:"locked"`
	ExpiresAt    *time.Time                      `json:"expires_at,omitempty"`
	Mailbox      *publicSharedMailboxMetadataDTO `json:"mailbox,omitempty"`
}

type publicSharedMailboxDTO struct {
	ResourceType string                         `json:"resource_type"`
	TokenPrefix  string                         `json:"token_prefix"`
	ExpiresAt    *time.Time                     `json:"expires_at,omitempty"`
	Mailbox      publicSharedMailboxMetadataDTO `json:"mailbox"`
}

type publicSharedMailboxMetadataDTO struct {
	ID            uint       `json:"id"`
	Email         string     `json:"email"`
	LocalPart     string     `json:"local_part,omitempty"`
	Host          string     `json:"host,omitempty"`
	DomainID      uint       `json:"domain_id,omitempty"`
	MessageCount  int64      `json:"message_count"`
	LastMessageAt *time.Time `json:"last_message_at,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
}

type shareLinkAccessLogDTO struct {
	ID            uint      `json:"id"`
	ShareLinkID   uint      `json:"share_link_id"`
	ResourceType  string    `json:"resource_type"`
	MailboxID     *uint     `json:"mailbox_id,omitempty"`
	Success       bool      `json:"success"`
	FailureReason string    `json:"failure_reason,omitempty"`
	IP            string    `json:"ip"`
	UserAgent     string    `json:"user_agent"`
	CreatedAt     time.Time `json:"created_at"`
}

func (h *Handler) createShareLink(c *gin.Context) {
	user, loggedIn := h.requireLogin(c)
	if !loggedIn {
		return
	}
	var input createShareLinkRequest
	if err := c.ShouldBindJSON(&input); err != nil && !errors.Is(err, io.EOF) {
		fail(c, http.StatusBadRequest, "invalid json")
		return
	}
	resourceType := strings.TrimSpace(input.ResourceType)
	if resourceType == "" {
		resourceType = models.ShareResourceTypeMailbox
	}
	if strings.TrimSpace(input.MessageID) != "" {
		fail(c, http.StatusBadRequest, "message_id is no longer supported for share creation")
		return
	}
	expiresAt, err := parseShareExpiresAt(input.ExpiresAt, true)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	switch resourceType {
	case models.ShareResourceTypeMessage:
		fail(c, http.StatusBadRequest, "only mailbox sharing is supported")
	case models.ShareResourceTypeMailbox:
		h.createMailboxShareLink(c, user, input, expiresAt)
	default:
		fail(c, http.StatusBadRequest, "unsupported resource_type")
	}
}

func (h *Handler) createMailboxShareLink(c *gin.Context, user *models.User, input createShareLinkRequest, expiresAt *time.Time) {
	if input.MailboxID == nil || *input.MailboxID == 0 {
		fail(c, http.StatusBadRequest, "mailbox_id is required")
		return
	}
	var mailbox models.Mailbox
	if err := h.DB.First(&mailbox, "id = ?", *input.MailboxID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			fail(c, http.StatusNotFound, "mailbox not found")
			return
		}
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	if user.Role != models.UserRoleAdmin && mailbox.OwnerID != user.ID {
		fail(c, http.StatusForbidden, "mailbox access denied")
		return
	}
	link, token, accessKey, err := h.createMailboxShare(mailbox, expiresAt)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	created(c, h.shareLinkDTO(c, *link, token, accessKey))
}

func (h *Handler) listShareLinks(c *gin.Context) {
	user, loggedIn := h.requireLogin(c)
	if !loggedIn {
		return
	}
	page := parsePage(c.Query("page"))
	perPage := parseLimit(c.Query("per_page"), 10, 100)
	query := h.shareLinksForUser(user)
	var total int64
	if err := query.Session(&gorm.Session{}).Count(&total).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	totalPages := pageCount(total, perPage)
	if page > totalPages {
		page = totalPages
	}
	var links []models.ShareLink
	if err := query.Order("created_at desc").
		Limit(perPage).
		Offset((page - 1) * perPage).
		Find(&links).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	items := make([]ShareLinkDTO, 0, len(links))
	for _, link := range links {
		items = append(items, h.shareLinkDTO(c, link, "", ""))
	}
	ok(c, paginatedResponse[ShareLinkDTO]{
		Items:      items,
		Page:       page,
		PerPage:    perPage,
		Total:      total,
		TotalPages: totalPages,
	})
}

func (h *Handler) getShareLink(c *gin.Context) {
	user, loggedIn := h.requireLogin(c)
	if !loggedIn {
		return
	}
	link, ok := h.findShareLinkForUser(c, user)
	if !ok {
		return
	}
	webOK(c, h.shareLinkDTO(c, *link, "", ""))
}

func (h *Handler) patchShareLink(c *gin.Context) {
	user, loggedIn := h.requireLogin(c)
	if !loggedIn {
		return
	}
	link, ok := h.findShareLinkForUser(c, user)
	if !ok {
		return
	}
	var input patchShareLinkRequest
	if err := c.ShouldBindJSON(&input); err != nil && !errors.Is(err, io.EOF) {
		fail(c, http.StatusBadRequest, "invalid json")
		return
	}
	updates := map[string]any{}
	if input.ExpiresAt != nil {
		expiresAt, err := parseShareExpiresAt(*input.ExpiresAt, true)
		if err != nil {
			fail(c, http.StatusBadRequest, err.Error())
			return
		}
		updates["expires_at"] = expiresAt
	}
	if len(updates) > 0 {
		if err := h.DB.Model(link).Updates(updates).Error; err != nil {
			fail(c, http.StatusInternalServerError, err.Error())
			return
		}
		if err := h.DB.First(link, "id = ?", link.ID).Error; err != nil {
			fail(c, http.StatusInternalServerError, err.Error())
			return
		}
	}
	webOK(c, h.shareLinkDTO(c, *link, "", ""))
}

func (h *Handler) revokeShareLink(c *gin.Context) {
	user, loggedIn := h.requireLogin(c)
	if !loggedIn {
		return
	}
	link, ok := h.findShareLinkForUser(c, user)
	if !ok {
		return
	}
	now := time.Now()
	if err := h.DB.Model(link).Update("revoked_at", &now).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	link.RevokedAt = &now
	webOK(c, h.shareLinkDTO(c, *link, "", ""))
}

func (h *Handler) rotateShareLinkToken(c *gin.Context) {
	user, loggedIn := h.requireLogin(c)
	if !loggedIn {
		return
	}
	link, ok := h.findShareLinkForUser(c, user)
	if !ok {
		return
	}
	token, prefix, tokenHash, err := newShareToken()
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	updates := map[string]any{
		"token_hash":   tokenHash,
		"token_prefix": prefix,
	}
	accessKey := ""
	if link.ResourceType == models.ShareResourceTypeMailbox {
		var accessKeyHash string
		accessKey, accessKeyHash, err = newShareAccessKey()
		if err != nil {
			fail(c, http.StatusInternalServerError, err.Error())
			return
		}
		updates["access_key_hash"] = accessKeyHash
	}
	if err := h.DB.Model(link).Updates(updates).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	link.TokenHash = tokenHash
	link.TokenPrefix = prefix
	if value, ok := updates["access_key_hash"].(string); ok {
		link.AccessKeyHash = value
	}
	webOK(c, h.shareLinkDTO(c, *link, token, accessKey))
}

func (h *Handler) rotateShareLinkKey(c *gin.Context) {
	user, loggedIn := h.requireLogin(c)
	if !loggedIn {
		return
	}
	link, ok := h.findShareLinkForUser(c, user)
	if !ok {
		return
	}
	if link.ResourceType != models.ShareResourceTypeMailbox {
		fail(c, http.StatusBadRequest, "share key is only supported for mailbox shares")
		return
	}
	accessKey, accessKeyHash, err := newShareAccessKey()
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	if err := h.DB.Model(link).Update("access_key_hash", accessKeyHash).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	link.AccessKeyHash = accessKeyHash
	webOK(c, h.shareLinkDTO(c, *link, "", accessKey))
}

func (h *Handler) listShareLinkAccessLogs(c *gin.Context) {
	user, loggedIn := h.requireLogin(c)
	if !loggedIn {
		return
	}
	link, ok := h.findShareLinkForUser(c, user)
	if !ok {
		return
	}
	page := parsePage(c.Query("page"))
	perPage := parseLimit(c.Query("per_page"), 20, 100)
	query := h.DB.Model(&models.ShareLinkAccessLog{}).Where("share_link_id = ?", link.ID)
	var total int64
	if err := query.Session(&gorm.Session{}).Count(&total).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	totalPages := pageCount(total, perPage)
	if page > totalPages {
		page = totalPages
	}
	var logs []models.ShareLinkAccessLog
	if err := query.Order("created_at desc").
		Limit(perPage).
		Offset((page - 1) * perPage).
		Find(&logs).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	items := make([]shareLinkAccessLogDTO, 0, len(logs))
	for _, log := range logs {
		items = append(items, shareLinkAccessLogDTO{
			ID:            log.ID,
			ShareLinkID:   log.ShareLinkID,
			ResourceType:  log.ResourceType,
			MailboxID:     log.MailboxID,
			Success:       log.Success,
			FailureReason: log.FailureReason,
			IP:            log.IP,
			UserAgent:     log.UserAgent,
			CreatedAt:     log.CreatedAt,
		})
	}
	webOK(c, paginatedResponse[shareLinkAccessLogDTO]{
		Items:      items,
		Page:       page,
		PerPage:    perPage,
		Total:      total,
		TotalPages: totalPages,
	})
}

func (h *Handler) getSharedLink(c *gin.Context) {
	link, ok := h.resolvePublicShare(c)
	if !ok {
		return
	}
	switch link.ResourceType {
	case models.ShareResourceTypeMessage:
		fail(c, http.StatusNotFound, "share link not found")
	case models.ShareResourceTypeMailbox:
		h.writeSharedMailboxMetadata(c, link, false)
	default:
		fail(c, http.StatusNotFound, "share link not found")
	}
}

func (h *Handler) listSharedMailboxMessages(c *gin.Context) {
	link, mailbox, ok := h.resolveMailboxShareWithKey(c)
	if !ok {
		return
	}
	paged := c.Query("page") != "" || c.Query("per_page") != ""
	if paged {
		page := parsePage(c.Query("page"))
		perPage := parseLimit(c.Query("per_page"), 10, 100)
		var total int64
		if err := h.DB.Model(&models.Message{}).Where("recipient = ?", mailbox.Email).Count(&total).Error; err != nil {
			fail(c, http.StatusInternalServerError, err.Error())
			return
		}
		totalPages := pageCount(total, perPage)
		if page > totalPages {
			page = totalPages
		}
		var messages []models.Message
		if err := h.DB.Where("recipient = ?", mailbox.Email).
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
		if err := h.recordShareAccess(c, link, true, ""); err != nil {
			fail(c, http.StatusInternalServerError, err.Error())
			return
		}
		publicOK(c, paginatedResponse[messageSummary]{
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
	if err := h.DB.Where("recipient = ?", mailbox.Email).
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
	if err := h.recordShareAccess(c, link, true, ""); err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	publicOK(c, summaries)
}

func (h *Handler) getSharedMailboxMessage(c *gin.Context) {
	link, mailbox, ok := h.resolveMailboxShareWithKey(c)
	if !ok {
		return
	}
	var msg models.Message
	if err := h.DB.Where("id = ? AND recipient = ?", c.Param("message_id"), mailbox.Email).First(&msg).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			fail(c, http.StatusNotFound, "message not found")
			return
		}
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	attachments, err := h.attachmentMetadataForMessage(msg.ID)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	if err := h.recordShareAccess(c, link, true, ""); err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	publicOK(c, publicSharedMailboxMessageDTO(msg, attachments))
}

func (h *Handler) shareLinksForUser(user *models.User) *gorm.DB {
	query := h.DB.Model(&models.ShareLink{})
	if user == nil {
		return query.Where("1 = 0")
	}
	if user.Role != models.UserRoleAdmin {
		query = query.Where("owner_id = ?", user.ID)
	}
	return query
}

func (h *Handler) findShareLinkForUser(c *gin.Context, user *models.User) (*models.ShareLink, bool) {
	var link models.ShareLink
	err := h.shareLinksForUser(user).Where("id = ?", c.Param("id")).First(&link).Error
	if err == nil {
		return &link, true
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		fail(c, http.StatusNotFound, "share link not found")
		return nil, false
	}
	fail(c, http.StatusInternalServerError, err.Error())
	return nil, false
}

func (h *Handler) resolvePublicShare(c *gin.Context) (*models.ShareLink, bool) {
	link, ok, err := h.findShareLinkByToken(c.Param("token"))
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return nil, false
	}
	if !ok {
		fail(c, http.StatusNotFound, "share link not found")
		return nil, false
	}
	if link.RevokedAt != nil || (link.ExpiresAt != nil && !link.ExpiresAt.After(time.Now())) {
		fail(c, http.StatusGone, "share link expired or revoked")
		return nil, false
	}
	return link, true
}

func (h *Handler) findShareLinkByToken(token string) (*models.ShareLink, bool, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return nil, false, nil
	}
	var candidates []models.ShareLink
	if err := h.DB.
		Where("token_prefix = ?", shareTokenPrefix(token)).
		Find(&candidates).Error; err != nil {
		return nil, false, err
	}
	for i := range candidates {
		if auth.VerifySecret(candidates[i].TokenHash, token) {
			return &candidates[i], true, nil
		}
	}
	return nil, false, nil
}

func (h *Handler) writeSharedMailboxMetadata(c *gin.Context, link *models.ShareLink, requireKey bool) {
	mailbox, ok := h.sharedMailboxForLink(c, link)
	if !ok {
		return
	}
	key := strings.TrimSpace(c.Query("key"))
	if key == "" {
		if requireKey {
			fail(c, http.StatusUnauthorized, "share key required")
			return
		}
		publicOK(c, publicSharedMailboxLockedDTO{
			ResourceType: link.ResourceType,
			TokenPrefix:  link.TokenPrefix,
			KeyRequired:  true,
			Locked:       true,
			ExpiresAt:    link.ExpiresAt,
		})
		return
	}
	if !auth.VerifySecret(link.AccessKeyHash, key) {
		if err := h.recordShareAccess(c, link, false, "invalid_key"); err != nil {
			fail(c, http.StatusInternalServerError, err.Error())
			return
		}
		fail(c, http.StatusUnauthorized, "invalid share key")
		return
	}
	if err := h.recordShareAccess(c, link, true, ""); err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	publicOK(c, h.sharedMailboxDTO(link, mailbox))
}

func (h *Handler) resolveMailboxShareWithKey(c *gin.Context) (*models.ShareLink, models.Mailbox, bool) {
	link, ok := h.resolvePublicShare(c)
	if !ok {
		return nil, models.Mailbox{}, false
	}
	if link.ResourceType != models.ShareResourceTypeMailbox {
		fail(c, http.StatusNotFound, "share link not found")
		return nil, models.Mailbox{}, false
	}
	mailbox, ok := h.sharedMailboxForLink(c, link)
	if !ok {
		return nil, models.Mailbox{}, false
	}
	key := strings.TrimSpace(c.Query("key"))
	if key == "" {
		fail(c, http.StatusUnauthorized, "share key required")
		return nil, models.Mailbox{}, false
	}
	if !auth.VerifySecret(link.AccessKeyHash, key) {
		if err := h.recordShareAccess(c, link, false, "invalid_key"); err != nil {
			fail(c, http.StatusInternalServerError, err.Error())
			return nil, models.Mailbox{}, false
		}
		fail(c, http.StatusUnauthorized, "invalid share key")
		return nil, models.Mailbox{}, false
	}
	return link, mailbox, true
}

func (h *Handler) sharedMailboxForLink(c *gin.Context, link *models.ShareLink) (models.Mailbox, bool) {
	if link.MailboxID == nil || *link.MailboxID == 0 {
		fail(c, http.StatusNotFound, "mailbox not found")
		return models.Mailbox{}, false
	}
	var mailbox models.Mailbox
	if err := h.DB.First(&mailbox, "id = ?", *link.MailboxID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			fail(c, http.StatusNotFound, "mailbox not found")
			return models.Mailbox{}, false
		}
		fail(c, http.StatusInternalServerError, err.Error())
		return models.Mailbox{}, false
	}
	return mailbox, true
}

func (h *Handler) sharedMailboxDTO(link *models.ShareLink, mailbox models.Mailbox) publicSharedMailboxDTO {
	var count int64
	h.DB.Model(&models.Message{}).Where("recipient = ?", mailbox.Email).Count(&count)
	var lastMsg models.Message
	var lastAt *time.Time
	if err := h.DB.Where("recipient = ?", mailbox.Email).Order("created_at desc").First(&lastMsg).Error; err == nil {
		t := lastMsg.CreatedAt
		lastAt = &t
	}
	return publicSharedMailboxDTO{
		ResourceType: link.ResourceType,
		TokenPrefix:  link.TokenPrefix,
		ExpiresAt:    link.ExpiresAt,
		Mailbox: publicSharedMailboxMetadataDTO{
			ID:            mailbox.ID,
			Email:         mailbox.Email,
			LocalPart:     mailbox.LocalPart,
			Host:          mailbox.Host,
			DomainID:      mailbox.DomainID,
			MessageCount:  count,
			LastMessageAt: lastAt,
			CreatedAt:     mailbox.CreatedAt,
		},
	}
}

func (h *Handler) recordShareAccess(c *gin.Context, link *models.ShareLink, success bool, failureReason string) error {
	now := time.Now()
	return h.DB.Transaction(func(tx *gorm.DB) error {
		if success {
			result := tx.Model(&models.ShareLink{}).
				Where("id = ?", link.ID).
				Updates(map[string]any{
					"access_count":     gorm.Expr("access_count + ?", 1),
					"last_accessed_at": &now,
				})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected == 0 {
				return gorm.ErrRecordNotFound
			}
		}
		return tx.Create(&models.ShareLinkAccessLog{
			ShareLinkID:   link.ID,
			OwnerID:       link.OwnerID,
			ResourceType:  link.ResourceType,
			MessageID:     link.MessageID,
			MailboxID:     link.MailboxID,
			Success:       success,
			FailureReason: failureReason,
			IP:            c.ClientIP(),
			UserAgent:     c.Request.UserAgent(),
			CreatedAt:     now,
		}).Error
	})
}

func (h *Handler) shareLinkDTO(c *gin.Context, link models.ShareLink, token, accessKey string) ShareLinkDTO {
	dto := ShareLinkDTO{
		ID:             link.ID,
		ResourceType:   link.ResourceType,
		MailboxID:      link.MailboxID,
		TokenPrefix:    link.TokenPrefix,
		KeySet:         link.AccessKeyHash != "",
		ExpiresAt:      link.ExpiresAt,
		RevokedAt:      link.RevokedAt,
		AccessCount:    link.AccessCount,
		LastAccessedAt: link.LastAccessedAt,
		CreatedAt:      link.CreatedAt,
		UpdatedAt:      link.UpdatedAt,
	}
	if token != "" {
		dto.Token = token
		dto.ShareURL = h.shareWebURL(c, token)
	}
	if accessKey != "" {
		dto.AccessKey = accessKey
		if dto.ShareURL == "" && token != "" {
			dto.ShareURL = h.shareWebURL(c, token)
		}
		if dto.ShareURL != "" {
			dto.AccessURL = shareAccessURL(dto.ShareURL, accessKey)
		}
	}
	return dto
}

func (h *Handler) createMailboxShare(mailbox models.Mailbox, expiresAt *time.Time) (*models.ShareLink, string, string, error) {
	token, prefix, tokenHash, err := newShareToken()
	if err != nil {
		return nil, "", "", err
	}
	accessKey, accessKeyHash, err := newShareAccessKey()
	if err != nil {
		return nil, "", "", err
	}
	link := models.ShareLink{
		OwnerID:       mailbox.OwnerID,
		TokenHash:     tokenHash,
		TokenPrefix:   prefix,
		ResourceType:  models.ShareResourceTypeMailbox,
		MailboxID:     &mailbox.ID,
		AccessKeyHash: accessKeyHash,
		ExpiresAt:     expiresAt,
	}
	if err := h.DB.Create(&link).Error; err != nil {
		return nil, "", "", err
	}
	return &link, token, accessKey, nil
}

func newShareToken() (plain, prefix, hash string, err error) {
	random, err := randomURLToken(32)
	if err != nil {
		return "", "", "", err
	}
	plain = "share-hloolmail-" + random
	prefix = shareTokenPrefix(plain)
	hash, err = auth.HashSecret(plain)
	if err != nil {
		return "", "", "", err
	}
	return plain, prefix, hash, nil
}

func newShareAccessKey() (plain, hash string, err error) {
	random, err := randomURLToken(32)
	if err != nil {
		return "", "", err
	}
	plain = "sharekey-hloolmail-" + random
	hash, err = auth.HashSecret(plain)
	if err != nil {
		return "", "", err
	}
	return plain, hash, nil
}

func shareTokenPrefix(token string) string {
	if len(token) <= shareTokenPrefixLength {
		return token
	}
	return token[:shareTokenPrefixLength]
}

func parseShareExpiresAt(value string, requireFuture bool) (*time.Time, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, nil
	}
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return nil, fmt.Errorf("expires_at must be an RFC3339 time")
	}
	if requireFuture && !parsed.After(time.Now()) {
		return nil, fmt.Errorf("expires_at must be in the future")
	}
	return &parsed, nil
}

func (h *Handler) shareWebURL(c *gin.Context, token string) string {
	path := "/share/" + url.PathEscape(token)
	if base := strings.TrimRight(strings.TrimSpace(h.Config.PublicBaseURL), "/"); base != "" {
		return base + path
	}
	host := c.Request.Host
	if host == "" {
		return path
	}
	scheme := "http"
	if forwarded := strings.TrimSpace(c.GetHeader("X-Forwarded-Proto")); forwarded != "" {
		scheme = strings.TrimSpace(strings.Split(forwarded, ",")[0])
	} else if c.Request.TLS != nil {
		scheme = "https"
	}
	return scheme + "://" + host + path
}

func shareAccessURL(shareURL, accessKey string) string {
	parsed, err := url.Parse(shareURL)
	if err != nil {
		separator := "?"
		if strings.Contains(shareURL, "?") {
			separator = "&"
		}
		return shareURL + separator + "key=" + url.QueryEscape(accessKey)
	}
	query := parsed.Query()
	query.Set("key", accessKey)
	parsed.RawQuery = query.Encode()
	return parsed.String()
}
