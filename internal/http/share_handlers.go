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
	Password     string `json:"password"`
	ExpiresAt    string `json:"expires_at"`
}

type patchShareLinkRequest struct {
	Password      *string `json:"password"`
	ClearPassword bool    `json:"clear_password"`
	ExpiresAt     *string `json:"expires_at"`
}

type sharedAccessRequest struct {
	Password string `json:"password"`
}

type publicSharedMessageMetadataDTO struct {
	ID          string    `json:"id"`
	Recipient   string    `json:"recipient"`
	FromAddress string    `json:"from_address"`
	FromName    string    `json:"from_name,omitempty"`
	Subject     string    `json:"subject"`
	CreatedAt   time.Time `json:"created_at"`
	ExpiresAt   time.Time `json:"expires_at"`
}

type publicSharedLockedDTO struct {
	ResourceType     string                         `json:"resource_type"`
	TokenPrefix      string                         `json:"token_prefix"`
	PasswordRequired bool                           `json:"password_required"`
	ExpiresAt        *time.Time                     `json:"expires_at,omitempty"`
	Message          publicSharedMessageMetadataDTO `json:"message"`
}

type shareLinkAccessLogDTO struct {
	ID            uint      `json:"id"`
	ShareLinkID   uint      `json:"share_link_id"`
	ResourceType  string    `json:"resource_type"`
	MessageID     string    `json:"message_id"`
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
		resourceType = models.ShareResourceTypeMessage
	}
	if resourceType != models.ShareResourceTypeMessage {
		fail(c, http.StatusBadRequest, "only message share is supported")
		return
	}
	messageID := strings.TrimSpace(input.MessageID)
	if messageID == "" {
		fail(c, http.StatusBadRequest, "message_id is required")
		return
	}
	var msg models.Message
	if err := h.DB.First(&msg, "id = ?", messageID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			fail(c, http.StatusNotFound, "message not found")
			return
		}
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	owner, exists, err := h.messageOwnerForMessage(msg)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	if !exists || (user.Role != models.UserRoleAdmin && owner.OwnerID != user.ID) {
		fail(c, http.StatusForbidden, "message access denied")
		return
	}
	expiresAt, err := parseShareExpiresAt(input.ExpiresAt, true)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	token, prefix, tokenHash, err := newShareToken()
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	passwordHash, err := hashOptionalSharePassword(input.Password)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	link := models.ShareLink{
		OwnerID:      owner.OwnerID,
		TokenHash:    tokenHash,
		TokenPrefix:  prefix,
		ResourceType: models.ShareResourceTypeMessage,
		MessageID:    msg.ID,
		PasswordHash: passwordHash,
		ExpiresAt:    expiresAt,
	}
	if err := h.DB.Create(&link).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	created(c, shareLinkDTO(c, link, token))
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
		items = append(items, shareLinkDTO(c, link, ""))
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
	webOK(c, shareLinkDTO(c, *link, ""))
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
	if input.ClearPassword {
		updates["password_hash"] = ""
	} else if input.Password != nil {
		passwordHash, err := hashOptionalSharePassword(*input.Password)
		if err != nil {
			fail(c, http.StatusInternalServerError, err.Error())
			return
		}
		updates["password_hash"] = passwordHash
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
	webOK(c, shareLinkDTO(c, *link, ""))
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
	webOK(c, shareLinkDTO(c, *link, ""))
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
	if err := h.DB.Model(link).Updates(map[string]any{
		"token_hash":   tokenHash,
		"token_prefix": prefix,
	}).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	link.TokenHash = tokenHash
	link.TokenPrefix = prefix
	webOK(c, shareLinkDTO(c, *link, token))
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
			MessageID:     log.MessageID,
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
	if _, exists := c.GetQuery("password"); exists {
		fail(c, http.StatusBadRequest, "password must be sent in JSON body")
		return
	}
	link, msg, ok := h.resolvePublicShare(c)
	if !ok {
		return
	}
	if link.PasswordHash != "" {
		publicOK(c, publicSharedLockedDTO{
			ResourceType:     link.ResourceType,
			TokenPrefix:      link.TokenPrefix,
			PasswordRequired: true,
			ExpiresAt:        link.ExpiresAt,
			Message:          sharedMessageMetadataDTO(msg),
		})
		return
	}
	h.writeSharedMessage(c, link, msg)
}

