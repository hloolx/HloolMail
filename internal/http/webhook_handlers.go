package httpapi

import (
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"gptmail/internal/models"
	"gptmail/internal/webhook"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type createWebhookRequest struct {
	Name      string   `json:"name"`
	URL       string   `json:"url"`
	Events    []string `json:"events"`
	Scope     string   `json:"scope"`
	DomainID  *uint    `json:"domain_id"`
	MailboxID *uint    `json:"mailbox_id"`
	Enabled   *bool    `json:"enabled"`
}

type patchWebhookRequest struct {
	Name      *string   `json:"name"`
	URL       *string   `json:"url"`
	Events    *[]string `json:"events"`
	Scope     *string   `json:"scope"`
	DomainID  *uint     `json:"domain_id"`
	MailboxID *uint     `json:"mailbox_id"`
	Enabled   *bool     `json:"enabled"`
}

func (h *Handler) listWebhooks(c *gin.Context) {
	user, loggedIn := h.requireLogin(c)
	if !loggedIn {
		return
	}
	page := parsePage(c.Query("page"))
	perPage := parseLimit(c.Query("per_page"), 10, 100)
	query := h.webhookEndpointsForUser(user)
	var total int64
	if err := query.Session(&gorm.Session{}).Count(&total).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	totalPages := pageCount(total, perPage)
	if page > totalPages {
		page = totalPages
	}
	var endpoints []models.WebhookEndpoint
	if err := query.Order("created_at desc").
		Limit(perPage).
		Offset((page - 1) * perPage).
		Find(&endpoints).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	items := make([]WebhookEndpointDTO, 0, len(endpoints))
	for _, endpoint := range endpoints {
		items = append(items, webhookEndpointDTO(endpoint, ""))
	}
	webOK(c, paginatedResponse[WebhookEndpointDTO]{
		Items:      items,
		Page:       page,
		PerPage:    perPage,
		Total:      total,
		TotalPages: totalPages,
	})
}

func (h *Handler) createWebhook(c *gin.Context) {
	user, loggedIn := h.requireLogin(c)
	if !loggedIn {
		return
	}
	var input createWebhookRequest
	if err := c.ShouldBindJSON(&input); err != nil && !errors.Is(err, io.EOF) {
		fail(c, http.StatusBadRequest, "invalid json")
		return
	}
	name := strings.TrimSpace(input.Name)
	if name == "" {
		fail(c, http.StatusBadRequest, "name is required")
		return
	}
	targetURL := strings.TrimSpace(input.URL)
	if err := webhook.ValidateEndpointURL(targetURL); err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	eventsJSON, err := webhook.EventsJSON(input.Events)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	scope, domainID, mailboxID, ok := h.validateWebhookScope(c, user, input.Scope, input.DomainID, input.MailboxID)
	if !ok {
		return
	}
	enabled := true
	if input.Enabled != nil {
		enabled = *input.Enabled
	}
	var disabledAt *time.Time
	if !enabled {
		now := time.Now()
		disabledAt = &now
	}
	secret, err := newWebhookSecret()
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	endpoint := models.WebhookEndpoint{
		OwnerID:       user.ID,
		Name:          name,
		URL:           targetURL,
		Secret:        secret,
		SecretPreview: webhookSecretPreview(secret),
		Enabled:       enabled,
		EventsJSON:    eventsJSON,
		Scope:         scope,
		DomainID:      domainID,
		MailboxID:     mailboxID,
		DisabledAt:    disabledAt,
	}
	if err := h.DB.Create(&endpoint).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	created(c, webhookEndpointDTO(endpoint, secret))
}

func (h *Handler) patchWebhook(c *gin.Context) {
	user, loggedIn := h.requireLogin(c)
	if !loggedIn {
		return
	}
	endpoint, ok := h.findWebhookEndpointForUser(c, user)
	if !ok {
		return
	}
	var input patchWebhookRequest
	if err := c.ShouldBindJSON(&input); err != nil && !errors.Is(err, io.EOF) {
		fail(c, http.StatusBadRequest, "invalid json")
		return
	}
	updates := map[string]any{}
	if input.Name != nil {
		name := strings.TrimSpace(*input.Name)
		if name == "" {
			fail(c, http.StatusBadRequest, "name is required")
			return
		}
		updates["name"] = name
	}
	if input.URL != nil {
		targetURL := strings.TrimSpace(*input.URL)
		if err := webhook.ValidateEndpointURL(targetURL); err != nil {
			fail(c, http.StatusBadRequest, err.Error())
			return
		}
		updates["url"] = targetURL
	}
	if input.Events != nil {
		eventsJSON, err := webhook.EventsJSON(*input.Events)
		if err != nil {
			fail(c, http.StatusBadRequest, err.Error())
			return
		}
		updates["events_json"] = eventsJSON
	}
	if input.Scope != nil || input.DomainID != nil || input.MailboxID != nil {
		scope := endpoint.Scope
		if input.Scope != nil {
			scope = *input.Scope
		}
		domainID := endpoint.DomainID
		mailboxID := endpoint.MailboxID
		if input.DomainID != nil {
			domainID = input.DomainID
		}
		if input.MailboxID != nil {
			mailboxID = input.MailboxID
		}
		validScope, validDomainID, validMailboxID, ok := h.validateWebhookScope(c, user, scope, domainID, mailboxID)
		if !ok {
			return
		}
		updates["scope"] = validScope
		updates["domain_id"] = validDomainID
		updates["mailbox_id"] = validMailboxID
	}
	if input.Enabled != nil {
		updates["enabled"] = *input.Enabled
		if *input.Enabled {
			updates["disabled_at"] = nil
		} else {
			now := time.Now()
			updates["disabled_at"] = &now
		}
	}
	if len(updates) > 0 {
		if err := h.DB.Model(endpoint).Updates(updates).Error; err != nil {
			fail(c, http.StatusInternalServerError, err.Error())
			return
		}
		if err := h.DB.First(endpoint, "id = ?", endpoint.ID).Error; err != nil {
			fail(c, http.StatusInternalServerError, err.Error())
			return
		}
	}
	webOK(c, webhookEndpointDTO(*endpoint, ""))
}

func (h *Handler) deleteWebhook(c *gin.Context) {
	user, loggedIn := h.requireLogin(c)
	if !loggedIn {
		return
	}
	endpoint, ok := h.findWebhookEndpointForUser(c, user)
	if !ok {
		return
	}
	if err := h.DB.Delete(endpoint).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	webOK(c, gin.H{"deleted": true})
}

func (h *Handler) rotateWebhookSecret(c *gin.Context) {
	user, loggedIn := h.requireLogin(c)
	if !loggedIn {
		return
	}
	endpoint, ok := h.findWebhookEndpointForUser(c, user)
	if !ok {
		return
	}
	secret, err := newWebhookSecret()
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	if err := h.DB.Model(endpoint).Updates(map[string]any{
		"secret":         secret,
		"secret_preview": webhookSecretPreview(secret),
	}).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	endpoint.Secret = secret
	endpoint.SecretPreview = webhookSecretPreview(secret)
	webOK(c, webhookEndpointDTO(*endpoint, secret))
}

func (h *Handler) testWebhook(c *gin.Context) {
	user, loggedIn := h.requireLogin(c)
	if !loggedIn {
		return
	}
	endpoint, ok := h.findWebhookEndpointForUser(c, user)
	if !ok {
		return
	}
	delivery, err := webhook.EnqueueTestDelivery(h.DB, *endpoint, time.Now())
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	webOK(c, webhookDeliveryDTO(*delivery))
}

func (h *Handler) listWebhookDeliveries(c *gin.Context) {
	user, loggedIn := h.requireLogin(c)
	if !loggedIn {
		return
	}
	endpoint, ok := h.findWebhookEndpointForUser(c, user)
	if !ok {
		return
	}
	page := parsePage(c.Query("page"))
	perPage := parseLimit(c.Query("per_page"), 20, 100)
	query := h.DB.Model(&models.WebhookDelivery{}).Where("endpoint_id = ?", endpoint.ID)
	var total int64
	if err := query.Session(&gorm.Session{}).Count(&total).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	totalPages := pageCount(total, perPage)
	if page > totalPages {
		page = totalPages
	}
	var deliveries []models.WebhookDelivery
	if err := query.Order("created_at desc").
		Limit(perPage).
		Offset((page - 1) * perPage).
		Find(&deliveries).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	items := make([]WebhookDeliveryDTO, 0, len(deliveries))
	for _, delivery := range deliveries {
		items = append(items, webhookDeliveryDTO(delivery))
	}
	webOK(c, paginatedResponse[WebhookDeliveryDTO]{
		Items:      items,
		Page:       page,
		PerPage:    perPage,
		Total:      total,
		TotalPages: totalPages,
	})
}

func (h *Handler) webhookEndpointsForUser(user *models.User) *gorm.DB {
	query := h.DB.Model(&models.WebhookEndpoint{})
	if user == nil {
		return query.Where("1 = 0")
	}
	if user.Role != models.UserRoleAdmin {
		query = query.Where("owner_id = ?", user.ID)
	}
	return query
}

func (h *Handler) findWebhookEndpointForUser(c *gin.Context, user *models.User) (*models.WebhookEndpoint, bool) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		fail(c, http.StatusNotFound, "webhook not found")
		return nil, false
	}
	var endpoint models.WebhookEndpoint
	err = h.webhookEndpointsForUser(user).Where("id = ?", uint(id)).First(&endpoint).Error
	if err == nil {
		return &endpoint, true
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		fail(c, http.StatusNotFound, "webhook not found")
		return nil, false
	}
	fail(c, http.StatusInternalServerError, err.Error())
	return nil, false
}

