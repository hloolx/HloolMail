package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"gptmail/internal/auth"
	"gptmail/internal/config"
	"gptmail/internal/domain"
	"gptmail/internal/events"
	"gptmail/internal/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func TestPrivateDomainAccessRequiresToken(t *testing.T) {
	db := httpTestDB(t)
	hash, err := auth.HashSecret("password123")
	if err != nil {
		t.Fatal(err)
	}
	admin := models.User{
		Email:        "admin@example.com",
		PasswordHash: hash,
		Role:         models.UserRoleAdmin,
		Enabled:      true,
	}
	if err := db.Create(&admin).Error; err != nil {
		t.Fatal(err)
	}
	owner := models.User{
		Email:        "owner@example.com",
		PasswordHash: hash,
		Role:         models.UserRoleUser,
		Enabled:      true,
		DailyLimit:   1000,
	}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	nonOwner := models.User{
		Email:        "other@example.com",
		PasswordHash: hash,
		Role:         models.UserRoleUser,
		Enabled:      true,
		DailyLimit:   1000,
	}
	if err := db.Create(&nonOwner).Error; err != nil {
		t.Fatal(err)
	}
	private := models.Domain{
		Domain:          "private.test",
		Mode:            models.DomainModePrivate,
		OwnerID:         &owner.ID,
		Active:          true,
		MXVerified:      true,
		WildcardEnabled: true,
	}
	if err := db.Create(&private).Error; err != nil {
		t.Fatal(err)
	}
	router := testRouter(t, db)

	// Anonymous should be rejected
	response := perform(router, http.MethodGet, "/api/emails?email=demo@private.test", nil, nil)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for anonymous, got %d", response.Code)
	}

	// Owner login and access
	login := perform(router, http.MethodPost, "/api/auth/login", map[string]any{
		"email":    "owner@example.com",
		"password": "password123",
	}, nil)
	if login.Code != http.StatusOK {
		t.Fatalf("login response = %d: %s", login.Code, login.Body.String())
	}
	ownerRequest := httptest.NewRequest(http.MethodGet, "/api/emails?email=demo@private.test", nil)
	for _, cookie := range login.Result().Cookies() {
		ownerRequest.AddCookie(cookie)
	}
	ownerResponse := httptest.NewRecorder()
	router.ServeHTTP(ownerResponse, ownerRequest)
	if ownerResponse.Code != http.StatusOK {
		t.Fatalf("expected 200 with owner session, got %d: %s", ownerResponse.Code, ownerResponse.Body.String())
	}

	// Non-owner should be rejected
	nonOwnerLogin := perform(router, http.MethodPost, "/api/auth/login", map[string]any{
		"email":    "other@example.com",
		"password": "password123",
	}, nil)
	if nonOwnerLogin.Code != http.StatusOK {
		t.Fatalf("non-owner login = %d: %s", nonOwnerLogin.Code, nonOwnerLogin.Body.String())
	}
	nonOwnerRequest := httptest.NewRequest(http.MethodGet, "/api/emails?email=demo@private.test", nil)
	for _, cookie := range nonOwnerLogin.Result().Cookies() {
		nonOwnerRequest.AddCookie(cookie)
	}
	nonOwnerResponse := httptest.NewRecorder()
	router.ServeHTTP(nonOwnerResponse, nonOwnerRequest)
	if nonOwnerResponse.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for non-owner, got %d: %s", nonOwnerResponse.Code, nonOwnerResponse.Body.String())
	}
}

func TestAPIDocsMarkdownEndpoint(t *testing.T) {
	db := httpTestDB(t)
	router := testRouter(t, db)

	response := perform(router, http.MethodGet, "/api/docs.md", nil, nil)
	if response.Code != http.StatusOK {
		t.Fatalf("docs response = %d: %s", response.Code, response.Body.String())
	}
	if contentType := response.Header().Get("Content-Type"); !strings.Contains(contentType, "text/markdown") {
		t.Fatalf("expected markdown content type, got %q", contentType)
	}
	body := response.Body.String()
	if strings.Contains(strings.ToLower(body), "<!doctype html") {
		t.Fatalf("docs endpoint returned html fallback: %s", body[:min(len(body), 120)])
	}
	for _, want := range []string{"HLOOL Mail API Guide for AI Assistants", "X-API-Key", "/api/generate-email", "/api/emails/next?email=", "/api/email/:id/read"} {
		if !strings.Contains(body, want) {
			t.Fatalf("docs body missing %q", want)
		}
	}
	for _, forbidden := range []string{"llm-api-docs", "Cookie", "HTTP_ADDR", "SMTP_ADDR", "TCP 25", "/api/inbox-stream", "SSE"} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("docs body should not contain %q: %s", forbidden, body[:min(len(body), 240)])
		}
	}
}

func TestAPISkillMarkdownEndpoint(t *testing.T) {
	db := httpTestDB(t)
	router := testRouter(t, db)

	response := perform(router, http.MethodGet, "/api/skill.md", nil, nil)
	if response.Code != http.StatusOK {
		t.Fatalf("skill response = %d: %s", response.Code, response.Body.String())
	}
	if contentType := response.Header().Get("Content-Type"); !strings.Contains(contentType, "text/markdown") {
		t.Fatalf("expected markdown content type, got %q", contentType)
	}
	body := response.Body.String()
	for _, want := range []string{"name: hlool-mail-api", "HLOOL Mail API Skill", "/api/docs.md", "X-API-Key", "/api/emails/next?email="} {
		if !strings.Contains(body, want) {
			t.Fatalf("skill body missing %q", want)
		}
	}
	for _, forbidden := range []string{"llm-api-docs", "Cookie", "HTTP_ADDR", "SMTP_ADDR", "TCP 25", "/api/inbox-stream", "SSE"} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("skill body should not contain %q: %s", forbidden, body[:min(len(body), 240)])
		}
	}
}

func TestAPIQuotaMiddleware(t *testing.T) {
	db := httpTestDB(t)
	router := testRouter(t, db)
	service := auth.APIKeyService{DB: db}
	_, plain, err := service.Create("one-shot", 1, 0)
	if err != nil {
		t.Fatal(err)
	}
	headers := map[string]string{"X-API-Key": plain}
	first := perform(router, http.MethodGet, "/api/health", nil, headers)
	if first.Code != http.StatusOK {
		t.Fatalf("first response = %d: %s", first.Code, first.Body.String())
	}
	second := perform(router, http.MethodGet, "/api/health", nil, headers)
	if second.Code != http.StatusTooManyRequests {
		t.Fatalf("second response = %d: %s", second.Code, second.Body.String())
	}
}

func TestAPIKeyQueryParamDisabledByDefault(t *testing.T) {
	db := httpTestDB(t)
	router := testRouter(t, db)
	service := auth.APIKeyService{DB: db}
	_, plain, err := service.Create("query-param", 20, 0)
	if err != nil {
		t.Fatal(err)
	}

	response := perform(router, http.MethodGet, "/api/stats?api_key="+plain, nil, nil)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected query parameter API key to be ignored by default, got %d: %s", response.Code, response.Body.String())
	}
	if warning := response.Header().Get("X-API-Key-Warning"); warning != "" {
		t.Fatalf("unexpected query parameter warning when support is disabled: %q", warning)
	}
}

func TestAPIKeyQueryParamCanBeEnabledForMigration(t *testing.T) {
	db := httpTestDB(t)
	router := testRouterWithConfig(t, db, func(cfg *config.Config) {
		cfg.AllowAPIKeyQueryParam = true
	})
	service := auth.APIKeyService{DB: db}
	_, plain, err := service.Create("query-param", 20, 0)
	if err != nil {
		t.Fatal(err)
	}

	response := perform(router, http.MethodGet, "/api/stats?api_key="+plain, nil, nil)
	if response.Code != http.StatusOK {
		t.Fatalf("query parameter API key with migration flag = %d: %s", response.Code, response.Body.String())
	}
	if warning := response.Header().Get("X-API-Key-Warning"); warning != "query-string-detected" {
		t.Fatalf("warning header = %q, want query-string-detected", warning)
	}
}