func (h *Handler) accessSharedLink(c *gin.Context) {
	if _, exists := c.GetQuery("password"); exists {
		fail(c, http.StatusBadRequest, "password must be sent in JSON body")
		return
	}
	link, msg, ok := h.resolvePublicShare(c)
	if !ok {
		return
	}
	var input sharedAccessRequest
	if err := c.ShouldBindJSON(&input); err != nil && !errors.Is(err, io.EOF) {
		fail(c, http.StatusBadRequest, "invalid json")
		return
	}
	if link.PasswordHash != "" && !auth.VerifySecret(link.PasswordHash, input.Password) {
		if err := h.recordShareAccess(c, link, false, "invalid_password"); err != nil {
			fail(c, http.StatusInternalServerError, err.Error())
			return
		}
		fail(c, http.StatusUnauthorized, "invalid password")
		return
	}
	h.writeSharedMessage(c, link, msg)
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

func (h *Handler) resolvePublicShare(c *gin.Context) (*models.ShareLink, models.Message, bool) {
	link, ok, err := h.findShareLinkByToken(c.Param("token"))
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return nil, models.Message{}, false
	}
	if !ok {
		fail(c, http.StatusNotFound, "share link not found")
		return nil, models.Message{}, false
	}
	if link.RevokedAt != nil || (link.ExpiresAt != nil && !link.ExpiresAt.After(time.Now())) {
		fail(c, http.StatusGone, "share link expired or revoked")
		return nil, models.Message{}, false
	}
	if link.ResourceType != models.ShareResourceTypeMessage {
		fail(c, http.StatusNotFound, "share link not found")
		return nil, models.Message{}, false
	}
	var msg models.Message
	err = h.DB.First(&msg, "id = ?", link.MessageID).Error
	if err == nil {
		return link, msg, true
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		fail(c, http.StatusNotFound, "message not found")
		return nil, models.Message{}, false
	}
	fail(c, http.StatusInternalServerError, err.Error())
	return nil, models.Message{}, false
}

func (h *Handler) findShareLinkByToken(token string) (*models.ShareLink, bool, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return nil, false, nil
	}
	var candidates []models.ShareLink
	if err := h.DB.
		Where("token_prefix = ? AND resource_type = ?", shareTokenPrefix(token), models.ShareResourceTypeMessage).
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

func (h *Handler) writeSharedMessage(c *gin.Context, link *models.ShareLink, msg models.Message) {
	attachments, err := h.attachmentMetadataForMessage(msg.ID)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	if err := h.recordShareAccess(c, link, true, ""); err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	publicOK(c, publicSharedMessageDTO(msg, attachments))
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
			Success:       success,
			FailureReason: failureReason,
			IP:            c.ClientIP(),
			UserAgent:     c.Request.UserAgent(),
			CreatedAt:     now,
		}).Error
	})
}

func shareLinkDTO(c *gin.Context, link models.ShareLink, token string) ShareLinkDTO {
	dto := ShareLinkDTO{
		ID:             link.ID,
		ResourceType:   link.ResourceType,
		MessageID:      link.MessageID,
		TokenPrefix:    link.TokenPrefix,
		PasswordSet:    link.PasswordHash != "",
		ExpiresAt:      link.ExpiresAt,
		RevokedAt:      link.RevokedAt,
		AccessCount:    link.AccessCount,
		LastAccessedAt: link.LastAccessedAt,
		CreatedAt:      link.CreatedAt,
		UpdatedAt:      link.UpdatedAt,
	}
	if token != "" {
		dto.Token = token
		dto.ShareURL = shareWebURL(c, token)
	}
	return dto
}

func sharedMessageMetadataDTO(msg models.Message) publicSharedMessageMetadataDTO {
	return publicSharedMessageMetadataDTO{
		ID:          msg.ID,
		Recipient:   msg.Recipient,
		FromAddress: msg.FromAddress,
		FromName:    msg.FromName,
		Subject:     msg.Subject,
		CreatedAt:   msg.CreatedAt,
		ExpiresAt:   msg.ExpiresAt,
	}
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

func shareTokenPrefix(token string) string {
	if len(token) <= shareTokenPrefixLength {
		return token
	}
	return token[:shareTokenPrefixLength]
}

func hashOptionalSharePassword(password string) (string, error) {
	password = strings.TrimSpace(password)
	if password == "" {
		return "", nil
	}
	return auth.HashSecret(password)
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

func shareWebURL(c *gin.Context, token string) string {
	path := "/share/" + url.PathEscape(token)
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