func (h *Handler) validateWebhookScope(c *gin.Context, user *models.User, rawScope string, domainID, mailboxID *uint) (string, *uint, *uint, bool) {
	scope := strings.TrimSpace(rawScope)
	if scope == "" {
		scope = models.WebhookScopeAll
	}
	switch scope {
	case models.WebhookScopeAll:
		return scope, nil, nil, true
	case models.WebhookScopeDomain:
		if domainID == nil || *domainID == 0 {
			fail(c, http.StatusBadRequest, "domain_id is required for domain scope")
			return "", nil, nil, false
		}
		var domain models.Domain
		if err := h.DB.First(&domain, "id = ?", *domainID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				fail(c, http.StatusNotFound, "domain not found")
				return "", nil, nil, false
			}
			fail(c, http.StatusInternalServerError, err.Error())
			return "", nil, nil, false
		}
		if user.Role != models.UserRoleAdmin && (domain.OwnerID == nil || *domain.OwnerID != user.ID) {
			fail(c, http.StatusForbidden, "domain access denied")
			return "", nil, nil, false
		}
		return scope, domainID, nil, true
	case models.WebhookScopeMailbox:
		if mailboxID == nil || *mailboxID == 0 {
			fail(c, http.StatusBadRequest, "mailbox_id is required for mailbox scope")
			return "", nil, nil, false
		}
		var mailbox models.Mailbox
		if err := h.DB.First(&mailbox, "id = ?", *mailboxID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				fail(c, http.StatusNotFound, "mailbox not found")
				return "", nil, nil, false
			}
			fail(c, http.StatusInternalServerError, err.Error())
			return "", nil, nil, false
		}
		if user.Role != models.UserRoleAdmin && mailbox.OwnerID != user.ID {
			fail(c, http.StatusForbidden, "mailbox access denied")
			return "", nil, nil, false
		}
		return scope, nil, mailboxID, true
	default:
		fail(c, http.StatusBadRequest, "invalid webhook scope")
		return "", nil, nil, false
	}
}