func TestAPIKeyResponsesRedactStoredSecret(t *testing.T) {
	db := httpTestDB(t)
	hash, err := auth.HashSecret("password123")
	if err != nil {
		t.Fatal(err)
	}
	admin := models.User{
		Email:        "admin@example.com",
		PasswordHash: hash,
		Role:         models.UserRoleAdmin,
		Enabled:      true,
	}
	if err := db.Create(&admin).Error; err != nil {
		t.Fatal(err)
	}
	router := testRouter(t, db)
	login := perform(router, http.MethodPost, "/api/auth/login", map[string]any{
		"email":    "admin@example.com",
		"password": "password123",
	}, nil)
	if login.Code != http.StatusOK {
		t.Fatalf("login = %d: %s", login.Code, login.Body.String())
	}

	create := httptest.NewRequest(http.MethodPost, "/api/api-keys", bytes.NewReader([]byte(`{"name":"redacted","daily_limit":10,"total_limit":0}`)))
	create.Header.Set("Content-Type", "application/json")
	for _, cookie := range login.Result().Cookies() {
		create.AddCookie(cookie)
	}
	createResponse := httptest.NewRecorder()
	router.ServeHTTP(createResponse, create)
	if createResponse.Code != http.StatusCreated {
		t.Fatalf("create api key = %d: %s", createResponse.Code, createResponse.Body.String())
	}
	var created struct {
		Data struct {
			APIKey   map[string]any `json:"api_key"`
			PlainKey string         `json:"plain_key"`
		} `json:"data"`
	}
	if err := json.Unmarshal(createResponse.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.Data.PlainKey == "" {
		t.Fatal("plain_key was not returned on create")
	}
	if _, exists := created.Data.APIKey["key"]; exists {
		t.Fatalf("api_key payload exposed key: %s", createResponse.Body.String())
	}
	id := int(created.Data.APIKey["id"].(float64))

	list := httptest.NewRequest(http.MethodGet, "/api/api-keys", nil)
	for _, cookie := range login.Result().Cookies() {
		list.AddCookie(cookie)
	}
	listResponse := httptest.NewRecorder()
	router.ServeHTTP(listResponse, list)
	if listResponse.Code != http.StatusOK {
		t.Fatalf("list api keys = %d: %s", listResponse.Code, listResponse.Body.String())
	}
	if strings.Contains(listResponse.Body.String(), created.Data.PlainKey) {
		t.Fatalf("list response exposed plain key: %s", listResponse.Body.String())
	}

	patch := httptest.NewRequest(http.MethodPatch, "/api/api-keys/"+strconv.Itoa(id), bytes.NewReader([]byte(`{"enabled":false}`)))
	patch.Header.Set("Content-Type", "application/json")
	for _, cookie := range login.Result().Cookies() {
		patch.AddCookie(cookie)
	}
	patchResponse := httptest.NewRecorder()
	router.ServeHTTP(patchResponse, patch)
	if patchResponse.Code != http.StatusOK {
		t.Fatalf("patch api key = %d: %s", patchResponse.Code, patchResponse.Body.String())
	}
	if strings.Contains(patchResponse.Body.String(), created.Data.PlainKey) {
		t.Fatalf("patch response exposed plain key: %s", patchResponse.Body.String())
	}
}

func TestAPIKeyCanGenerateAndReadOwnedMailbox(t *testing.T) {
	db := httpTestDB(t)
	hash, err := auth.HashSecret("password123")
	if err != nil {
		t.Fatal(err)
	}
	admin := models.User{
		Email:        "admin@example.com",
		PasswordHash: hash,
		Role:         models.UserRoleAdmin,
		Enabled:      true,
	}
	owner := models.User{
		Email:        "owner@example.com",
		PasswordHash: hash,
		Role:         models.UserRoleUser,
		Enabled:      true,
		DailyLimit:   1000,
	}
	if err := db.Create(&admin).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	other := models.User{
		Email:        "other@example.com",
		PasswordHash: hash,
		Role:         models.UserRoleUser,
		Enabled:      true,
		DailyLimit:   1000,
	}
	if err := db.Create(&other).Error; err != nil {
		t.Fatal(err)
	}
	publicDomain := models.Domain{
		Domain:     "public.test",
		Mode:       models.DomainModePublic,
		Active:     true,
		MXVerified: true,
	}
	if err := db.Create(&publicDomain).Error; err != nil {
		t.Fatal(err)
	}
	router := testRouter(t, db)
	service := auth.APIKeyService{DB: db}
	_, ownerPlain, err := service.CreateFor(&owner.ID, "owner-key", 20, 0, nil)
	if err != nil {
		t.Fatal(err)
	}
	_, otherPlain, err := service.CreateFor(&other.ID, "other-key", 20, 0, nil)
	if err != nil {
		t.Fatal(err)
	}

	anonymousStats := perform(router, http.MethodGet, "/api/stats", nil, nil)
	if anonymousStats.Code != http.StatusUnauthorized {
		t.Fatalf("expected anonymous stats to be 401, got %d: %s", anonymousStats.Code, anonymousStats.Body.String())
	}

	headers := map[string]string{"X-API-Key": ownerPlain}
	generated := perform(router, http.MethodPost, "/api/generate-email", map[string]any{
		"prefix": "demo",
		"domain": "public.test",
	}, headers)
	if generated.Code != http.StatusCreated {
		t.Fatalf("generate with api key = %d: %s", generated.Code, generated.Body.String())
	}
	var generatedBody struct {
		Success bool `json:"success"`
		Data    struct {
			Email string `json:"email"`
		} `json:"data"`
	}
	if err := json.Unmarshal(generated.Body.Bytes(), &generatedBody); err != nil {
		t.Fatal(err)
	}
	if generatedBody.Data.Email != "demo@public.test" {
		t.Fatalf("generated email = %q", generatedBody.Data.Email)
	}

	now := time.Now()
	message := models.Message{
		ID:              "message-api-key",
		Recipient:       generatedBody.Data.Email,
		RecipientLocal:  "demo",
		RecipientDomain: "public.test",
		RootDomain:      "public.test",
		DomainID:        &publicDomain.ID,
		FromAddress:     "sender@example.com",
		Subject:         "hello",
		TextContent:     "body",
		CreatedAt:       now,
		ExpiresAt:       now.Add(time.Hour),
	}
	if err := db.Create(&message).Error; err != nil {
		t.Fatal(err)
	}

	inbox := perform(router, http.MethodGet, "/api/emails?email=demo@public.test", nil, headers)
	if inbox.Code != http.StatusOK {
		t.Fatalf("inbox with owner api key = %d: %s", inbox.Code, inbox.Body.String())
	}
	otherInbox := perform(router, http.MethodGet, "/api/emails?email=demo@public.test", nil, map[string]string{"X-API-Key": otherPlain})
	if otherInbox.Code != http.StatusForbidden {
		t.Fatalf("inbox with other api key = %d: %s", otherInbox.Code, otherInbox.Body.String())
	}
	stats := perform(router, http.MethodGet, "/api/stats", nil, headers)
	if stats.Code != http.StatusOK {
		t.Fatalf("stats with api key = %d: %s", stats.Code, stats.Body.String())
	}
}

func TestPublicMailboxDailyQuotaDoesNotAffectPrivateDomain(t *testing.T) {
	db := httpTestDB(t)
	hash, err := auth.HashSecret("password123")
	if err != nil {
		t.Fatal(err)
	}
	admin := models.User{
		Email:        "admin@example.com",
		PasswordHash: hash,
		Role:         models.UserRoleAdmin,
		Enabled:      true,
	}
	if err := db.Create(&admin).Error; err != nil {
		t.Fatal(err)
	}
	owner := models.User{
		Email:        "owner@example.com",
		PasswordHash: hash,
		Role:         models.UserRoleUser,
		Enabled:      true,
		DailyLimit:   1000,
	}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	settings := models.SystemQuotaSettings{
		ID:                          1,
		UserDailyPublicMailboxLimit: 1,
	}
	if err := db.Create(&settings).Error; err != nil {
		t.Fatal(err)
	}
	publicDomain := models.Domain{
		Domain:     "public-quota.test",
		Mode:       models.DomainModePublic,
		Active:     true,
		MXVerified: true,
	}
	privateDomain := models.Domain{
		Domain:     "private-quota.test",
		Mode:       models.DomainModePrivate,
		OwnerID:    &owner.ID,
		Active:     true,
		MXVerified: true,
	}
	if err := db.Create(&publicDomain).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&privateDomain).Error; err != nil {
		t.Fatal(err)
	}
	router := testRouter(t, db)
	_, plain, err := (auth.APIKeyService{DB: db}).CreateFor(&owner.ID, "owner-key", 20, 0, nil)
	if err != nil {
		t.Fatal(err)
	}
	headers := map[string]string{"X-API-Key": plain}

	firstPublic := perform(router, http.MethodPost, "/api/generate-email", map[string]any{
		"prefix": "one",
		"domain": "public-quota.test",
	}, headers)
	if firstPublic.Code != http.StatusCreated {
		t.Fatalf("first public generate = %d: %s", firstPublic.Code, firstPublic.Body.String())
	}
	secondPublic := perform(router, http.MethodPost, "/api/generate-email", map[string]any{
		"prefix": "two",
		"domain": "public-quota.test",
	}, headers)
	if secondPublic.Code != http.StatusTooManyRequests {
		t.Fatalf("second public generate = %d: %s", secondPublic.Code, secondPublic.Body.String())
	}
	private := perform(router, http.MethodPost, "/api/generate-email", map[string]any{
		"prefix": "mine",
		"domain": "private-quota.test",
	}, headers)
	if private.Code != http.StatusCreated {
		t.Fatalf("private generate after public quota = %d: %s", private.Code, private.Body.String())
	}
	var refreshed models.User
	if err := db.First(&refreshed, owner.ID).Error; err != nil {
		t.Fatal(err)
	}
	if refreshed.PublicMailboxCreated != 1 || refreshed.PublicMailboxToday != 1 || refreshed.PrivateMailboxCreated != 1 {
		t.Fatalf("mailbox counters public/today/private = %d/%d/%d, want 1/1/1", refreshed.PublicMailboxCreated, refreshed.PublicMailboxToday, refreshed.PrivateMailboxCreated)
	}
}

func TestUserDailyLimitAppliesOnlyToPublicMailboxCreation(t *testing.T) {
	db := httpTestDB(t)
	hash, err := auth.HashSecret("password123")
	if err != nil {
		t.Fatal(err)
	}
	admin := models.User{
		Email:        "admin@example.com",
		PasswordHash: hash,
		Role:         models.UserRoleAdmin,
		Enabled:      true,
	}
	if err := db.Create(&admin).Error; err != nil {
		t.Fatal(err)
	}
	owner := models.User{
		Email:        "owner@example.com",
		PasswordHash: hash,
		Role:         models.UserRoleUser,
		Enabled:      true,
		DailyLimit:   1,
	}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	publicDomain := models.Domain{
		Domain:     "user-public-quota.test",
		Mode:       models.DomainModePublic,
		Active:     true,
		MXVerified: true,
	}
	privateDomain := models.Domain{
		Domain:     "user-private-quota.test",
		Mode:       models.DomainModePrivate,
		OwnerID:    &owner.ID,
		Active:     true,
		MXVerified: true,
	}
	if err := db.Create(&publicDomain).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&privateDomain).Error; err != nil {
		t.Fatal(err)
	}
	router := testRouter(t, db)
	login := perform(router, http.MethodPost, "/api/auth/login", map[string]any{
		"email":    "owner@example.com",
		"password": "password123",
	}, nil)
	if login.Code != http.StatusOK {
		t.Fatalf("login = %d: %s", login.Code, login.Body.String())
	}
	cookies := make([]string, 0, len(login.Result().Cookies()))
	for _, cookie := range login.Result().Cookies() {
		cookies = append(cookies, cookie.Name+"="+cookie.Value)
	}
	headers := map[string]string{"Cookie": strings.Join(cookies, "; ")}

	firstPublic := perform(router, http.MethodPost, "/api/generate-email", map[string]any{
		"prefix": "one",
		"domain": "user-public-quota.test",
	}, headers)
	if firstPublic.Code != http.StatusCreated {
		t.Fatalf("first public generate = %d: %s", firstPublic.Code, firstPublic.Body.String())
	}
	secondPublic := perform(router, http.MethodPost, "/api/generate-email", map[string]any{
		"prefix": "two",
		"domain": "user-public-quota.test",
	}, headers)
	if secondPublic.Code != http.StatusTooManyRequests {
		t.Fatalf("second public generate = %d: %s", secondPublic.Code, secondPublic.Body.String())
	}
	private := perform(router, http.MethodPost, "/api/generate-email", map[string]any{
		"prefix": "mine",
		"domain": "user-private-quota.test",
	}, headers)
	if private.Code != http.StatusCreated {
		t.Fatalf("private generate after user public quota = %d: %s", private.Code, private.Body.String())
	}
}

