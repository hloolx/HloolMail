package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"gptmail/internal/db"
	domaindb "gptmail/internal/domain"
	"gptmail/internal/mailhtml"
	"gptmail/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const yydsCompatibilityBasePath = "/yyds/v1"

type yydsAddress struct {
	Name    string `json:"name"`
	Address string `json:"address"`
}

type yydsAccountRequest struct {
	LocalPart string `json:"localPart"`
	Address   string `json:"address"`
	Domain    string `json:"domain"`
	Subdomain string `json:"subdomain"`
}

type yydsAccountDTO struct {
	ID           string    `json:"id"`
	Address      string    `json:"address"`
	Mode         string    `json:"mode"`
	Domain       string    `json:"domain"`
	Subdomain    string    `json:"subdomain"`
	Token        string    `json:"token"`
	InboxType    string    `json:"inboxType"`
	Source       string    `json:"source"`
	ExpiresAt    time.Time `json:"expiresAt"`
	IsActive     bool      `json:"isActive"`
	MessageCount int64     `json:"messageCount,omitempty"`
	CreatedAt    time.Time `json:"createdAt"`
}

type yydsDomainDTO struct {
	ID              uint   `json:"id"`
	Domain          string `json:"domain"`
	Mode            string `json:"mode"`
	WildcardEnabled bool   `json:"wildcardEnabled"`
}

type yydsDomainsResponse struct {
	Domains        []string        `json:"domains"`
	PublicDomains  []yydsDomainDTO `json:"public_domains"`
	PrivateDomains []yydsDomainDTO `json:"private_domains"`
}

type yydsMessageSummaryDTO struct {
	ID             string        `json:"id"`
	InboxID        string        `json:"inbox_id"`
	InboxIDCompat  string        `json:"inboxId"`
	From           yydsAddress   `json:"from"`
	To             []yydsAddress `json:"to"`
	Subject        string        `json:"subject"`
	Seen           bool          `json:"seen"`
	HasAttachments bool          `json:"hasAttachments"`
	Size           int64         `json:"size"`
	CreatedAt      time.Time     `json:"createdAt"`
}

type yydsMessagesResponse struct {
	Messages    []yydsMessageSummaryDTO `json:"messages"`
	Total       int64                   `json:"total"`
	UnreadCount int64                   `json:"unreadCount"`
}

type yydsAttachmentDTO struct {
	ID          string `json:"id"`
	Filename    string `json:"filename"`
	ContentType string `json:"contentType"`
	Size        int64  `json:"size"`
	DownloadURL string `json:"downloadUrl"`
}

type yydsMessageDetailDTO struct {
	ID             string              `json:"id"`
	From           yydsAddress         `json:"from"`
	To             []yydsAddress       `json:"to"`
	Subject        string              `json:"subject"`
	Text           string              `json:"text"`
	HTML           []string            `json:"html"`
	Seen           bool                `json:"seen"`
	HasAttachments bool                `json:"hasAttachments"`
	Size           int64               `json:"size"`
	CreatedAt      time.Time           `json:"createdAt"`
	Attachments    []yydsAttachmentDTO `json:"attachments"`
}

type yydsMarkReadResponse struct {
	Mailbox     string `json:"mailbox"`
	Updated     int64  `json:"updated"`
	AlreadySeen int64  `json:"alreadySeen"`
	Total       int64  `json:"total"`
}

func (h *Handler) yydsCompatibilityMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		settings, err := db.EnsureAPIInterfaceSettings(h.DB)
		if err != nil {
			fail(c, http.StatusInternalServerError, err.Error())
			c.Abort()
			return
		}
		if !settings.YYDSCompatibilityEnabled {
			fail(c, http.StatusNotFound, "yyds compatibility layer is disabled")
			c.Abort()
			return
		}
		plain := strings.TrimSpace(c.GetHeader("X-API-Key"))
		if plain == "" && h.Config.AllowAPIKeyQueryParam {
			plain = strings.TrimSpace(c.Query("api_key"))
			if plain != "" {
				c.Header("X-API-Key-Warning", "query-string-detected")
			}
		}
		if plain == "" {
			fail(c, http.StatusUnauthorized, "api key missing")
			c.Abort()
			return
		}
		if !h.authenticateAPIKeyRequest(c, plain) {
			c.Abort()
			return
		}
		c.Next()
	}
}