func webhookEndpointDTO(endpoint models.WebhookEndpoint, secret string) WebhookEndpointDTO {
	events, _ := webhook.EventsFromJSON(endpoint.EventsJSON)
	return WebhookEndpointDTO{
		ID:            endpoint.ID,
		Name:          endpoint.Name,
		URL:           endpoint.URL,
		Secret:        secret,
		SecretPreview: endpoint.SecretPreview,
		Enabled:       endpoint.Enabled,
		Events:        events,
		Scope:         endpoint.Scope,
		DomainID:      endpoint.DomainID,
		MailboxID:     endpoint.MailboxID,
		LastSuccessAt: endpoint.LastSuccessAt,
		LastFailureAt: endpoint.LastFailureAt,
		FailureCount:  endpoint.FailureCount,
		DisabledAt:    endpoint.DisabledAt,
		CreatedAt:     endpoint.CreatedAt,
		UpdatedAt:     endpoint.UpdatedAt,
	}
}

func webhookDeliveryDTO(delivery models.WebhookDelivery) WebhookDeliveryDTO {
	return WebhookDeliveryDTO{
		ID:             delivery.ID,
		EndpointID:     delivery.EndpointID,
		EventType:      delivery.EventType,
		MessageID:      delivery.MessageID,
		Status:         delivery.Status,
		AttemptCount:   delivery.AttemptCount,
		MaxAttempts:    delivery.MaxAttempts,
		NextAttemptAt:  delivery.NextAttemptAt,
		LastAttemptAt:  delivery.LastAttemptAt,
		SucceededAt:    delivery.SucceededAt,
		ResponseStatus: delivery.ResponseStatus,
		ResponseBody:   delivery.ResponseBody,
		Error:          delivery.Error,
		CreatedAt:      delivery.CreatedAt,
		UpdatedAt:      delivery.UpdatedAt,
	}
}

func newWebhookSecret() (string, error) {
	random, err := randomURLToken(32)
	if err != nil {
		return "", err
	}
	return "whsec_" + random, nil
}

func webhookSecretPreview(secret string) string {
	if len(secret) <= 14 {
		return secret
	}
	return secret[:10] + "..." + secret[len(secret)-4:]
}