func TestAdminBypassesPublicMailboxDailyQuota(t *testing.T) {
	db := httpTestDB(t)
	hash, err := auth.HashSecret("password123")
	if err != nil {
		t.Fatal(err)
	}
	admin := models.User{
		Email:        "admin@example.com",
		PasswordHash: hash,
		Role:         models.UserRoleAdmin,
		Enabled:      true,
		DailyLimit:   1000,
	}
	if err := db.Create(&admin).Error; err != nil {
		t.Fatal(err)
	}
	settings := models.SystemQuotaSettings{
		ID:                          1,
		UserDailyPublicMailboxLimit: 1,
	}
	if err := db.Create(&settings).Error; err != nil {
		t.Fatal(err)
	}
	publicDomain := models.Domain{
		Domain:     "admin-public-quota.test",
		Mode:       models.DomainModePublic,
		Active:     true,
		MXVerified: true,
	}
	if err := db.Create(&publicDomain).Error; err != nil {
		t.Fatal(err)
	}
	router := testRouter(t, db)
	_, plain, err := (auth.APIKeyService{DB: db}).CreateFor(&admin.ID, "admin-key", 20, 0, nil)
	if err != nil {
		t.Fatal(err)
	}
	headers := map[string]string{"X-API-Key": plain}

	for _, prefix := range []string{"one", "two"} {
		resp := perform(router, http.MethodPost, "/api/generate-email", map[string]any{
			"prefix": prefix,
			"domain": "admin-public-quota.test",
		}, headers)
		if resp.Code != http.StatusCreated {
			t.Fatalf("admin public generate %q = %d: %s", prefix, resp.Code, resp.Body.String())
		}
	}
	var refreshed models.User
	if err := db.First(&refreshed, admin.ID).Error; err != nil {
		t.Fatal(err)
	}
	if refreshed.PublicMailboxCreated != 2 || refreshed.PublicMailboxToday != 2 {
		t.Fatalf("admin public counters = %d/%d, want 2/2", refreshed.PublicMailboxCreated, refreshed.PublicMailboxToday)
	}
}

func TestPublicDomainMailboxLimitFiltersAndEnforces(t *testing.T) {
	db := httpTestDB(t)
	hash, err := auth.HashSecret("password123")
	if err != nil {
		t.Fatal(err)
	}
	users := []models.User{
		{Email: "one@example.com", PasswordHash: hash, Role: models.UserRoleUser, Enabled: true, DailyLimit: 1000},
		{Email: "two@example.com", PasswordHash: hash, Role: models.UserRoleUser, Enabled: true, DailyLimit: 1000},
	}
	if err := db.Create(&users).Error; err != nil {
		t.Fatal(err)
	}
	settings := models.SystemQuotaSettings{
		ID:                       1,
		PublicDomainMailboxLimit: 1,
	}
	if err := db.Create(&settings).Error; err != nil {
		t.Fatal(err)
	}
	publicDomain := models.Domain{
		Domain:     "capped.test",
		Mode:       models.DomainModePublic,
		Active:     true,
		MXVerified: true,
	}
	if err := db.Create(&publicDomain).Error; err != nil {
		t.Fatal(err)
	}
	router := testRouter(t, db)
	service := auth.APIKeyService{DB: db}
	_, firstPlain, err := service.CreateFor(&users[0].ID, "first-key", 20, 0, nil)
	if err != nil {
		t.Fatal(err)
	}
	_, secondPlain, err := service.CreateFor(&users[1].ID, "second-key", 20, 0, nil)
	if err != nil {
		t.Fatal(err)
	}
	firstHeaders := map[string]string{"X-API-Key": firstPlain}
	secondHeaders := map[string]string{"X-API-Key": secondPlain}

	created := perform(router, http.MethodPost, "/api/generate-email", map[string]any{
		"prefix": "one",
		"domain": "capped.test",
	}, firstHeaders)
	if created.Code != http.StatusCreated {
		t.Fatalf("first public generate = %d: %s", created.Code, created.Body.String())
	}
	available := perform(router, http.MethodGet, "/api/domains/available", nil, secondHeaders)
	if available.Code != http.StatusOK {
		t.Fatalf("available domains = %d: %s", available.Code, available.Body.String())
	}
	if names := decodeAPIKeyAvailableDomainNames(t, available.Body.Bytes()); names["capped.test"] {
		t.Fatalf("capped domain remained public for non-owner: %v", names)
	}
	blocked := perform(router, http.MethodPost, "/api/generate-email", map[string]any{
		"prefix": "two",
		"domain": "capped.test",
	}, secondHeaders)
	if blocked.Code != http.StatusForbidden {
		t.Fatalf("second public generate = %d: %s", blocked.Code, blocked.Body.String())
	}
}

func TestInboxPaginationAndMailboxSearch(t *testing.T) {
	db := httpTestDB(t)
	hash, err := auth.HashSecret("password123")
	if err != nil {
		t.Fatal(err)
	}
	owner := models.User{
		Email:        "owner@example.com",
		PasswordHash: hash,
		Role:         models.UserRoleUser,
		Enabled:      true,
		DailyLimit:   1000,
	}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	domain := models.Domain{
		Domain:          "page.test",
		Mode:            models.DomainModePublic,
		Active:          true,
		MXVerified:      true,
		WildcardEnabled: true,
	}
	if err := db.Create(&domain).Error; err != nil {
		t.Fatal(err)
	}
	mailboxes := []models.Mailbox{
		{OwnerID: owner.ID, Email: "alpha@page.test", LocalPart: "alpha", Host: "page.test", DomainID: domain.ID},
		{OwnerID: owner.ID, Email: "beta@page.test", LocalPart: "beta", Host: "page.test", DomainID: domain.ID},
		{OwnerID: owner.ID, Email: "gamma@page.test", LocalPart: "gamma", Host: "page.test", DomainID: domain.ID},
	}
	if err := db.Create(&mailboxes).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	for i := 0; i < 3; i++ {
		message := models.Message{
			ID:              "message-page-" + strconv.Itoa(i+1),
			Recipient:       "alpha@page.test",
			RecipientLocal:  "alpha",
			RecipientDomain: "page.test",
			RootDomain:      "page.test",
			DomainID:        &domain.ID,
			FromAddress:     "sender@example.com",
			Subject:         "subject " + strconv.Itoa(i+1),
			TextContent:     "body " + strconv.Itoa(i+1),
			CreatedAt:       now.Add(time.Duration(i) * time.Minute),
			ExpiresAt:       now.Add(time.Hour),
		}
		if err := db.Create(&message).Error; err != nil {
			t.Fatal(err)
		}
	}
	_, plain, err := (auth.APIKeyService{DB: db}).CreateFor(&owner.ID, "reader", 20, 0, nil)
	if err != nil {
		t.Fatal(err)
	}
	router := testRouter(t, db)
	headers := map[string]string{"X-API-Key": plain}

	mailboxResponse := perform(router, http.MethodGet, "/api/mailboxes?q=page.test&page=2&per_page=2", nil, headers)
	if mailboxResponse.Code != http.StatusOK {
		t.Fatalf("mailboxes response = %d: %s", mailboxResponse.Code, mailboxResponse.Body.String())
	}
	var mailboxBody struct {
		Success bool `json:"success"`
		Data    struct {
			Items []struct {
				Email        string `json:"email"`
				MessageCount int64  `json:"message_count"`
			} `json:"items"`
			Page       int   `json:"page"`
			PerPage    int   `json:"per_page"`
			Total      int64 `json:"total"`
			TotalPages int   `json:"total_pages"`
		} `json:"data"`
	}
	if err := json.Unmarshal(mailboxResponse.Body.Bytes(), &mailboxBody); err != nil {
		t.Fatal(err)
	}
	if mailboxBody.Data.Page != 2 || mailboxBody.Data.PerPage != 2 || mailboxBody.Data.Total != 3 || mailboxBody.Data.TotalPages != 2 || len(mailboxBody.Data.Items) != 1 {
		t.Fatalf("unexpected mailbox pagination: %+v", mailboxBody.Data)
	}

	pagedEmailResponse := perform(router, http.MethodGet, "/api/emails?email=alpha@page.test&page=2&per_page=2", nil, headers)
	if pagedEmailResponse.Code != http.StatusOK {
		t.Fatalf("paged email response = %d: %s", pagedEmailResponse.Code, pagedEmailResponse.Body.String())
	}
	var pagedEmailBody struct {
		Success bool                              `json:"success"`
		Data    paginatedResponse[messageSummary] `json:"data"`
	}
	if err := json.Unmarshal(pagedEmailResponse.Body.Bytes(), &pagedEmailBody); err != nil {
		t.Fatal(err)
	}
	if pagedEmailBody.Data.Page != 2 || pagedEmailBody.Data.PerPage != 2 || pagedEmailBody.Data.Total != 3 || pagedEmailBody.Data.TotalPages != 2 || len(pagedEmailBody.Data.Items) != 1 {
		t.Fatalf("unexpected email pagination: %+v", pagedEmailBody.Data)
	}
	if pagedEmailBody.Data.Items[0].ID != "message-page-1" {
		t.Fatalf("second email page ID = %q", pagedEmailBody.Data.Items[0].ID)
	}

	legacyEmailResponse := perform(router, http.MethodGet, "/api/emails?email=alpha@page.test&limit=2", nil, headers)
	if legacyEmailResponse.Code != http.StatusOK {
		t.Fatalf("legacy email response = %d: %s", legacyEmailResponse.Code, legacyEmailResponse.Body.String())
	}
	var legacyEmailBody struct {
		Success bool             `json:"success"`
		Data    []messageSummary `json:"data"`
	}
	if err := json.Unmarshal(legacyEmailResponse.Body.Bytes(), &legacyEmailBody); err != nil {
		t.Fatal(err)
	}
	if len(legacyEmailBody.Data) != 2 {
		t.Fatalf("legacy email list length = %d", len(legacyEmailBody.Data))
	}
}

