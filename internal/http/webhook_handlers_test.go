package httpapi

import (
	"net/http"
	"strings"
	"testing"

	"gptmail/internal/auth"
	"gptmail/internal/config"
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

func TestAdminOrdinaryWebhookRoutesAreOwnerScoped(t *testing.T) {
	db := httpTestDB(t)
	owner := createShareTestUser(t, db, "owner-webhook-scope@example.test")
	var admin models.User
	if err := db.First(&admin, "email = ?", "admin@example.test").Error; err != nil {
		t.Fatal(err)
	}
	ownerDomain := createShareTestDomain(t, db, "owner-webhook-scope.test", models.DomainModePrivate, &owner.ID)
	adminDomain := createShareTestDomain(t, db, "admin-webhook-scope.test", models.DomainModePrivate, &admin.ID)
	ownerMailbox := createShareTestMailbox(t, db, owner, ownerDomain, "owner@owner-webhook-scope.test")
	router := testRouter(t, db)
	ownerLogin := loginShareTestUser(t, router, owner.Email)
	adminLogin := loginShareTestUser(t, router, admin.Email)
	ownerHeaders := cookieHeaders(ownerLogin.Result().Cookies())
	adminHeaders := cookieHeaders(adminLogin.Result().Cookies())

	ownerCreate := perform(router, http.MethodPost, "/api/webhooks", map[string]any{
		"name":       "owner-hook",
		"url":        "https://example.com/owner-hook",
		"scope":      models.WebhookScopeMailbox,
		"mailbox_id": ownerMailbox.ID,
		"events":     []string{models.WebhookEventMessageReceived},
	}, ownerHeaders)
	if ownerCreate.Code != http.StatusCreated {
		t.Fatalf("owner create webhook = %d: %s", ownerCreate.Code, ownerCreate.Body.String())
	}
	ownerWebhook := decodeShareEnvelope[WebhookEndpointDTO](t, ownerCreate.Body.Bytes()).Data

	adminCreate := perform(router, http.MethodPost, "/api/webhooks", map[string]any{
		"name":      "admin-hook",
		"url":       "https://example.com/admin-hook",
		"scope":     models.WebhookScopeDomain,
		"domain_id": adminDomain.ID,
		"events":    []string{models.WebhookEventMessageReceived},
	}, adminHeaders)
	if adminCreate.Code != http.StatusCreated {
		t.Fatalf("admin create own webhook = %d: %s", adminCreate.Code, adminCreate.Body.String())
	}
	adminWebhook := decodeShareEnvelope[WebhookEndpointDTO](t, adminCreate.Body.Bytes()).Data

	adminCreateOtherScope := perform(router, http.MethodPost, "/api/webhooks", map[string]any{
		"name":      "admin-bad-scope",
		"url":       "https://example.com/admin-bad-scope",
		"scope":     models.WebhookScopeDomain,
		"domain_id": ownerDomain.ID,
	}, adminHeaders)
	if adminCreateOtherScope.Code != http.StatusForbidden {
		t.Fatalf("admin ordinary create scoped to owner domain = %d: %s", adminCreateOtherScope.Code, adminCreateOtherScope.Body.String())
	}

	adminList := perform(router, http.MethodGet, "/api/webhooks?page=1&per_page=10", nil, adminHeaders)
	if adminList.Code != http.StatusOK {
		t.Fatalf("admin ordinary list = %d: %s", adminList.Code, adminList.Body.String())
	}
	adminPage := decodeShareEnvelope[paginatedResponse[WebhookEndpointDTO]](t, adminList.Body.Bytes()).Data
	if adminPage.Total != 1 || len(adminPage.Items) != 1 || adminPage.Items[0].ID != adminWebhook.ID {
		t.Fatalf("admin ordinary list should contain only admin-owned webhook: %+v", adminPage)
	}
	if strings.Contains(adminList.Body.String(), ownerWebhook.Name) {
		t.Fatalf("admin ordinary list leaked owner webhook: %s", adminList.Body.String())
	}

	for _, tc := range []struct {
		name   string
		method string
		path   string
		body   map[string]any
	}{
		{name: "patch", method: http.MethodPatch, path: "/api/webhooks/" + uintPath(ownerWebhook.ID), body: map[string]any{"enabled": false}},
		{name: "rotate", method: http.MethodPost, path: "/api/webhooks/" + uintPath(ownerWebhook.ID) + "/rotate-secret"},
		{name: "test", method: http.MethodPost, path: "/api/webhooks/" + uintPath(ownerWebhook.ID) + "/test"},
		{name: "deliveries", method: http.MethodGet, path: "/api/webhooks/" + uintPath(ownerWebhook.ID) + "/deliveries"},
		{name: "delete", method: http.MethodDelete, path: "/api/webhooks/" + uintPath(ownerWebhook.ID)},
	} {
		response := perform(router, tc.method, tc.path, tc.body, adminHeaders)
		if response.Code != http.StatusNotFound {
			t.Fatalf("admin ordinary %s owner webhook = %d: %s", tc.name, response.Code, response.Body.String())
		}
	}

	var refreshed models.WebhookEndpoint
	if err := db.First(&refreshed, "id = ?", ownerWebhook.ID).Error; err != nil {
		t.Fatal(err)
	}
	if !refreshed.Enabled {
		t.Fatalf("owner webhook was modified by admin ordinary route: %+v", refreshed)
	}
	var deliveryCount int64
	if err := db.Model(&models.WebhookDelivery{}).Where("endpoint_id = ?", ownerWebhook.ID).Count(&deliveryCount).Error; err != nil {
		t.Fatal(err)
	}
	if deliveryCount != 0 {
		t.Fatalf("admin ordinary test route queued owner delivery count=%d", deliveryCount)
	}
}

func TestAdminWebhookGlobalManagement(t *testing.T) {
	db := httpTestDB(t)
	owner := createShareTestUser(t, db, "global-webhook-owner@example.test")
	regular := createShareTestUser(t, db, "global-webhook-regular@example.test")
	var admin models.User
	if err := db.First(&admin, "email = ?", "admin@example.test").Error; err != nil {
		t.Fatal(err)
	}
	ownerDomain := createShareTestDomain(t, db, "global-webhook-owner.test", models.DomainModePrivate, &owner.ID)
	adminDomain := createShareTestDomain(t, db, "global-webhook-admin.test", models.DomainModePrivate, &admin.ID)
	createShareTestMailbox(t, db, owner, ownerDomain, "owner@global-webhook-owner.test")
	createShareTestMailbox(t, db, admin, adminDomain, "admin@global-webhook-admin.test")
	router := testRouterWithConfig(t, db, func(cfg *config.Config) {
		cfg.AdminToken = "test-admin-token"
	})
	ownerLogin := loginShareTestUser(t, router, owner.Email)
	regularLogin := loginShareTestUser(t, router, regular.Email)
	adminLogin := loginShareTestUser(t, router, admin.Email)
	ownerHeaders := cookieHeaders(ownerLogin.Result().Cookies())
	adminHeaders := cookieHeaders(adminLogin.Result().Cookies())

	ownerCreate := perform(router, http.MethodPost, "/api/webhooks", map[string]any{
		"name":      "owner-global-hook",
		"url":       "https://example.com/owner-global-hook?token=owner-secret",
		"scope":     models.WebhookScopeDomain,
		"domain_id": ownerDomain.ID,
		"events":    []string{models.WebhookEventMessageReceived},
	}, ownerHeaders)
	if ownerCreate.Code != http.StatusCreated {
		t.Fatalf("owner create webhook = %d: %s", ownerCreate.Code, ownerCreate.Body.String())
	}
	ownerWebhook := decodeShareEnvelope[WebhookEndpointDTO](t, ownerCreate.Body.Bytes()).Data
	adminCreate := perform(router, http.MethodPost, "/api/webhooks", map[string]any{
		"name":      "admin-global-hook",
		"url":       "https://example.com/admin-global-hook?token=admin-secret",
		"scope":     models.WebhookScopeDomain,
		"domain_id": adminDomain.ID,
		"events":    []string{models.WebhookEventMessageReceived},
	}, adminHeaders)
	if adminCreate.Code != http.StatusCreated {
		t.Fatalf("admin create webhook = %d: %s", adminCreate.Code, adminCreate.Body.String())
	}
	adminWebhook := decodeShareEnvelope[WebhookEndpointDTO](t, adminCreate.Body.Bytes()).Data

	testDelivery := perform(router, http.MethodPost, "/api/webhooks/"+uintPath(ownerWebhook.ID)+"/test", nil, ownerHeaders)
	if testDelivery.Code != http.StatusOK {
		t.Fatalf("owner test webhook = %d: %s", testDelivery.Code, testDelivery.Body.String())
	}

	userGlobalList := perform(router, http.MethodGet, "/api/admin/webhooks", nil, cookieHeaders(regularLogin.Result().Cookies()))
	if userGlobalList.Code != http.StatusForbidden {
		t.Fatalf("non-admin global webhook list = %d: %s", userGlobalList.Code, userGlobalList.Body.String())
	}
	for _, attempt := range []struct {
		name   string
		method string
		path   string
	}{
		{"list", http.MethodGet, "/api/admin/webhooks"},
		{"deliveries", http.MethodGet, "/api/admin/webhooks/" + uintPath(ownerWebhook.ID) + "/deliveries"},
		{"disable", http.MethodPost, "/api/admin/webhooks/" + uintPath(ownerWebhook.ID) + "/disable"},
		{"delete", http.MethodDelete, "/api/admin/webhooks/" + uintPath(ownerWebhook.ID)},
	} {
		response := perform(router, attempt.method, attempt.path, nil, map[string]string{"X-Admin-Token": "test-admin-token"})
		if response.Code != http.StatusForbidden {
			t.Fatalf("admin token-only global webhook %s = %d: %s", attempt.name, response.Code, response.Body.String())
		}
	}

	adminGlobalList := perform(router, http.MethodGet, "/api/admin/webhooks?page=1&per_page=10", nil, adminHeaders)
	if adminGlobalList.Code != http.StatusOK {
		t.Fatalf("admin global webhook list = %d: %s", adminGlobalList.Code, adminGlobalList.Body.String())
	}
	body := adminGlobalList.Body.String()
	if strings.Contains(body, ownerWebhook.Secret) || strings.Contains(body, adminWebhook.Secret) || strings.Contains(body, `"secret"`) || strings.Contains(body, `"secret_preview"`) {
		t.Fatalf("admin global webhook list leaked secret material: %s", body)
	}
	for _, leaked := range []string{"owner-global-hook?token=owner-secret", "admin-global-hook?token=admin-secret", "token=owner-secret", "token=admin-secret"} {
		if strings.Contains(body, leaked) {
			t.Fatalf("admin global webhook list leaked raw URL material %q: %s", leaked, body)
		}
	}
	globalPage := decodeShareEnvelope[paginatedResponse[AdminWebhookEndpointDTO]](t, adminGlobalList.Body.Bytes()).Data
	if globalPage.Total != 2 || len(globalPage.Items) != 2 {
		t.Fatalf("admin global list should include all webhooks: %+v", globalPage)
	}
	if !adminWebhookPageContains(globalPage, ownerWebhook.ID, owner.Email, ownerDomain.Domain) {
		t.Fatalf("admin global list missing owner webhook metadata: %+v", globalPage)
	}
	if !adminWebhookPageContains(globalPage, adminWebhook.ID, admin.Email, adminDomain.Domain) {
		t.Fatalf("admin global list missing admin webhook metadata: %+v", globalPage)
	}

	if err := db.Model(&models.WebhookDelivery{}).
		Where("endpoint_id = ?", ownerWebhook.ID).
		Updates(map[string]any{
			"response_body": "sensitive response token",
			"error":         "sensitive delivery error",
		}).Error; err != nil {
		t.Fatal(err)
	}
	deliveries := perform(router, http.MethodGet, "/api/admin/webhooks/"+uintPath(ownerWebhook.ID)+"/deliveries?page=1&per_page=20", nil, adminHeaders)
	if deliveries.Code != http.StatusOK {
		t.Fatalf("admin global webhook deliveries = %d: %s", deliveries.Code, deliveries.Body.String())
	}
	if strings.Contains(deliveries.Body.String(), "sensitive response token") || strings.Contains(deliveries.Body.String(), "sensitive delivery error") {
		t.Fatalf("admin global deliveries leaked response details: %s", deliveries.Body.String())
	}
	deliveryPage := decodeShareEnvelope[paginatedResponse[WebhookDeliveryDTO]](t, deliveries.Body.Bytes()).Data
	if deliveryPage.Total != 1 || len(deliveryPage.Items) != 1 || deliveryPage.Items[0].EndpointID != ownerWebhook.ID {
		t.Fatalf("admin global deliveries should show owner webhook delivery: %+v", deliveryPage)
	}
	if deliveryPage.Items[0].ResponseBody != "" || deliveryPage.Items[0].Error != "" {
		t.Fatalf("admin global deliveries should redact response details: %+v", deliveryPage.Items[0])
	}

	disable := perform(router, http.MethodPost, "/api/admin/webhooks/"+uintPath(ownerWebhook.ID)+"/disable", nil, adminHeaders)
	if disable.Code != http.StatusOK {
		t.Fatalf("admin disable owner webhook = %d: %s", disable.Code, disable.Body.String())
	}
	disabled := decodeShareEnvelope[AdminWebhookEndpointDTO](t, disable.Body.Bytes()).Data
	if disabled.Enabled || disabled.DisabledAt == nil {
		t.Fatalf("admin disable response did not mark disabled: %+v", disabled)
	}
	if strings.Contains(disabled.URL, "owner-global-hook") || strings.Contains(disabled.URL, "token=owner-secret") {
		t.Fatalf("admin disable response leaked raw webhook URL: %+v", disabled)
	}

	deleteResponse := perform(router, http.MethodDelete, "/api/admin/webhooks/"+uintPath(ownerWebhook.ID), nil, adminHeaders)
	if deleteResponse.Code != http.StatusOK {
		t.Fatalf("admin delete owner webhook = %d: %s", deleteResponse.Code, deleteResponse.Body.String())
	}
	var remaining int64
	if err := db.Model(&models.WebhookEndpoint{}).Where("id = ?", ownerWebhook.ID).Count(&remaining).Error; err != nil {
		t.Fatal(err)
	}
	if remaining != 0 {
		t.Fatalf("owner webhook should be deleted by admin global route, remaining=%d", remaining)
	}
}

func adminWebhookPageContains(page paginatedResponse[AdminWebhookEndpointDTO], id uint, ownerEmail, domainName string) bool {
	for _, item := range page.Items {
		if item.ID == id && item.OwnerEmail == ownerEmail && item.DomainName == domainName {
			return true
		}
	}
	return false
}