func (h *Handler) yydsListDomains(c *gin.Context) {
	actor, allowed := h.requireActor(c)
	if !allowed {
		return
	}
	var publicDomains []models.Domain
	if err := publicReadyDomainQuery(h.DB.Order("domain asc")).Find(&publicDomains).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	publicDomains, _, err := h.filterAvailablePublicDomains(publicDomains, actor)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	privateDomains := []models.Domain{}
	if ownerID, ok := actor.ownerID(); ok {
		if err := privateReadyDomainQuery(h.DB.Order("domain asc")).Where("owner_id = ?", ownerID).Find(&privateDomains).Error; err != nil {
			fail(c, http.StatusInternalServerError, err.Error())
			return
		}
	}
	ok(c, yydsDomainsResponse{
		Domains:        domainNames(publicDomains),
		PublicDomains:  yydsDomainDTOs(publicDomains),
		PrivateDomains: yydsDomainDTOs(privateDomains),
	})
}

func (h *Handler) yydsCreateAccount(c *gin.Context) {
	h.yydsCreateAccountWithMode(c, false)
}

func (h *Handler) yydsCreateWildcardAccount(c *gin.Context) {
	h.yydsCreateAccountWithMode(c, true)
}

func (h *Handler) yydsCreateAccountWithMode(c *gin.Context, wildcard bool) {
	actor, allowed := h.requireActor(c)
	if !allowed {
		return
	}
	var input yydsAccountRequest
	if err := c.ShouldBindJSON(&input); err != nil && !errors.Is(err, io.EOF) {
		fail(c, http.StatusBadRequest, "invalid json")
		return
	}
	d, emailLocal, host, subdomain, err := h.yydsAccountTarget(input, actor, wildcard)
	if err != nil {
		var httpErr httpStatusError
		if errors.As(err, &httpErr) {
			fail(c, httpErr.Status, httpErr.Message)
			return
		}
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	ownerID, err := h.mailboxOwnerID(actor)
	if err != nil {
		fail(c, http.StatusForbidden, err.Error())
		return
	}
	maxRetries := 10
	local := emailLocal
	if local == "" {
		maxRetries = 10
	}
	for attempt := 0; ; attempt++ {
		if local == "" {
			local = randomLocal()
		}
		email := local + "@" + host
		var existing models.Mailbox
		err := h.DB.Where("email = ?", email).First(&existing).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			if err := h.ensureYydsDomainStillReady(d, host, wildcard || subdomain != ""); err != nil {
				var httpErr httpStatusError
				if errors.As(err, &httpErr) {
					fail(c, httpErr.Status, httpErr.Message)
					return
				}
				fail(c, http.StatusBadRequest, err.Error())
				return
			}
			mailbox, _, err := h.createMailboxWithAccounting(ownerID, d, email, local, host, actor, nil)
			if err != nil {
				if isUniqueConstraintError(err) && attempt+1 < maxRetries {
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
			h.audit("mailbox.create", actor.name(), email, "yyds_compat=true")
			created(c, h.yydsAccountDTO(mailbox, d, subdomain, 0))
			return
		}
		if err != nil {
			fail(c, http.StatusInternalServerError, err.Error())
			return
		}
		if existing.OwnerID == ownerID {
			var count int64
			h.DB.Model(&models.Message{}).Where("mailbox_id = ?", existing.ID).Count(&count)
			h.audit("mailbox.reuse", actor.name(), email, "yyds_compat=true")
			ok(c, h.yydsAccountDTO(existing, d, subdomain, count))
			return
		}
		if attempt+1 >= maxRetries {
			fail(c, http.StatusConflict, "email address already in use; change localPart or omit it to generate a random address")
			return
		}
		local = ""
	}
}

func (h *Handler) yydsGetAccount(c *gin.Context) {
	mailbox, d, allowed := h.yydsMailboxByID(c, c.Param("id"))
	if !allowed {
		return
	}
	var count int64
	if err := h.DB.Model(&models.Message{}).Where("mailbox_id = ?", mailbox.ID).Count(&count).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	ok(c, h.yydsAccountDTO(mailbox, d, yydsSubdomainForMailbox(mailbox, d), count))
}

func (h *Handler) yydsDeleteAccount(c *gin.Context) {
	mailbox, _, allowed := h.yydsMailboxByID(c, c.Param("id"))
	if !allowed {
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
	h.audit("mailbox.delete", h.currentActor(c).name(), mailbox.Email, fmt.Sprintf("yyds_compat=true messages_deleted=%d", messagesDeleted))
	c.Status(http.StatusNoContent)
}

func (h *Handler) yydsListMessages(c *gin.Context) {
	parts, d, allowed := h.authorizeInbox(c, c.Query("address"))
	if !allowed {
		return
	}
	messageQuery, err := h.scopeInboxMessages(h.DB.Model(&models.Message{}), h.currentActor(c), parts.Recipient, d)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	var total int64
	if err := messageQuery.Session(&gorm.Session{}).Count(&total).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	var unreadCount int64
	if err := messageQuery.Session(&gorm.Session{}).Where("seen = ?", false).Count(&unreadCount).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	limit := parseLimit(c.Query("limit"), 50, 200)
	var messages []models.Message
	if err := messageQuery.Session(&gorm.Session{}).Order("created_at desc").Limit(limit).Find(&messages).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	counts, err := h.attachmentCountsForMessages(messages)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]yydsMessageSummaryDTO, 0, len(messages))
	for _, msg := range messages {
		out = append(out, h.yydsMessageSummaryDTO(msg, counts[msg.ID]))
	}
	ok(c, yydsMessagesResponse{Messages: out, Total: total, UnreadCount: unreadCount})
}

func (h *Handler) yydsMarkMailboxRead(c *gin.Context) {
	parts, d, allowed := h.authorizeInbox(c, c.Query("address"))
	if !allowed {
		return
	}
	messageQuery, err := h.scopeInboxMessages(h.DB.Model(&models.Message{}), h.currentActor(c), parts.Recipient, d)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	var total int64
	if err := messageQuery.Session(&gorm.Session{}).Count(&total).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	var alreadySeen int64
	if err := messageQuery.Session(&gorm.Session{}).Where("seen = ?", true).Count(&alreadySeen).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	result := messageQuery.Session(&gorm.Session{}).Where("seen = ?", false).Update("seen", true)
	if result.Error != nil {
		fail(c, http.StatusInternalServerError, result.Error.Error())
		return
	}
	ok(c, yydsMarkReadResponse{
		Mailbox:     parts.Recipient,
		Updated:     result.RowsAffected,
		AlreadySeen: alreadySeen,
		Total:       total,
	})
}

func (h *Handler) yydsGetMessage(c *gin.Context) {
	msg, allowed := h.yydsMessageByID(c, c.Param("id"))
	if !allowed {
		return
	}
	attachments, err := h.attachmentMetadataForMessage(msg.ID)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	ok(c, h.yydsMessageDetailDTO(msg, attachments))
}

func (h *Handler) yydsPatchMessage(c *gin.Context) {
	msg, allowed := h.yydsMessageByID(c, c.Param("id"))
	if !allowed {
		return
	}
	var input struct {
		Seen *bool `json:"seen"`
	}
	if err := c.ShouldBindJSON(&input); err != nil && !errors.Is(err, io.EOF) {
		fail(c, http.StatusBadRequest, "invalid json")
		return
	}
	seen := true
	if input.Seen != nil {
		seen = *input.Seen
	}
	if err := h.DB.Model(&msg).Update("seen", seen).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	ok(c, gin.H{"id": msg.ID, "seen": seen})
}

func (h *Handler) yydsDeleteMessage(c *gin.Context) {
	msg, allowed := h.yydsMessageByID(c, c.Param("id"))
	if !allowed {
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
	c.Status(http.StatusNoContent)
}

func (h *Handler) yydsGetMessageSource(c *gin.Context) {
	msg, allowed := h.yydsMessageByID(c, c.Param("id"))
	if !allowed {
		return
	}
	ok(c, gin.H{
		"id":   msg.ID,
		"data": h.yydsMessageSource(msg),
	})
}

func (h *Handler) yydsUnsupportedTempToken(c *gin.Context) {
	fail(c, http.StatusNotImplemented, "YYDS temporary Bearer token is not implemented; use X-API-Key on /yyds/v1 endpoints")
}

func (h *Handler) yydsAccountTarget(input yydsAccountRequest, actor *requestActor, wildcard bool) (*models.Domain, string, string, string, error) {
	var d *models.Domain
	var err error
	subdomain := sanitizeSubdomain(input.Subdomain)
	if input.Subdomain != "" && subdomain == "" {
		return nil, "", "", "", fmt.Errorf("valid subdomain required")
	}
	local := sanitizeLocal(firstNonEmptyString(input.LocalPart, input.Address))
	host := ""
	if input.Address != "" && strings.Contains(input.Address, "@") {
		parts, err := domaindb.NormalizeRecipient(input.Address)
		if err != nil {
			return nil, "", "", "", fmt.Errorf("valid address required")
		}
		local = sanitizeLocal(parts.Local)
		if strings.TrimSpace(input.Domain) == "" {
			resolved, err := h.Resolver.ResolveDomain(parts.Recipient)
			if err != nil {
				return nil, "", "", "", fmt.Errorf("address domain is not available")
			}
			if !h.canUseDomainForActor(resolved, actor) {
				return nil, "", "", "", fmt.Errorf("domain access denied")
			}
			d = resolved
			host = parts.Host
			subdomain = yydsSubdomainForHost(parts.Host, d.Domain)
		}
	}
	if d == nil {
		d, err = h.selectDomainForActor(input.Domain, actor)
		if err != nil {
			return nil, "", "", "", err
		}
	}
	if wildcard && subdomain == "" {
		subdomain = randomLocal()
	}
	if host == "" {
		host = d.Domain
	}
	if subdomain != "" {
		if !d.IsWildcardReady() {
			return nil, "", "", "", httpStatusError{Status: http.StatusBadRequest, Message: "domain wildcard MX is not enabled"}
		}
		host = subdomain + "." + d.Domain
	}
	if strings.Contains(host, "@") || host == "" {
		return nil, "", "", "", fmt.Errorf("valid domain required")
	}
	return d, local, host, subdomain, nil
}

func (h *Handler) ensureYydsDomainStillReady(d *models.Domain, host string, wildcard bool) error {
	var fresh models.Domain
	if err := h.DB.First(&fresh, "id = ?", d.ID).Error; err != nil {
		return err
	}
	if !fresh.IsRootMailboxReady() {
		return httpStatusError{Status: http.StatusBadRequest, Message: "domain is not active or MX verified"}
	}
	if wildcard || !strings.EqualFold(host, fresh.Domain) {
		if !fresh.IsWildcardReady() {
			return httpStatusError{Status: http.StatusBadRequest, Message: "domain wildcard MX is not enabled"}
		}
	}
	*d = fresh
	return nil
}

func (h *Handler) yydsMailboxByID(c *gin.Context, rawID string) (models.Mailbox, *models.Domain, bool) {
	id, err := strconv.ParseUint(strings.TrimSpace(rawID), 10, 64)
	if err != nil || id == 0 {
		fail(c, http.StatusNotFound, "account not found")
		return models.Mailbox{}, nil, false
	}
	actor := h.currentActor(c)
	ownerID, hasOwner := actor.ownerID()
	if !hasOwner {
		fail(c, http.StatusForbidden, "api key must be bound to an active user")
		return models.Mailbox{}, nil, false
	}
	var mailbox models.Mailbox
	if err := h.DB.First(&mailbox, "id = ?", uint(id)).Error; err != nil {
		fail(c, http.StatusNotFound, "account not found")
		return models.Mailbox{}, nil, false
	}
	if mailbox.OwnerID != ownerID {
		fail(c, http.StatusNotFound, "account not found")
		return models.Mailbox{}, nil, false
	}
	var d models.Domain
	if err := h.DB.First(&d, "id = ?", mailbox.DomainID).Error; err != nil {
		fail(c, http.StatusNotFound, "domain not found")
		return models.Mailbox{}, nil, false
	}
	return mailbox, &d, true
}

func (h *Handler) yydsMessageByID(c *gin.Context, id string) (models.Message, bool) {
	var msg models.Message
	if err := h.DB.First(&msg, "id = ?", id).Error; err != nil {
		fail(c, http.StatusNotFound, "message not found")
		return models.Message{}, false
	}
	if address := strings.TrimSpace(c.Query("address")); address != "" {
		if _, _, allowed := h.authorizeInbox(c, address); !allowed {
			return models.Message{}, false
		}
		if !strings.EqualFold(address, msg.Recipient) {
			fail(c, http.StatusNotFound, "message not found")
			return models.Message{}, false
		}
	} else if _, _, allowed := h.authorizeInbox(c, msg.Recipient); !allowed {
		return models.Message{}, false
	}
	canAccess, err := h.actorCanAccessMessage(h.currentActor(c), msg)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return models.Message{}, false
	}
	if !canAccess {
		fail(c, http.StatusNotFound, "message not found")
		return models.Message{}, false
	}
	return msg, true
}

func (h *Handler) yydsAccountDTO(mailbox models.Mailbox, d *models.Domain, subdomain string, messageCount int64) yydsAccountDTO {
	mode := "fixed"
	if subdomain != "" || !strings.EqualFold(mailbox.Host, d.Domain) {
		mode = "wildcard"
	}
	return yydsAccountDTO{
		ID:           strconv.FormatUint(uint64(mailbox.ID), 10),
		Address:      mailbox.Email,
		Mode:         mode,
		Domain:       mailbox.Host,
		Subdomain:    subdomain,
		Token:        "",
		InboxType:    "temp",
		Source:       "api",
		ExpiresAt:    h.yydsMailboxExpiresAt(mailbox),
		IsActive:     true,
		MessageCount: messageCount,
		CreatedAt:    mailbox.CreatedAt,
	}
}

func (h *Handler) yydsMailboxExpiresAt(mailbox models.Mailbox) time.Time {
	retention := h.Config.MessageRetention
	if retention <= 0 {
		retention = 24 * time.Hour
	}
	return mailbox.CreatedAt.Add(retention)
}

func (h *Handler) yydsMessageSummaryDTO(msg models.Message, attachmentCount int64) yydsMessageSummaryDTO {
	return yydsMessageSummaryDTO{
		ID:             msg.ID,
		InboxID:        yydsMailboxID(msg),
		InboxIDCompat:  yydsMailboxID(msg),
		From:           yydsAddress{Name: msg.FromName, Address: msg.FromAddress},
		To:             []yydsAddress{{Name: "", Address: msg.Recipient}},
		Subject:        msg.Subject,
		Seen:           msg.Seen,
		HasAttachments: attachmentCount > 0,
		Size:           yydsMessageSize(msg),
		CreatedAt:      msg.CreatedAt,
	}
}

func (h *Handler) yydsMessageDetailDTO(msg models.Message, attachments []AttachmentMetadata) yydsMessageDetailDTO {
	html := []string{}
	if strings.TrimSpace(msg.HTMLContent) != "" {
		html = append(html, mailhtml.Sanitize(msg.HTMLContent))
	}
	return yydsMessageDetailDTO{
		ID:             msg.ID,
		From:           yydsAddress{Name: msg.FromName, Address: msg.FromAddress},
		To:             []yydsAddress{{Name: "", Address: msg.Recipient}},
		Subject:        msg.Subject,
		Text:           msg.TextContent,
		HTML:           html,
		Seen:           msg.Seen,
		HasAttachments: len(attachments) > 0,
		Size:           yydsMessageSize(msg),
		CreatedAt:      msg.CreatedAt,
		Attachments:    yydsAttachmentDTOs(attachments),
	}
}

func (h *Handler) yydsMessageSource(msg models.Message) string {
	lines := []string{
		"From: " + yydsFormatAddress(msg.FromName, msg.FromAddress),
		"To: " + msg.Recipient,
		"Subject: " + msg.Subject,
		"Date: " + msg.CreatedAt.UTC().Format(time.RFC1123Z),
	}
	if strings.TrimSpace(msg.HeadersJSON) != "" {
		var headers map[string]string
		if err := json.Unmarshal([]byte(msg.HeadersJSON), &headers); err == nil {
			for key, value := range headers {
				key = strings.TrimSpace(key)
				value = strings.TrimSpace(value)
				if key == "" || value == "" {
					continue
				}
				lines = append(lines, key+": "+value)
			}
		}
	}
	body := msg.TextContent
	if body == "" {
		body = stripTags(msg.HTMLContent)
	}
	return strings.Join(lines, "\r\n") + "\r\n\r\n" + body
}

func (h *Handler) canUseDomainForActor(d *models.Domain, actor *requestActor) bool {
	if d == nil || !d.Active || !d.MXVerified {
		return false
	}
	if d.Mode != models.DomainModePrivate {
		return true
	}
	ownerID, ok := actor.ownerID()
	return ok && d.OwnerID != nil && *d.OwnerID == ownerID
}

func yydsDomainDTOs(domains []models.Domain) []yydsDomainDTO {
	out := make([]yydsDomainDTO, 0, len(domains))
	for _, d := range domains {
		out = append(out, yydsDomainDTO{
			ID:              d.ID,
			Domain:          d.Domain,
			Mode:            d.Mode,
			WildcardEnabled: d.WildcardEnabled,
		})
	}
	return out
}

func yydsAttachmentDTOs(attachments []AttachmentMetadata) []yydsAttachmentDTO {
	out := make([]yydsAttachmentDTO, 0, len(attachments))
	for _, attachment := range attachments {
		out = append(out, yydsAttachmentDTO{
			ID:          attachment.ID,
			Filename:    attachment.Filename,
			ContentType: attachment.ContentType,
			Size:        attachment.SizeBytes,
			DownloadURL: "",
		})
	}
	return out
}

func yydsMessageSize(msg models.Message) int64 {
	return int64(len(msg.Subject) + len(msg.TextContent) + len(msg.HTMLContent) + len(msg.HeadersJSON))
}

func yydsMailboxID(msg models.Message) string {
	if msg.MailboxID == nil {
		return ""
	}
	return strconv.FormatUint(uint64(*msg.MailboxID), 10)
}

func yydsSubdomainForMailbox(mailbox models.Mailbox, d *models.Domain) string {
	if d == nil {
		return ""
	}
	return yydsSubdomainForHost(mailbox.Host, d.Domain)
}

func yydsSubdomainForHost(host, root string) string {
	host = strings.TrimSuffix(strings.ToLower(strings.TrimSpace(host)), ".")
	root = strings.TrimSuffix(strings.ToLower(strings.TrimSpace(root)), ".")
	if host == root || root == "" || !strings.HasSuffix(host, "."+root) {
		return ""
	}
	return strings.TrimSuffix(host[:len(host)-len(root)], ".")
}

func sanitizeSubdomain(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = strings.Trim(value, ".-")
	if value == "" {
		return ""
	}
	labels := strings.Split(value, ".")
	for i, label := range labels {
		var builder strings.Builder
		for _, r := range strings.Trim(label, "-") {
			switch {
			case r >= 'a' && r <= 'z':
				builder.WriteRune(r)
			case r >= '0' && r <= '9':
				builder.WriteRune(r)
			case r == '-':
				builder.WriteRune(r)
			}
		}
		labels[i] = strings.Trim(builder.String(), "-")
		if labels[i] == "" {
			return ""
		}
	}
	return strings.Join(labels, ".")
}

func yydsFormatAddress(name, address string) string {
	name = strings.TrimSpace(name)
	address = strings.TrimSpace(address)
	if name == "" {
		return address
	}
	return name + " <" + address + ">"
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