func TestAvailableDomainsRequiresActorAndSeparatesModes(t *testing.T) {
	db := httpTestDB(t)
	hash, err := auth.HashSecret("password123")
	if err != nil {
		t.Fatal(err)
	}
	owner := models.User{
		Email:        "owner@example.com",
		PasswordHash: hash,
		Role:         models.UserRoleUser,
		Enabled:      true,
		DailyLimit:   1000,
	}
	other := models.User{
		Email:        "other@example.com",
		PasswordHash: hash,
		Role:         models.UserRoleUser,
		Enabled:      true,
		DailyLimit:   1000,
	}
	admin := models.User{
		Email:        "admin@example.com",
		PasswordHash: hash,
		Role:         models.UserRoleAdmin,
		Enabled:      true,
	}
	if err := db.Create(&admin).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&other).Error; err != nil {
		t.Fatal(err)
	}
	domains := []models.Domain{
		{Domain: "public-ready.test", Mode: models.DomainModePublic, OwnerID: &other.ID, Active: true, MXVerified: true},
		{Domain: "public-pending.test", Mode: models.DomainModePublic, OwnerID: &other.ID, Active: true},
		{Domain: "public-wildcard-pending.test", Mode: models.DomainModePublic, OwnerID: &other.ID, Active: true, MXVerified: true, WildcardRequested: true},
		{Domain: "owner-ready.test", Mode: models.DomainModePrivate, OwnerID: &owner.ID, Active: true, MXVerified: true},
		{Domain: "owner-pending.test", Mode: models.DomainModePrivate, OwnerID: &owner.ID, Active: true},
		{Domain: "owner-inactive.test", Mode: models.DomainModePrivate, OwnerID: &owner.ID, Active: false, MXVerified: true},
		{Domain: "other-ready.test", Mode: models.DomainModePrivate, OwnerID: &other.ID, Active: true, MXVerified: true},
	}
	if err := db.Create(&domains).Error; err != nil {
		t.Fatal(err)
	}
	router := testRouter(t, db)
	_, ownerPlain, err := (auth.APIKeyService{DB: db}).CreateFor(&owner.ID, "owner-key", 20, 0, nil)
	if err != nil {
		t.Fatal(err)
	}

	anonymous := perform(router, http.MethodGet, "/api/domains/available", nil, nil)
	if anonymous.Code != http.StatusUnauthorized {
		t.Fatalf("expected anonymous available domains to be 401, got %d: %s", anonymous.Code, anonymous.Body.String())
	}
	legacy := perform(router, http.MethodGet, "/api/domains/public", nil, nil)
	if legacy.Code != http.StatusNotFound {
		t.Fatalf("expected legacy public domains route to be removed, got %d: %s", legacy.Code, legacy.Body.String())
	}
	anonymousPublicDomain := perform(router, http.MethodGet, "/api/domains/"+strconv.Itoa(int(domains[0].ID)), nil, nil)
	if anonymousPublicDomain.Code != http.StatusUnauthorized {
		t.Fatalf("expected anonymous public domain detail to be 401, got %d: %s", anonymousPublicDomain.Code, anonymousPublicDomain.Body.String())
	}

	headers := map[string]string{"X-API-Key": ownerPlain}
	response := perform(router, http.MethodGet, "/api/domains/available", nil, headers)
	if response.Code != http.StatusOK {
		t.Fatalf("available domains with api key = %d: %s", response.Code, response.Body.String())
	}
	publicNames := decodeAPIKeyAvailableDomainNames(t, response.Body.Bytes())
	if !publicNames["public-ready.test"] || publicNames["public-pending.test"] || publicNames["public-wildcard-pending.test"] {
		t.Fatalf("api key domain list was not filtered to ready public domains: %v", publicNames)
	}
	if strings.Contains(response.Body.String(), "public_domains") || strings.Contains(response.Body.String(), "private_domains") || strings.Contains(response.Body.String(), "owner-ready.test") {
		t.Fatalf("api key response should only expose public domain names: %s", response.Body.String())
	}
	publicDetail := perform(router, http.MethodGet, "/api/domains/"+strconv.Itoa(int(domains[0].ID)), nil, headers)
	if publicDetail.Code != http.StatusOK {
		t.Fatalf("public domain detail with api key = %d: %s", publicDetail.Code, publicDetail.Body.String())
	}

	login := perform(router, http.MethodPost, "/api/auth/login", map[string]any{
		"email":    "owner@example.com",
		"password": "password123",
	}, nil)
	cookieRequest := httptest.NewRequest(http.MethodGet, "/api/domains/available", nil)
	for _, cookie := range login.Result().Cookies() {
		cookieRequest.AddCookie(cookie)
	}
	cookieResponse := httptest.NewRecorder()
	router.ServeHTTP(cookieResponse, cookieRequest)
	if cookieResponse.Code != http.StatusOK {
		t.Fatalf("available domains with cookie = %d: %s", cookieResponse.Code, cookieResponse.Body.String())
	}
	_, cookiePrivateNames := decodeAvailableDomainNames(t, cookieResponse.Body.Bytes())
	if !cookiePrivateNames["owner-ready.test"] || cookiePrivateNames["other-ready.test"] {
		t.Fatalf("cookie domain visibility mismatch: %v", cookiePrivateNames)
	}
}

func TestMarkEmailReadSetsSeen(t *testing.T) {
	db := httpTestDB(t)
	hash, err := auth.HashSecret("password123")
	if err != nil {
		t.Fatal(err)
	}
	admin := models.User{
		Email:        "admin@example.com",
		PasswordHash: hash,
		Role:         models.UserRoleAdmin,
		Enabled:      true,
	}
	if err := db.Create(&admin).Error; err != nil {
		t.Fatal(err)
	}
	owner := models.User{
		Email:        "owner@example.com",
		PasswordHash: hash,
		Role:         models.UserRoleUser,
		Enabled:      true,
		DailyLimit:   1000,
	}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	domain := models.Domain{
		Domain:     "read.test",
		Mode:       models.DomainModePrivate,
		OwnerID:    &owner.ID,
		Active:     true,
		MXVerified: true,
	}
	if err := db.Create(&domain).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&models.Mailbox{
		OwnerID:   owner.ID,
		Email:     "demo@read.test",
		LocalPart: "demo",
		Host:      "read.test",
		DomainID:  domain.ID,
	}).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	message := models.Message{
		ID:              "message-read",
		Recipient:       "demo@read.test",
		RecipientLocal:  "demo",
		RecipientDomain: "read.test",
		RootDomain:      "read.test",
		DomainID:        &domain.ID,
		FromAddress:     "sender@example.com",
		Subject:         "code",
		TextContent:     "123456",
		HTMLContent:     "<p>123456</p>",
		HeadersJSON:     `{"x-test":"yes"}`,
		CreatedAt:       now,
		ExpiresAt:       now.Add(time.Hour),
	}
	if err := db.Create(&message).Error; err != nil {
		t.Fatal(err)
	}
	_, plain, err := (auth.APIKeyService{DB: db}).CreateFor(&owner.ID, "reader", 20, 0, nil)
	if err != nil {
		t.Fatal(err)
	}
	router := testRouter(t, db)
	headers := map[string]string{"X-API-Key": plain}

	inbox := perform(router, http.MethodGet, "/api/emails?email=demo@read.test", nil, headers)
	if inbox.Code != http.StatusOK {
		t.Fatalf("inbox = %d: %s", inbox.Code, inbox.Body.String())
	}
	var inboxBody struct {
		Data []struct {
			ID   string `json:"id"`
			Seen bool   `json:"seen"`
		} `json:"data"`
	}
	if err := json.Unmarshal(inbox.Body.Bytes(), &inboxBody); err != nil {
		t.Fatal(err)
	}
	if len(inboxBody.Data) != 1 || inboxBody.Data[0].Seen {
		t.Fatalf("expected unread message in inbox, got %s", inbox.Body.String())
	}

	marked := perform(router, http.MethodPatch, "/api/email/message-read/read", nil, headers)
	if marked.Code != http.StatusOK {
		t.Fatalf("mark read = %d: %s", marked.Code, marked.Body.String())
	}
	var markedBody struct {
		Data struct {
			ID   string `json:"id"`
			Seen bool   `json:"seen"`
		} `json:"data"`
	}
	if err := json.Unmarshal(marked.Body.Bytes(), &markedBody); err != nil {
		t.Fatal(err)
	}
	if markedBody.Data.ID != "message-read" || !markedBody.Data.Seen {
		t.Fatalf("unexpected mark read payload: %s", marked.Body.String())
	}

	detail := perform(router, http.MethodGet, "/api/email/message-read", nil, headers)
	if detail.Code != http.StatusOK {
		t.Fatalf("detail = %d: %s", detail.Code, detail.Body.String())
	}
	var detailBody struct {
		Data struct {
			Seen bool `json:"seen"`
		} `json:"data"`
	}
	if err := json.Unmarshal(detail.Body.Bytes(), &detailBody); err != nil {
		t.Fatal(err)
	}
	if !detailBody.Data.Seen {
		t.Fatalf("detail did not return seen=true: %s", detail.Body.String())
	}
	if strings.Contains(detail.Body.String(), "html_content") {
		t.Fatalf("api key detail response should not include html_content: %s", detail.Body.String())
	}
	if !strings.Contains(detail.Body.String(), "headers_json") {
		t.Fatalf("api key detail response should keep metadata headers: %s", detail.Body.String())
	}

	login := perform(router, http.MethodPost, "/api/auth/login", map[string]any{
		"email":    "owner@example.com",
		"password": "password123",
	}, nil)
	sessionDetailRequest := httptest.NewRequest(http.MethodGet, "/api/email/message-read", nil)
	for _, cookie := range login.Result().Cookies() {
		sessionDetailRequest.AddCookie(cookie)
	}
	sessionDetail := httptest.NewRecorder()
	router.ServeHTTP(sessionDetail, sessionDetailRequest)
	if sessionDetail.Code != http.StatusOK {
		t.Fatalf("session detail = %d: %s", sessionDetail.Code, sessionDetail.Body.String())
	}
	if !strings.Contains(sessionDetail.Body.String(), "html_content") {
		t.Fatalf("session detail response should include html_content: %s", sessionDetail.Body.String())
	}
}

