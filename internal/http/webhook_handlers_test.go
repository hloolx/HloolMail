package httpapi

import (
	"net/http"
	"strings"
	"testing"

	"gptmail/internal/auth"
	"gptmail/internal/models"
)

func TestWebhookManagementIsSessionOnlyAndSecretOneTime(t *testing.T) {
	db := httpTestDB(t)
	owner := createShareTestUser(t, db, "webhook-owner@example.test")
	domain := createShareTestDomain(t, db, "webhook.test", models.DomainModePrivate, &owner.ID)
	createShareTestMailbox(t, db, owner, domain, "demo@webhook.test")
	router := testRouter(t, db)

	key, plain, err := (auth.APIKeyService{DB: db}).CreateFor(&owner.ID, "webhook-key", 10, 0, nil)
	if err != nil {
		t.Fatal(err)
	}
	apiOnly := perform(router, http.MethodPost, "/api/webhooks", map[string]any{
		"name": "api-only",
		"url":  "https://example.com/hook",
	}, map[string]string{"X-API-Key": plain})
	if apiOnly.Code != http.StatusUnauthorized {
		t.Fatalf("api-key only webhook create = %d: %s", apiOnly.Code, apiOnly.Body.String())
	}
	if err := db.First(key, key.ID).Error; err != nil {
		t.Fatal(err)
	}
	if key.UsedToday != 0 || key.TotalUsed != 0 || key.LastUsedAt != nil {
		t.Fatalf("webhook management consumed api key usage: %+v", key)
	}
	var usageLogs int64
	if err := db.Model(&models.APIUsageLog{}).Count(&usageLogs).Error; err != nil {
		t.Fatal(err)
	}
	if usageLogs != 0 {
		t.Fatalf("api usage logs = %d, want 0", usageLogs)
	}

	login := loginShareTestUser(t, router, owner.Email)
	headers := cookieHeaders(login.Result().Cookies())
	create := perform(router, http.MethodPost, "/api/webhooks", map[string]any{
		"name":   "primary",
		"url":    "https://example.com/hook",
		"scope":  models.WebhookScopeAll,
		"events": []string{models.WebhookEventMessageReceived},
	}, headers)
	if create.Code != http.StatusCreated {
		t.Fatalf("create webhook = %d: %s", create.Code, create.Body.String())
	}
	created := decodeShareEnvelope[WebhookEndpointDTO](t, create.Body.Bytes()).Data
	if created.Secret == "" || created.SecretPreview == "" {
		t.Fatalf("create did not return one-time secret and preview: %+v", created)
	}

	list := perform(router, http.MethodGet, "/api/webhooks", nil, headers)
	if list.Code != http.StatusOK {
		t.Fatalf("list webhooks = %d: %s", list.Code, list.Body.String())
	}
	if strings.Contains(list.Body.String(), created.Secret) {
		t.Fatalf("list leaked one-time secret: %s", list.Body.String())
	}

	testDelivery := perform(router, http.MethodPost, "/api/webhooks/"+uintPath(created.ID)+"/test", nil, headers)
	if testDelivery.Code != http.StatusOK {
		t.Fatalf("test webhook = %d: %s", testDelivery.Code, testDelivery.Body.String())
	}
	var deliveries int64
	if err := db.Model(&models.WebhookDelivery{}).Where("endpoint_id = ?", created.ID).Count(&deliveries).Error; err != nil {
		t.Fatal(err)
	}
	if deliveries != 1 {
		t.Fatalf("test deliveries = %d, want 1", deliveries)
	}

	rotate := perform(router, http.MethodPost, "/api/webhooks/"+uintPath(created.ID)+"/rotate-secret", nil, headers)
	if rotate.Code != http.StatusOK {
		t.Fatalf("rotate secret = %d: %s", rotate.Code, rotate.Body.String())
	}
	rotated := decodeShareEnvelope[WebhookEndpointDTO](t, rotate.Body.Bytes()).Data
	if rotated.Secret == "" || rotated.Secret == created.Secret {
		t.Fatalf("rotate did not return a new one-time secret: before=%q after=%q", created.Secret, rotated.Secret)
	}
}

func TestWebhookScopeConfigurationRequiresOwnership(t *testing.T) {
	db := httpTestDB(t)
	owner := createShareTestUser(t, db, "scope-owner@example.test")
	other := createShareTestUser(t, db, "scope-other@example.test")
	otherDomain := createShareTestDomain(t, db, "other-webhook.test", models.DomainModePrivate, &other.ID)
	otherMailbox := createShareTestMailbox(t, db, other, otherDomain, "demo@other-webhook.test")
	router := testRouter(t, db)
	login := loginShareTestUser(t, router, owner.Email)
	headers := cookieHeaders(login.Result().Cookies())

	domainScope := perform(router, http.MethodPost, "/api/webhooks", map[string]any{
		"name":      "bad-domain",
		"url":       "https://example.com/hook",
		"scope":     models.WebhookScopeDomain,
		"domain_id": otherDomain.ID,
	}, headers)
	if domainScope.Code != http.StatusForbidden {
		t.Fatalf("non-owner domain scope = %d: %s", domainScope.Code, domainScope.Body.String())
	}

	mailboxScope := perform(router, http.MethodPost, "/api/webhooks", map[string]any{
		"name":       "bad-mailbox",
		"url":        "https://example.com/hook",
		"scope":      models.WebhookScopeMailbox,
		"mailbox_id": otherMailbox.ID,
	}, headers)
	if mailboxScope.Code != http.StatusForbidden {
		t.Fatalf("non-owner mailbox scope = %d: %s", mailboxScope.Code, mailboxScope.Body.String())
	}

	unsafeURL := perform(router, http.MethodPost, "/api/webhooks", map[string]any{
		"name": "unsafe",
		"url":  "https://localhost/hook",
	}, headers)
	if unsafeURL.Code != http.StatusBadRequest {
		t.Fatalf("unsafe URL response = %d: %s", unsafeURL.Code, unsafeURL.Body.String())
	}
}