func TestInboxStreamRequiresSessionCookie(t *testing.T) {
	db := httpTestDB(t)
	hash, err := auth.HashSecret("password123")
	if err != nil {
		t.Fatal(err)
	}
	admin := models.User{
		Email:        "admin@example.com",
		PasswordHash: hash,
		Role:         models.UserRoleAdmin,
		Enabled:      true,
	}
	owner := models.User{
		Email:        "owner@example.com",
		PasswordHash: hash,
		Role:         models.UserRoleUser,
		Enabled:      true,
		DailyLimit:   1000,
	}
	if err := db.Create(&admin).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	domain := models.Domain{
		Domain:          "stream.test",
		Mode:            models.DomainModePrivate,
		OwnerID:         &owner.ID,
		Active:          true,
		MXVerified:      true,
		WildcardEnabled: true,
	}
	if err := db.Create(&domain).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&models.Mailbox{
		OwnerID:   owner.ID,
		Email:     "demo@stream.test",
		LocalPart: "demo",
		Host:      "stream.test",
		DomainID:  domain.ID,
	}).Error; err != nil {
		t.Fatal(err)
	}
	router := testRouter(t, db)
	_, plain, err := (auth.APIKeyService{DB: db}).CreateFor(&owner.ID, "stream-key", 20, 0, nil)
	if err != nil {
		t.Fatal(err)
	}

	apiKeyOnly := perform(router, http.MethodGet, "/api/inbox-stream?email=demo@stream.test", nil, map[string]string{"X-API-Key": plain})
	if apiKeyOnly.Code != http.StatusUnauthorized {
		t.Fatalf("expected API key-only stream request to be 401, got %d: %s", apiKeyOnly.Code, apiKeyOnly.Body.String())
	}

	login := perform(router, http.MethodPost, "/api/auth/login", map[string]any{
		"email":    "owner@example.com",
		"password": "password123",
	}, nil)
	if login.Code != http.StatusOK {
		t.Fatalf("login = %d: %s", login.Code, login.Body.String())
	}
	ctx, cancel := context.WithCancel(context.Background())
	request := httptest.NewRequest(http.MethodGet, "/api/inbox-stream?email=demo@stream.test", nil).WithContext(ctx)
	for _, cookie := range login.Result().Cookies() {
		request.AddCookie(cookie)
	}
	response := httptest.NewRecorder()
	done := make(chan struct{})
	go func() {
		router.ServeHTTP(response, request)
		close(done)
	}()
	time.Sleep(20 * time.Millisecond)
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("stream handler did not stop after request cancellation")
	}
	if response.Code != http.StatusOK {
		t.Fatalf("cookie stream response = %d: %s", response.Code, response.Body.String())
	}
	if contentType := response.Header().Get("Content-Type"); !strings.Contains(contentType, "text/event-stream") {
		t.Fatalf("expected event-stream content type, got %q", contentType)
	}
	if !strings.Contains(response.Body.String(), ": connected") {
		t.Fatalf("stream did not flush initial connected frame: %s", response.Body.String())
	}
}

func TestNextEmailReturnsUnreadMessageAndMarksRead(t *testing.T) {
	db := httpTestDB(t)
	hash, err := auth.HashSecret("password123")
	if err != nil {
		t.Fatal(err)
	}
	owner := models.User{
		Email:        "owner@example.com",
		PasswordHash: hash,
		Role:         models.UserRoleUser,
		Enabled:      true,
		DailyLimit:   1000,
	}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	domain := models.Domain{
		Domain:     "next.test",
		Mode:       models.DomainModePrivate,
		OwnerID:    &owner.ID,
		Active:     true,
		MXVerified: true,
	}
	if err := db.Create(&domain).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&models.Mailbox{
		OwnerID:   owner.ID,
		Email:     "demo@next.test",
		LocalPart: "demo",
		Host:      "next.test",
		DomainID:  domain.ID,
	}).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	message := models.Message{
		ID:              "message-next",
		Recipient:       "demo@next.test",
		RecipientLocal:  "demo",
		RecipientDomain: "next.test",
		RootDomain:      "next.test",
		DomainID:        &domain.ID,
		FromAddress:     "sender@example.com",
		Subject:         "Your code",
		TextContent:     "Code 654321",
		HTMLContent:     "<p>Code <strong>654321</strong></p><script>alert(1)</script>",
		CreatedAt:       now,
		ExpiresAt:       now.Add(time.Hour),
	}
	if err := db.Create(&message).Error; err != nil {
		t.Fatal(err)
	}
	_, plain, err := (auth.APIKeyService{DB: db}).CreateFor(&owner.ID, "reader", 20, 0, nil)
	if err != nil {
		t.Fatal(err)
	}
	router := testRouter(t, db)
	headers := map[string]string{"X-API-Key": plain}

	first := perform(router, http.MethodGet, "/api/emails/next?email=demo@next.test", nil, headers)
	if first.Code != http.StatusOK {
		t.Fatalf("next email = %d: %s", first.Code, first.Body.String())
	}
	var firstBody struct {
		Data struct {
			HasEmail bool `json:"has_email"`
			Message  *struct {
				ID          string `json:"id"`
				Seen        bool   `json:"seen"`
				TextContent string `json:"text_content"`
				HTMLContent string `json:"html_content"`
			} `json:"message"`
		} `json:"data"`
	}
	if err := json.Unmarshal(first.Body.Bytes(), &firstBody); err != nil {
		t.Fatal(err)
	}
	if !firstBody.Data.HasEmail || firstBody.Data.Message == nil {
		t.Fatalf("expected a message: %s", first.Body.String())
	}
	if firstBody.Data.Message.ID != "message-next" || !firstBody.Data.Message.Seen || firstBody.Data.Message.TextContent != "Code 654321" {
		t.Fatalf("unexpected message payload: %s", first.Body.String())
	}
	if strings.Contains(firstBody.Data.Message.HTMLContent, "<script>") {
		t.Fatalf("html content was not sanitized: %s", firstBody.Data.Message.HTMLContent)
	}
	var stored models.Message
	if err := db.First(&stored, "id = ?", "message-next").Error; err != nil {
		t.Fatal(err)
	}
	if !stored.Seen {
		t.Fatalf("message was not marked read")
	}

	second := perform(router, http.MethodGet, "/api/emails/next?email=demo@next.test", nil, headers)
	if second.Code != http.StatusOK {
		t.Fatalf("second next email = %d: %s", second.Code, second.Body.String())
	}
	var secondBody struct {
		Data struct {
			HasEmail bool `json:"has_email"`
			Message  any  `json:"message"`
		} `json:"data"`
	}
	if err := json.Unmarshal(second.Body.Bytes(), &secondBody); err != nil {
		t.Fatal(err)
	}
	if secondBody.Data.HasEmail || secondBody.Data.Message != nil {
		t.Fatalf("expected no unread message after auto-read: %s", second.Body.String())
	}
}

func TestListDomainsHidesOtherUsersWaitingDomains(t *testing.T) {
	db := httpTestDB(t)
	hash, err := auth.HashSecret("password123")
	if err != nil {
		t.Fatal(err)
	}
	users := []models.User{
		{
			Email:        "owner@example.com",
			PasswordHash: hash,
			Role:         models.UserRoleUser,
			Enabled:      true,
		},
		{
			Email:        "other@example.com",
			PasswordHash: hash,
			Role:         models.UserRoleUser,
			Enabled:      true,
		},
		{
			Email:        "admin@example.com",
			PasswordHash: hash,
			Role:         models.UserRoleAdmin,
			Enabled:      true,
		},
	}
	if err := db.Create(&users).Error; err != nil {
		t.Fatal(err)
	}
	owner, other := users[0], users[1]
	domains := []models.Domain{
		{Domain: "other-pending.test", Mode: models.DomainModePublic, OwnerID: &other.ID, Active: true},
		{Domain: "other-wildcard-pending.test", Mode: models.DomainModePublic, OwnerID: &other.ID, Active: true, MXVerified: true, WildcardRequested: true},
		{Domain: "other-ready.test", Mode: models.DomainModePublic, OwnerID: &other.ID, Active: true, MXVerified: true},
		{Domain: "owner-pending.test", Mode: models.DomainModePublic, OwnerID: &owner.ID, Active: true},
	}
	if err := db.Create(&domains).Error; err != nil {
		t.Fatal(err)
	}
	router := testRouter(t, db)

	ownerLogin := perform(router, http.MethodPost, "/api/auth/login", map[string]any{
		"email":    "owner@example.com",
		"password": "password123",
	}, nil)
	ownerRequest := httptest.NewRequest(http.MethodGet, "/api/domains", nil)
	for _, cookie := range ownerLogin.Result().Cookies() {
		ownerRequest.AddCookie(cookie)
	}
	ownerResponse := httptest.NewRecorder()
	router.ServeHTTP(ownerResponse, ownerRequest)
	if ownerResponse.Code != http.StatusOK {
		t.Fatalf("owner domains = %d: %s", ownerResponse.Code, ownerResponse.Body.String())
	}
	ownerDomains := decodeDomainNames(t, ownerResponse.Body.Bytes())
	if ownerDomains["other-pending.test"] || ownerDomains["other-wildcard-pending.test"] {
		t.Fatalf("owner saw another user's waiting domains: %v", ownerDomains)
	}
	if !ownerDomains["other-ready.test"] || !ownerDomains["owner-pending.test"] {
		t.Fatalf("owner domain visibility missing expected domains: %v", ownerDomains)
	}
	for _, forbidden := range []string{"mx_auto_retry_", "health_failure_count", "health_recovery_count", "last_health_", "last_mx_records", "last_check_message"} {
		if strings.Contains(ownerResponse.Body.String(), forbidden) {
			t.Fatalf("owner domain list leaked internal field %q: %s", forbidden, ownerResponse.Body.String())
		}
	}

	adminLogin := perform(router, http.MethodPost, "/api/auth/login", map[string]any{
		"email":    "admin@example.com",
		"password": "password123",
	}, nil)
	adminRequest := httptest.NewRequest(http.MethodGet, "/api/domains", nil)
	for _, cookie := range adminLogin.Result().Cookies() {
		adminRequest.AddCookie(cookie)
	}
	adminResponse := httptest.NewRecorder()
	router.ServeHTTP(adminResponse, adminRequest)
	if adminResponse.Code != http.StatusOK {
		t.Fatalf("admin domains = %d: %s", adminResponse.Code, adminResponse.Body.String())
	}
	adminDomains := decodeDomainNames(t, adminResponse.Body.Bytes())
	for _, domainName := range []string{"other-pending.test", "other-wildcard-pending.test", "other-ready.test", "owner-pending.test"} {
		if !adminDomains[domainName] {
			t.Fatalf("admin did not see %s: %v", domainName, adminDomains)
		}
	}
}

func TestDeleteDomainAllowsOwnerWaitingAndAdminAll(t *testing.T) {
	db := httpTestDB(t)
	hash, err := auth.HashSecret("password123")
	if err != nil {
		t.Fatal(err)
	}
	users := []models.User{
		{
			Email:        "owner@example.com",
			PasswordHash: hash,
			Role:         models.UserRoleUser,
			Enabled:      true,
		},
		{
			Email:        "other@example.com",
			PasswordHash: hash,
			Role:         models.UserRoleUser,
			Enabled:      true,
		},
		{
			Email:        "admin@example.com",
			PasswordHash: hash,
			Role:         models.UserRoleAdmin,
			Enabled:      true,
		},
	}
	if err := db.Create(&users).Error; err != nil {
		t.Fatal(err)
	}
	owner, other := users[0], users[1]
	domains := []models.Domain{
		{Domain: "owner-pending.test", Mode: models.DomainModePrivate, OwnerID: &owner.ID, Active: true},
		{Domain: "owner-ready.test", Mode: models.DomainModePrivate, OwnerID: &owner.ID, Active: true, MXVerified: true},
		{Domain: "other-pending.test", Mode: models.DomainModePrivate, OwnerID: &other.ID, Active: true},
	}
	if err := db.Create(&domains).Error; err != nil {
		t.Fatal(err)
	}
	ownerPending, ownerReady, otherPending := domains[0], domains[1], domains[2]
	router := testRouter(t, db)
	ownerLogin := perform(router, http.MethodPost, "/api/auth/login", map[string]any{
		"email":    "owner@example.com",
		"password": "password123",
	}, nil)
	adminLogin := perform(router, http.MethodPost, "/api/auth/login", map[string]any{
		"email":    "admin@example.com",
		"password": "password123",
	}, nil)

	ownerDeleteReady := deleteDomainRequest(router, ownerLogin, ownerReady.ID)
	if ownerDeleteReady.Code != http.StatusForbidden {
		t.Fatalf("owner deleted ready domain, status=%d body=%s", ownerDeleteReady.Code, ownerDeleteReady.Body.String())
	}
	ownerDeleteOther := deleteDomainRequest(router, ownerLogin, otherPending.ID)
	if ownerDeleteOther.Code != http.StatusForbidden {
		t.Fatalf("owner deleted other pending domain, status=%d body=%s", ownerDeleteOther.Code, ownerDeleteOther.Body.String())
	}
	ownerDeletePending := deleteDomainRequest(router, ownerLogin, ownerPending.ID)
	if ownerDeletePending.Code != http.StatusOK {
		t.Fatalf("owner pending delete = %d: %s", ownerDeletePending.Code, ownerDeletePending.Body.String())
	}
	var ownerPendingCount int64
	db.Model(&models.Domain{}).Where("id = ?", ownerPending.ID).Count(&ownerPendingCount)
	if ownerPendingCount != 0 {
		t.Fatalf("owner pending domain was not deleted")
	}
	adminDeleteOther := deleteDomainRequest(router, adminLogin, otherPending.ID)
	if adminDeleteOther.Code != http.StatusOK {
		t.Fatalf("admin pending delete = %d: %s", adminDeleteOther.Code, adminDeleteOther.Body.String())
	}
	adminDeleteReady := deleteDomainRequest(router, adminLogin, ownerReady.ID)
	if adminDeleteReady.Code != http.StatusOK {
		t.Fatalf("admin ready delete = %d: %s", adminDeleteReady.Code, adminDeleteReady.Body.String())
	}
}

func TestDeleteUserHardDeletesOwnedResources(t *testing.T) {
	db := httpTestDB(t)
	hash, err := auth.HashSecret("password123")
	if err != nil {
		t.Fatal(err)
	}
	admin := models.User{
		Email:        "admin@example.com",
		PasswordHash: hash,
		Role:         models.UserRoleAdmin,
		Enabled:      true,
	}
	if err := db.Create(&admin).Error; err != nil {
		t.Fatal(err)
	}
	victim := models.User{
		Email:        "victim@example.com",
		PasswordHash: hash,
		Role:         models.UserRoleUser,
		Enabled:      true,
	}
	if err := db.Create(&victim).Error; err != nil {
		t.Fatal(err)
	}
	domain := models.Domain{
		Domain:     "victim.test",
		Mode:       models.DomainModePrivate,
		OwnerID:    &victim.ID,
		Active:     true,
		MXVerified: true,
	}
	if err := db.Create(&domain).Error; err != nil {
		t.Fatal(err)
	}
	if _, _, err := (auth.APIKeyService{DB: db}).CreateFor(&victim.ID, "victim", 10, 0, nil); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&models.Mailbox{OwnerID: victim.ID, Email: "demo@victim.test", LocalPart: "demo", Host: "victim.test", DomainID: domain.ID}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&models.Notification{UserID: &victim.ID, DomainID: &domain.ID, Type: "MX_FAILED", Message: "failed"}).Error; err != nil {
		t.Fatal(err)
	}

	router := testRouter(t, db)
	login := perform(router, http.MethodPost, "/api/auth/login", map[string]any{
		"email":    "admin@example.com",
		"password": "password123",
	}, nil)
	if login.Code != http.StatusOK {
		t.Fatalf("login = %d: %s", login.Code, login.Body.String())
	}
	request := httptest.NewRequest(http.MethodDelete, "/api/users/"+strconv.Itoa(int(victim.ID)), nil)
	for _, cookie := range login.Result().Cookies() {
		request.AddCookie(cookie)
	}
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("delete user = %d: %s", response.Code, response.Body.String())
	}
	var userCount, keyCount, mailboxCount, notificationCount, domainCount int64
	db.Model(&models.User{}).Where("id = ?", victim.ID).Count(&userCount)
	db.Model(&models.APIKey{}).Where("owner_id = ?", victim.ID).Count(&keyCount)
	db.Model(&models.Mailbox{}).Where("owner_id = ?", victim.ID).Count(&mailboxCount)
	db.Model(&models.Notification{}).Where("user_id = ?", victim.ID).Count(&notificationCount)
	db.Model(&models.Domain{}).Where("id = ?", domain.ID).Count(&domainCount)
	if userCount != 0 || keyCount != 0 || mailboxCount != 0 || notificationCount != 0 || domainCount != 0 {
		t.Fatalf("expected owned records to be deleted, got users=%d keys=%d mailboxes=%d notifications=%d domains=%d", userCount, keyCount, mailboxCount, notificationCount, domainCount)
	}
}

func TestInstallLoginAndAdminGate(t *testing.T) {
	db := httpTestDB(t)
	router := testRouter(t, db)
	status := perform(router, http.MethodGet, "/api/install/status", nil, nil)
	if status.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", status.Code, status.Body.String())
	}
	install := perform(router, http.MethodPost, "/api/install", map[string]any{
		"admin_email":     "admin@example.com",
		"admin_password":  "password123",
		"database_driver": "sqlite",
		"database_url":    ":memory:",
		"public_base_url": "http://localhost:3000",
		"mail_hostname":   "mail.example.com",
		"expected_mx":     "mail.example.com",
	}, nil)
	if install.Code != http.StatusOK {
		t.Fatalf("install = %d: %s", install.Code, install.Body.String())
	}
	login := perform(router, http.MethodPost, "/api/auth/login", map[string]any{
		"email":    "admin@example.com",
		"password": "password123",
	}, nil)
	if login.Code != http.StatusOK {
		t.Fatalf("login = %d: %s", login.Code, login.Body.String())
	}
	request := httptest.NewRequest(http.MethodGet, "/api/admin/stats", nil)
	for _, cookie := range login.Result().Cookies() {
		request.AddCookie(cookie)
	}
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("admin stats = %d: %s", response.Code, response.Body.String())
	}
	for _, path := range []string{"/api/admin/domain-health", "/api/admin/quota-alerts", "/api/admin/audit-logs"} {
		adminRequest := httptest.NewRequest(http.MethodGet, path, nil)
		for _, cookie := range login.Result().Cookies() {
			adminRequest.AddCookie(cookie)
		}
		adminResponse := httptest.NewRecorder()
		router.ServeHTTP(adminResponse, adminRequest)
		if adminResponse.Code != http.StatusOK {
			t.Fatalf("%s = %d: %s", path, adminResponse.Code, adminResponse.Body.String())
		}
	}
	selfDisable := httptest.NewRequest(http.MethodPatch, "/api/users/1", bytes.NewReader([]byte(`{"enabled":false}`)))
	selfDisable.Header.Set("Content-Type", "application/json")
	for _, cookie := range login.Result().Cookies() {
		selfDisable.AddCookie(cookie)
	}
	selfDisableResponse := httptest.NewRecorder()
	router.ServeHTTP(selfDisableResponse, selfDisable)
	if selfDisableResponse.Code != http.StatusBadRequest {
		t.Fatalf("self disable = %d: %s", selfDisableResponse.Code, selfDisableResponse.Body.String())
	}
	createUser := httptest.NewRequest(http.MethodPost, "/api/users", bytes.NewReader([]byte(`{"email":"user@example.com","password":"password123","role":"user","daily_limit":5}`)))
	createUser.Header.Set("Content-Type", "application/json")
	for _, cookie := range login.Result().Cookies() {
		createUser.AddCookie(cookie)
	}
	createUserResponse := httptest.NewRecorder()
	router.ServeHTTP(createUserResponse, createUser)
	if createUserResponse.Code != http.StatusCreated {
		t.Fatalf("create user = %d: %s", createUserResponse.Code, createUserResponse.Body.String())
	}
	register := perform(router, http.MethodPost, "/api/auth/register", map[string]any{
		"email":    "registered@example.com",
		"password": "password123",
	}, nil)
	if register.Code != http.StatusOK {
		t.Fatalf("register = %d: %s", register.Code, register.Body.String())
	}
	registeredMe := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	for _, cookie := range register.Result().Cookies() {
		registeredMe.AddCookie(cookie)
	}
	registeredMeResponse := httptest.NewRecorder()
	router.ServeHTTP(registeredMeResponse, registeredMe)
	if registeredMeResponse.Code != http.StatusOK {
		t.Fatalf("registered me = %d: %s", registeredMeResponse.Code, registeredMeResponse.Body.String())
	}
	userLogin := perform(router, http.MethodPost, "/api/auth/login", map[string]any{
		"email":    "user@example.com",
		"password": "password123",
	}, nil)
	userAdminRequest := httptest.NewRequest(http.MethodGet, "/api/admin/stats", nil)
	for _, cookie := range userLogin.Result().Cookies() {
		userAdminRequest.AddCookie(cookie)
	}
	userAdminResponse := httptest.NewRecorder()
	router.ServeHTTP(userAdminResponse, userAdminRequest)
	if userAdminResponse.Code != http.StatusForbidden {
		t.Fatalf("user admin stats = %d: %s", userAdminResponse.Code, userAdminResponse.Body.String())
	}
}

func TestInstallStatusRedactsInstalledAnonymousResponse(t *testing.T) {
	db := httpTestDB(t)
	hash, err := auth.HashSecret("password123")
	if err != nil {
		t.Fatal(err)
	}
	admin := models.User{
		Email:        "admin@example.com",
		PasswordHash: hash,
		Role:         models.UserRoleAdmin,
		Enabled:      true,
	}
	if err := db.Create(&admin).Error; err != nil {
		t.Fatal(err)
	}
	router := testRouterWithConfig(t, db, func(cfg *config.Config) {
		cfg.HTTPAddr = ":3000"
		cfg.SMTPAddr = ":2525"
		cfg.PublicBaseURL = "https://mail.example.com"
		cfg.MailHostname = "mail.example.com"
		cfg.ExpectedMX = "mail.example.com"
		cfg.DatabaseDriver = "postgres"
		cfg.DatabaseURL = "postgres://user:pass@127.0.0.1:5432/hloolmail?sslmode=disable"
		cfg.EnvPath = "/opt/hloolmail/.env"
	})

	status := perform(router, http.MethodGet, "/api/install/status", nil, nil)
	if status.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", status.Code, status.Body.String())
	}
	var anonymous struct {
		Success bool           `json:"success"`
		Data    map[string]any `json:"data"`
	}
	if err := json.Unmarshal(status.Body.Bytes(), &anonymous); err != nil {
		t.Fatal(err)
	}
	if !anonymous.Success || anonymous.Data["installed"] != true {
		t.Fatalf("unexpected anonymous status: %s", status.Body.String())
	}
	for _, forbidden := range []string{"config", "deployment", "site_api_calls_today", "registered_users", "hosted_domains"} {
		if _, exists := anonymous.Data[forbidden]; exists {
			t.Fatalf("anonymous install status leaked %q: %s", forbidden, status.Body.String())
		}
	}

	login := perform(router, http.MethodPost, "/api/auth/login", map[string]any{
		"email":    "admin@example.com",
		"password": "password123",
	}, nil)
	if login.Code != http.StatusOK {
		t.Fatalf("login = %d: %s", login.Code, login.Body.String())
	}
	request := httptest.NewRequest(http.MethodGet, "/api/install/status", nil)
	for _, cookie := range login.Result().Cookies() {
		request.AddCookie(cookie)
	}
	authenticated := httptest.NewRecorder()
	router.ServeHTTP(authenticated, request)
	if authenticated.Code != http.StatusOK {
		t.Fatalf("authenticated status = %d: %s", authenticated.Code, authenticated.Body.String())
	}
	var full struct {
		Data struct {
			Config struct {
				DatabaseURL string `json:"database_url"`
			} `json:"config"`
			Deployment map[string]any `json:"deployment"`
		} `json:"data"`
	}
	if err := json.Unmarshal(authenticated.Body.Bytes(), &full); err != nil {
		t.Fatal(err)
	}
	if full.Data.Config.DatabaseURL == "" || !strings.Contains(full.Data.Config.DatabaseURL, "***") {
		t.Fatalf("authenticated status should include masked config, got: %s", authenticated.Body.String())
	}
	if full.Data.Deployment == nil {
		t.Fatalf("authenticated status should include deployment details: %s", authenticated.Body.String())
	}
}

func TestInstallStatusReportsContainerConfigLock(t *testing.T) {
	t.Setenv("HLOOLMAIL_DEPLOYMENT", "docker")
	t.Setenv("HLOOLMAIL_CONFIG_LOCKED", "true")
	db := httpTestDB(t)
	router := testRouter(t, db)

	status := perform(router, http.MethodGet, "/api/install/status", nil, nil)
	if status.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", status.Code, status.Body.String())
	}
	var body struct {
		Success bool `json:"success"`
		Data    struct {
			Deployment struct {
				Kind             string `json:"kind"`
				Container        bool   `json:"container"`
				ConfigLocked     bool   `json:"config_locked"`
				ConfigLockReason string `json:"config_lock_reason"`
			} `json:"deployment"`
		} `json:"data"`
	}
	if err := json.Unmarshal(status.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if !body.Success || body.Data.Deployment.Kind != "docker" || !body.Data.Deployment.Container || !body.Data.Deployment.ConfigLocked {
		t.Fatalf("unexpected deployment status: %+v", body.Data.Deployment)
	}
	if body.Data.Deployment.ConfigLockReason != "container_environment" {
		t.Fatalf("config lock reason = %q", body.Data.Deployment.ConfigLockReason)
	}
}

func TestInstallPreservesRuntimeConfigWhenLocked(t *testing.T) {
	t.Setenv("HLOOLMAIL_CONFIG_LOCKED", "true")
	db := httpTestDB(t)
	envPath := filepath.Join(t.TempDir(), ".env")
	router := testRouterWithConfig(t, db, func(cfg *config.Config) {
		cfg.HTTPAddr = ":3000"
		cfg.SMTPAddr = ":2525"
		cfg.PublicBaseURL = "https://mail.example.com"
		cfg.MailHostname = "mail.example.com"
		cfg.ExpectedMX = "mail.example.com"
		cfg.DatabaseDriver = "postgres"
		cfg.DatabaseURL = "postgres://user:pass@postgres:5432/hloolmail?sslmode=disable"
		cfg.DevMode = false
		cfg.EnvPath = envPath
	})

	install := perform(router, http.MethodPost, "/api/install", map[string]any{
		"admin_email":     "admin@example.com",
		"admin_password":  "password123",
		"database_driver": "sqlite",
		"database_url":    "postgres://***:***@postgres:5432/hloolmail?sslmode=disable",
		"public_base_url": "https://changed.example.com",
		"mail_hostname":   "changed.example.com",
		"expected_mx":     "changed.example.com",
		"http_addr":       ":8080",
		"smtp_addr":       ":25",
		"dev_mode":        true,
	}, nil)
	if install.Code != http.StatusOK {
		t.Fatalf("install = %d: %s", install.Code, install.Body.String())
	}
	var body struct {
		Data struct {
			RestartRequired bool `json:"restart_required"`
		} `json:"data"`
	}
	if err := json.Unmarshal(install.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Data.RestartRequired {
		t.Fatal("locked container install should not request a database restart from submitted runtime fields")
	}
	content, err := os.ReadFile(envPath)
	if err != nil {
		t.Fatal(err)
	}
	env := string(content)
	for _, want := range []string{
		`PUBLIC_BASE_URL="https://mail.example.com"`,
		`MAIL_HOSTNAME="mail.example.com"`,
		`DATABASE_DRIVER="postgres"`,
		`DATABASE_URL="postgres://user:pass@postgres:5432/hloolmail?sslmode=disable"`,
		`DEV_MODE="false"`,
	} {
		if !strings.Contains(env, want) {
			t.Fatalf("written env missing %s:\n%s", want, env)
		}
	}
	if strings.Contains(env, "changed.example.com") {
		t.Fatalf("locked install wrote submitted runtime config:\n%s", env)
	}
}

func TestInstallBuildsPostgresURLFromParts(t *testing.T) {
	input := installInput{
		DatabaseDriver:   "postgres",
		DatabaseHost:     "db.example.com",
		DatabasePort:     "5432",
		DatabaseName:     "hloolmail",
		DatabaseUser:     "mailuser",
		DatabasePassword: "p@ss word",
		DatabaseSSLMode:  "require",
		AdminEmail:       "admin@example.com",
		AdminPassword:    "password123",
		PublicBaseURL:    "https://mail.example.com",
		MailHostname:     "mail.example.com",
		ExpectedMX:       "mail.example.com",
	}

	if err := input.applyDefaults(config.Config{}); err != nil {
		t.Fatal(err)
	}
	want := "postgres://mailuser:p%40ss%20word@db.example.com:5432/hloolmail?sslmode=require"
	if input.DatabaseURL != want {
		t.Fatalf("database url = %q, want %q", input.DatabaseURL, want)
	}
}

func TestFriendlyDatabaseSetupErrorExplainsPostgresSchemaPermission(t *testing.T) {
	message := friendlyDatabaseSetupError(
		"migrate",
		errors.New("ERROR: permission denied for schema public (SQLSTATE 42501)"),
		"postgres://hlooltest:secret@127.0.0.1:5432/hlooltest?sslmode=disable",
	)
	for _, want := range []string{
		"数据库迁移失败",
		"public schema",
		"建表/改表权限",
		"/www/server/pgsql/bin/psql -U postgres -d 'hlooltest'",
		`ALTER DATABASE "hlooltest" OWNER TO "hlooltest"`,
		"SQLSTATE 42501",
	} {
		if !strings.Contains(message, want) {
			t.Fatalf("message missing %q:\n%s", want, message)
		}
	}
}

func TestInstallReturnsManualEnvWhenEnvWriteFails(t *testing.T) {
	db := httpTestDB(t)
	envPathIsDirectory := t.TempDir()
	router := testRouterWithConfig(t, db, func(cfg *config.Config) {
		cfg.EnvPath = envPathIsDirectory
	})

	install := perform(router, http.MethodPost, "/api/install", map[string]any{
		"admin_email":     "admin@example.com",
		"admin_password":  "password123",
		"database_driver": "sqlite",
		"database_url":    ":memory:",
		"public_base_url": "http://localhost:3000",
		"mail_hostname":   "mail.example.com",
		"expected_mx":     "mail.example.com",
	}, nil)
	if install.Code != http.StatusOK {
		t.Fatalf("install = %d: %s", install.Code, install.Body.String())
	}
	var body struct {
		Data struct {
			EnvWritten bool   `json:"env_written"`
			EnvError   string `json:"env_error"`
			EnvPath    string `json:"env_path"`
			EnvContent string `json:"env_content"`
		} `json:"data"`
	}
	if err := json.Unmarshal(install.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Data.EnvWritten {
		t.Fatal("expected env_written=false when env path is a directory")
	}
	if body.Data.EnvError == "" {
		t.Fatal("expected env_error to explain the write failure")
	}
	if body.Data.EnvPath != envPathIsDirectory {
		t.Fatalf("env path = %q, want %q", body.Data.EnvPath, envPathIsDirectory)
	}
	if !strings.Contains(body.Data.EnvContent, `DATABASE_URL=":memory:"`) || !strings.Contains(body.Data.EnvContent, "SESSION_SECRET=") {
		t.Fatalf("env content missing expected values:\n%s", body.Data.EnvContent)
	}
	var adminCount int64
	db.Model(&models.User{}).Where("email = ?", "admin@example.com").Count(&adminCount)
	if adminCount != 1 {
		t.Fatal("install should still create the admin when env content must be copied manually")
	}
}

func TestLogoutRevokesSession(t *testing.T) {
	db := httpTestDB(t)
	hash, err := auth.HashSecret("password123")
	if err != nil {
		t.Fatal(err)
	}
	admin := models.User{
		Email:        "admin@example.com",
		PasswordHash: hash,
		Role:         models.UserRoleAdmin,
		Enabled:      true,
	}
	if err := db.Create(&admin).Error; err != nil {
		t.Fatal(err)
	}
	router := testRouter(t, db)

	login := perform(router, http.MethodPost, "/api/auth/login", map[string]any{
		"email":    "admin@example.com",
		"password": "password123",
	}, nil)
	if login.Code != http.StatusOK {
		t.Fatalf("login = %d: %s", login.Code, login.Body.String())
	}
	var sessionCookie *http.Cookie
	for _, cookie := range login.Result().Cookies() {
		if cookie.Name == sessionCookieName {
			copy := *cookie
			sessionCookie = &copy
		}
	}
	if sessionCookie == nil {
		t.Fatal("login did not set session cookie")
	}

	me := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	me.AddCookie(sessionCookie)
	meResponse := httptest.NewRecorder()
	router.ServeHTTP(meResponse, me)
	if meResponse.Code != http.StatusOK {
		t.Fatalf("me before logout = %d: %s", meResponse.Code, meResponse.Body.String())
	}

	logout := httptest.NewRequest(http.MethodPost, "/api/auth/logout", nil)
	logout.AddCookie(sessionCookie)
	logoutResponse := httptest.NewRecorder()
	router.ServeHTTP(logoutResponse, logout)
	if logoutResponse.Code != http.StatusOK {
		t.Fatalf("logout = %d: %s", logoutResponse.Code, logoutResponse.Body.String())
	}

	replay := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	replay.AddCookie(sessionCookie)
	replayResponse := httptest.NewRecorder()
	router.ServeHTTP(replayResponse, replay)
	if replayResponse.Code != http.StatusUnauthorized {
		t.Fatalf("replayed session after logout = %d: %s", replayResponse.Code, replayResponse.Body.String())
	}
}

func TestInstallRegeneratesInsecureSessionSecret(t *testing.T) {
	input := installInput{
		HTTPAddr:         ":3000",
		SMTPAddr:         ":2525",
		PublicBaseURL:    "http://localhost:3000",
		MailHostname:     "mail.example.com",
		ExpectedMX:       "mail.example.com",
		DatabaseDriver:   "sqlite",
		DatabaseURL:      ":memory:",
		FrontendDist:     t.TempDir(),
		AdminEmail:       "admin@example.com",
		AdminPassword:    "password123",
		InboxTokenSecret: config.InsecureDefaultSecret,
		SessionSecret:    "change-this-too",
	}

	if err := input.applyDefaults(config.Config{}); err != nil {
		t.Fatal(err)
	}
	if config.IsInsecureSecret(input.InboxTokenSecret) {
		t.Fatalf("inbox token secret was not regenerated: %q", input.InboxTokenSecret)
	}
	if config.IsInsecureSecret(input.SessionSecret) {
		t.Fatalf("session secret was not regenerated: %q", input.SessionSecret)
	}
	if input.InboxTokenSecret == input.SessionSecret {
		t.Fatal("inbox and session secrets should be generated independently")
	}
}

func testRouter(t *testing.T, db *gorm.DB) http.Handler {
	t.Helper()
	return testRouterWithConfig(t, db, nil)
}

func testRouterWithConfig(t *testing.T, db *gorm.DB, configure func(*config.Config)) http.Handler {
	t.Helper()
	cfg := config.Config{
		DevMode:               true,
		ExpectedMX:            "mail.example.com",
		InboxTokenSecret:      "test-secret",
		SessionSecret:         "test-session",
		APIKeyDefaultDailyCap: 200000,
		FrontendDist:          t.TempDir(),
		DatabaseDriver:        "sqlite",
		DatabaseURL:           ":memory:",
		EnvPath:               t.TempDir() + "/.env",
	}
	if configure != nil {
		configure(&cfg)
	}
	resolver := domain.Resolver{DB: db}
	handler := &Handler{
		Config:     cfg,
		DB:         db,
		Resolver:   resolver,
		DNSChecker: domain.DNSChecker{DB: db, Config: cfg},
		APIKeys:    auth.APIKeyService{DB: db},
		Sessions:   auth.NewSessionService(cfg.SessionSecret, db),
		Hub:        events.NewHub(),
	}
	return NewRouter(handler)
}

func httpTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	if err := db.AutoMigrate(&models.User{}, &models.OAuthIdentity{}, &models.OAuthProviderSetting{}, &models.Domain{}, &models.Mailbox{}, &models.Message{}, &models.APIKey{}, &models.SessionToken{}, &models.APIUsageLog{}, &models.Notification{}, &models.AuditLog{}, &models.SystemQuotaSettings{}); err != nil {
		t.Fatal(err)
	}
	return db
}

func perform(handler http.Handler, method, path string, body map[string]any, headers map[string]string) *httptest.ResponseRecorder {
	var payload *bytes.Reader
	if body != nil {
		data, _ := json.Marshal(body)
		payload = bytes.NewReader(data)
	} else {
		payload = bytes.NewReader(nil)
	}
	request := httptest.NewRequest(method, path, payload)
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	for key, value := range headers {
		request.Header.Set(key, value)
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func deleteDomainRequest(handler http.Handler, login *httptest.ResponseRecorder, id uint) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodDelete, "/api/domains/"+strconv.Itoa(int(id)), nil)
	for _, cookie := range login.Result().Cookies() {
		request.AddCookie(cookie)
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func decodeDomainNames(t *testing.T, body []byte) map[string]bool {
	t.Helper()
	var payload struct {
		Data []struct {
			Domain string `json:"domain"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatal(err)
	}
	names := make(map[string]bool, len(payload.Data))
	for _, d := range payload.Data {
		names[d.Domain] = true
	}
	return names
}

func decodeAPIKeyAvailableDomainNames(t *testing.T, body []byte) map[string]bool {
	t.Helper()
	var payload struct {
		Data struct {
			Domains []string `json:"domains"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatal(err)
	}
	names := make(map[string]bool, len(payload.Data.Domains))
	for _, domain := range payload.Data.Domains {
		names[domain] = true
	}
	return names
}

func decodeAvailableDomainNames(t *testing.T, body []byte) (map[string]bool, map[string]bool) {
	t.Helper()
	var payload struct {
		Data struct {
			PublicDomains []struct {
				Domain string `json:"domain"`
			} `json:"public_domains"`
			PrivateDomains []struct {
				Domain string `json:"domain"`
			} `json:"private_domains"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatal(err)
	}
	publicNames := make(map[string]bool, len(payload.Data.PublicDomains))
	for _, d := range payload.Data.PublicDomains {
		publicNames[d.Domain] = true
	}
	privateNames := make(map[string]bool, len(payload.Data.PrivateDomains))
	for _, d := range payload.Data.PrivateDomains {
		privateNames[d.Domain] = true
	}
	return publicNames, privateNames
}
