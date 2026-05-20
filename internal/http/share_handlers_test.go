package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"gptmail/internal/auth"
	"gptmail/internal/models"

	"gorm.io/gorm"
)

func TestShareLinkPublicReadSkipsAPIKeyAndDoesNotRevealSecrets(t *testing.T) {
	db := httpTestDB(t)
	owner := createShareTestUser(t, db, "owner@example.test")
	domain := createShareTestDomain(t, db, "owned.test", models.DomainModePrivate, &owner.ID)
	mailbox := createShareTestMailbox(t, db, owner, domain, "demo@owned.test")
	message := createShareTestMessage(t, db, "share-message-1", mailbox.Email, domain, false)
	if err := db.Create(&models.MessageAttachment{
		ID:          "00000000-0000-0000-0000-000000000401",
		MessageID:   message.ID,
		Sequence:    1,
		Filename:    "invoice.pdf",
		ContentType: "application/pdf",
		SizeBytes:   42,
		SHA256:      strings.Repeat("a", 64),
	}).Error; err != nil {
		t.Fatal(err)
	}
	router := testRouter(t, db)
	login := loginShareTestUser(t, router, owner.Email)

	create := perform(router, http.MethodPost, "/api/share-links", map[string]any{
		"message_id": message.ID,
	}, cookieHeaders(login.Result().Cookies()))
	if create.Code != http.StatusCreated {
		t.Fatalf("create share = %d: %s", create.Code, create.Body.String())
	}
	created := decodeShareEnvelope[ShareLinkDTO](t, create.Body.Bytes()).Data
	if created.Token == "" {
		t.Fatal("create response did not include one-time token")
	}
	if created.ShareURL == "" {
		t.Fatal("create response did not include share_url")
	}

	var stored models.ShareLink
	if err := db.First(&stored, created.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.TokenHash == "" || stored.TokenHash == created.Token {
		t.Fatalf("token hash was not stored safely: hash=%q token=%q", stored.TokenHash, created.Token)
	}

	list := perform(router, http.MethodGet, "/api/share-links", nil, cookieHeaders(login.Result().Cookies()))
	if list.Code != http.StatusOK {
		t.Fatalf("list share links = %d: %s", list.Code, list.Body.String())
	}
	if strings.Contains(list.Body.String(), created.Token) {
		t.Fatalf("list response leaked one-time token: %s", list.Body.String())
	}
	get := perform(router, http.MethodGet, "/api/share-links/"+uintPath(created.ID), nil, cookieHeaders(login.Result().Cookies()))
	if get.Code != http.StatusOK {
		t.Fatalf("get share link = %d: %s", get.Code, get.Body.String())
	}
	if strings.Contains(get.Body.String(), created.Token) {
		t.Fatalf("get response leaked one-time token: %s", get.Body.String())
	}

	apiKey, plainAPIKey, err := (auth.APIKeyService{DB: db}).CreateFor(&owner.ID, "shared-read", 1, 0, nil)
	if err != nil {
		t.Fatal(err)
	}
	apiKeyOnlyList := perform(router, http.MethodGet, "/api/share-links", nil, map[string]string{
		"X-API-Key": plainAPIKey,
	})
	if apiKeyOnlyList.Code != http.StatusUnauthorized {
		t.Fatalf("api key-only share link management = %d: %s", apiKeyOnlyList.Code, apiKeyOnlyList.Body.String())
	}
	sessionWithBadAPIKeyHeaders := cookieHeaders(login.Result().Cookies())
	sessionWithBadAPIKeyHeaders["X-API-Key"] = "definitely-wrong"
	sessionWithBadAPIKey := perform(router, http.MethodGet, "/api/share-links", nil, sessionWithBadAPIKeyHeaders)
	if sessionWithBadAPIKey.Code != http.StatusOK {
		t.Fatalf("session share link management should ignore api key header, got %d: %s", sessionWithBadAPIKey.Code, sessionWithBadAPIKey.Body.String())
	}
	public := perform(router, http.MethodGet, "/api/shared/"+created.Token, nil, map[string]string{
		"X-API-Key": plainAPIKey,
	})
	if public.Code != http.StatusOK {
		t.Fatalf("public shared read = %d: %s", public.Code, public.Body.String())
	}
	body := public.Body.String()
	for _, forbidden := range []string{"headers_json", "\"seen\"", "<script"} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("public shared response leaked %q: %s", forbidden, body)
		}
	}
	for _, want := range []string{"hello", "invoice.pdf", "Safe"} {
		if !strings.Contains(body, want) {
			t.Fatalf("public shared response missing %q: %s", want, body)
		}
	}

	var refreshedMessage models.Message
	if err := db.First(&refreshedMessage, "id = ?", message.ID).Error; err != nil {
		t.Fatal(err)
	}
	if refreshedMessage.Seen {
		t.Fatal("public share read changed message seen state")
	}
	if err := db.First(apiKey, apiKey.ID).Error; err != nil {
		t.Fatal(err)
	}
	if apiKey.UsedToday != 0 || apiKey.TotalUsed != 0 || apiKey.LastUsedAt != nil {
		t.Fatalf("public shared path consumed api key usage: %+v", apiKey)
	}
	var usageLogs int64
	if err := db.Model(&models.APIUsageLog{}).Count(&usageLogs).Error; err != nil {
		t.Fatal(err)
	}
	if usageLogs != 0 {
		t.Fatalf("api usage logs = %d, want 0", usageLogs)
	}
	var accessLogs int64
	if err := db.Model(&models.ShareLinkAccessLog{}).Where("share_link_id = ?", created.ID).Count(&accessLogs).Error; err != nil {
		t.Fatal(err)
	}
	if accessLogs != 1 {
		t.Fatalf("share access logs = %d, want 1", accessLogs)
	}
	if err := db.First(&stored, created.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.AccessCount != 1 || stored.LastAccessedAt == nil {
		t.Fatalf("share access accounting mismatch: %+v", stored)
	}

	badHeaderRead := perform(router, http.MethodGet, "/api/shared/"+created.Token, nil, map[string]string{
		"X-API-Key": "definitely-wrong",
	})
	if badHeaderRead.Code != http.StatusOK {
		t.Fatalf("public shared read with bad api key = %d: %s", badHeaderRead.Code, badHeaderRead.Body.String())
	}
}

func TestShareLinkCreationUsesMessageOwnerHelper(t *testing.T) {
	db := httpTestDB(t)
	publicDomainOwner := createShareTestUser(t, db, "public-domain-owner@example.test")
	mailboxOwner := createShareTestUser(t, db, "mailbox-owner@example.test")
	privateDomainOwner := createShareTestUser(t, db, "private-domain-owner@example.test")

	publicDomain := createShareTestDomain(t, db, "public-owned.test", models.DomainModePublic, &publicDomainOwner.ID)
	mailbox := createShareTestMailbox(t, db, mailboxOwner, publicDomain, "demo@public-owned.test")
	publicMessage := createShareTestMessage(t, db, "public-owned-message", mailbox.Email, publicDomain, false)

	privateDomain := createShareTestDomain(t, db, "private-owned.test", models.DomainModePrivate, &privateDomainOwner.ID)
	privateMessage := createShareTestMessage(t, db, "private-domain-message", "random@private-owned.test", privateDomain, false)

	router := testRouter(t, db)
	publicDomainOwnerLogin := loginShareTestUser(t, router, publicDomainOwner.Email)
	publicDomainOwnerCreate := perform(router, http.MethodPost, "/api/share-links", map[string]any{
		"message_id": publicMessage.ID,
	}, cookieHeaders(publicDomainOwnerLogin.Result().Cookies()))
	if publicDomainOwnerCreate.Code != http.StatusForbidden {
		t.Fatalf("public domain owner created mailbox-owned share: %d %s", publicDomainOwnerCreate.Code, publicDomainOwnerCreate.Body.String())
	}

	mailboxOwnerLogin := loginShareTestUser(t, router, mailboxOwner.Email)
	mailboxOwnerCreate := perform(router, http.MethodPost, "/api/share-links", map[string]any{
		"message_id": publicMessage.ID,
	}, cookieHeaders(mailboxOwnerLogin.Result().Cookies()))
	if mailboxOwnerCreate.Code != http.StatusCreated {
		t.Fatalf("mailbox owner create share = %d: %s", mailboxOwnerCreate.Code, mailboxOwnerCreate.Body.String())
	}

	privateDomainOwnerLogin := loginShareTestUser(t, router, privateDomainOwner.Email)
	privateDomainOwnerCreate := perform(router, http.MethodPost, "/api/share-links", map[string]any{
		"message_id": privateMessage.ID,
	}, cookieHeaders(privateDomainOwnerLogin.Result().Cookies()))
	if privateDomainOwnerCreate.Code != http.StatusCreated {
		t.Fatalf("private domain owner create share = %d: %s", privateDomainOwnerCreate.Code, privateDomainOwnerCreate.Body.String())
	}

	mailboxShare := perform(router, http.MethodPost, "/api/share-links", map[string]any{
		"resource_type": "mailbox",
		"message_id":    publicMessage.ID,
	}, cookieHeaders(mailboxOwnerLogin.Result().Cookies()))
	if mailboxShare.Code != http.StatusBadRequest {
		t.Fatalf("mailbox share resource type = %d: %s", mailboxShare.Code, mailboxShare.Body.String())
	}
}

func TestShareLinkPasswordRevokeRotateAndSourceDeletion(t *testing.T) {
	db := httpTestDB(t)
	owner := createShareTestUser(t, db, "owner@example.test")
	domain := createShareTestDomain(t, db, "secure.test", models.DomainModePrivate, &owner.ID)
	mailbox := createShareTestMailbox(t, db, owner, domain, "secret@secure.test")
	message := createShareTestMessage(t, db, "password-message", mailbox.Email, domain, false)
	router := testRouter(t, db)
	login := loginShareTestUser(t, router, owner.Email)

	expiresAt := time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
	create := perform(router, http.MethodPost, "/api/share-links", map[string]any{
		"message_id":  message.ID,
		"password":    "open-sesame",
		"expires_at":  expiresAt,
		"extra_field": "ignored",
	}, cookieHeaders(login.Result().Cookies()))
	if create.Code != http.StatusCreated {
		t.Fatalf("create password share = %d: %s", create.Code, create.Body.String())
	}
	created := decodeShareEnvelope[ShareLinkDTO](t, create.Body.Bytes()).Data
	if !created.PasswordSet {
		t.Fatal("created password share did not report password_set")
	}

	locked := perform(router, http.MethodGet, "/api/shared/"+created.Token, nil, nil)
	if locked.Code != http.StatusOK {
		t.Fatalf("locked shared GET = %d: %s", locked.Code, locked.Body.String())
	}
	lockedBody := locked.Body.String()
	if !strings.Contains(lockedBody, "password_required") || strings.Contains(lockedBody, "text_content") || strings.Contains(lockedBody, "html_content") {
		t.Fatalf("locked response exposed content or missed password state: %s", lockedBody)
	}

	queryPassword := perform(router, http.MethodGet, "/api/shared/"+created.Token+"?password=open-sesame", nil, nil)
	if queryPassword.Code != http.StatusBadRequest {
		t.Fatalf("query password response = %d: %s", queryPassword.Code, queryPassword.Body.String())
	}

	wrong := perform(router, http.MethodPost, "/api/shared/"+created.Token+"/access", map[string]any{
		"password": "wrong",
	}, nil)
	if wrong.Code != http.StatusUnauthorized {
		t.Fatalf("wrong password response = %d: %s", wrong.Code, wrong.Body.String())
	}
	var link models.ShareLink
	if err := db.First(&link, created.ID).Error; err != nil {
		t.Fatal(err)
	}
	if link.AccessCount != 0 {
		t.Fatalf("wrong password incremented access count: %d", link.AccessCount)
	}

	correct := perform(router, http.MethodPost, "/api/shared/"+created.Token+"/access", map[string]any{
		"password": "open-sesame",
	}, nil)
	if correct.Code != http.StatusOK {
		t.Fatalf("correct password response = %d: %s", correct.Code, correct.Body.String())
	}
	if err := db.First(&link, created.ID).Error; err != nil {
		t.Fatal(err)
	}
	if link.AccessCount != 1 {
		t.Fatalf("correct password access count = %d, want 1", link.AccessCount)
	}
	var logs []models.ShareLinkAccessLog
	if err := db.Order("created_at asc").Find(&logs, "share_link_id = ?", created.ID).Error; err != nil {
		t.Fatal(err)
	}
	if len(logs) != 2 || logs[0].Success || logs[0].FailureReason != "invalid_password" || !logs[1].Success {
		t.Fatalf("unexpected access logs: %+v", logs)
	}

	revoke := perform(router, http.MethodPost, "/api/share-links/"+uintPath(created.ID)+"/revoke", nil, cookieHeaders(login.Result().Cookies()))
	if revoke.Code != http.StatusOK {
		t.Fatalf("revoke share = %d: %s", revoke.Code, revoke.Body.String())
	}
	gone := perform(router, http.MethodGet, "/api/shared/"+created.Token, nil, nil)
	if gone.Code != http.StatusGone {
		t.Fatalf("revoked shared read = %d: %s", gone.Code, gone.Body.String())
	}

	rotateMessage := createShareTestMessage(t, db, "rotate-message", mailbox.Email, domain, false)
	rotateCreate := perform(router, http.MethodPost, "/api/share-links", map[string]any{
		"message_id": rotateMessage.ID,
	}, cookieHeaders(login.Result().Cookies()))
	if rotateCreate.Code != http.StatusCreated {
		t.Fatalf("create rotate share = %d: %s", rotateCreate.Code, rotateCreate.Body.String())
	}
	rotating := decodeShareEnvelope[ShareLinkDTO](t, rotateCreate.Body.Bytes()).Data
	rotate := perform(router, http.MethodPost, "/api/share-links/"+uintPath(rotating.ID)+"/rotate-token", nil, cookieHeaders(login.Result().Cookies()))
	if rotate.Code != http.StatusOK {
		t.Fatalf("rotate token = %d: %s", rotate.Code, rotate.Body.String())
	}
	rotated := decodeShareEnvelope[ShareLinkDTO](t, rotate.Body.Bytes()).Data
	if rotated.Token == "" || rotated.Token == rotating.Token {
		t.Fatalf("rotate did not return a new one-time token: before=%q after=%q", rotating.Token, rotated.Token)
	}
	oldToken := perform(router, http.MethodGet, "/api/shared/"+rotating.Token, nil, nil)
	if oldToken.Code != http.StatusNotFound {
		t.Fatalf("old token response = %d: %s", oldToken.Code, oldToken.Body.String())
	}
	newToken := perform(router, http.MethodGet, "/api/shared/"+rotated.Token, nil, nil)
	if newToken.Code != http.StatusOK {
		t.Fatalf("new token response = %d: %s", newToken.Code, newToken.Body.String())
	}

	deleteResponse := perform(router, http.MethodDelete, "/api/email/"+rotateMessage.ID, nil, cookieHeaders(login.Result().Cookies()))
	if deleteResponse.Code != http.StatusOK {
		t.Fatalf("delete source message = %d: %s", deleteResponse.Code, deleteResponse.Body.String())
	}
	deletedSource := perform(router, http.MethodGet, "/api/shared/"+rotated.Token, nil, nil)
	if deletedSource.Code != http.StatusNotFound {
		t.Fatalf("deleted source shared read = %d: %s", deletedSource.Code, deletedSource.Body.String())
	}
}

func TestShareLinkExpiredReturnsGone(t *testing.T) {
	db := httpTestDB(t)
	owner := createShareTestUser(t, db, "owner@example.test")
	domain := createShareTestDomain(t, db, "expired-share.test", models.DomainModePrivate, &owner.ID)
	mailbox := createShareTestMailbox(t, db, owner, domain, "gone@expired-share.test")
	message := createShareTestMessage(t, db, "expired-share-message", mailbox.Email, domain, false)
	router := testRouter(t, db)
	login := loginShareTestUser(t, router, owner.Email)

	create := perform(router, http.MethodPost, "/api/share-links", map[string]any{
		"message_id": message.ID,
	}, cookieHeaders(login.Result().Cookies()))
	if create.Code != http.StatusCreated {
		t.Fatalf("create share = %d: %s", create.Code, create.Body.String())
	}
	created := decodeShareEnvelope[ShareLinkDTO](t, create.Body.Bytes()).Data
	past := time.Now().Add(-time.Minute)
	if err := db.Model(&models.ShareLink{}).Where("id = ?", created.ID).Update("expires_at", &past).Error; err != nil {
		t.Fatal(err)
	}
	expired := perform(router, http.MethodGet, "/api/shared/"+created.Token, nil, nil)
	if expired.Code != http.StatusGone {
		t.Fatalf("expired shared read = %d: %s", expired.Code, expired.Body.String())
	}
}

type shareEnvelope[T any] struct {
	Success bool `json:"success"`
	Data    T    `json:"data"`
	Error   any  `json:"error"`
}

func decodeShareEnvelope[T any](t *testing.T, body []byte) shareEnvelope[T] {
	t.Helper()
	var out shareEnvelope[T]
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatal(err)
	}
	if !out.Success {
		t.Fatalf("response was not successful: %s", string(body))
	}
	return out
}

func createShareTestUser(t *testing.T, db *gorm.DB, email string) models.User {
	t.Helper()
	ensureShareTestInstalled(t, db)
	hash, err := auth.HashSecret("password123")
	if err != nil {
		t.Fatal(err)
	}
	user := models.User{
		Email:        email,
		PasswordHash: hash,
		Role:         models.UserRoleUser,
		Enabled:      true,
		DailyLimit:   1000,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	return user
}

func ensureShareTestInstalled(t *testing.T, db *gorm.DB) {
	t.Helper()
	var count int64
	if err := db.Model(&models.User{}).Where("role = ?", models.UserRoleAdmin).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count > 0 {
		return
	}
	hash, err := auth.HashSecret("password123")
	if err != nil {
		t.Fatal(err)
	}
	admin := models.User{
		Email:        "admin@example.test",
		PasswordHash: hash,
		Role:         models.UserRoleAdmin,
		Enabled:      true,
	}
	if err := db.Create(&admin).Error; err != nil {
		t.Fatal(err)
	}
}

func createShareTestDomain(t *testing.T, db *gorm.DB, name, mode string, ownerID *uint) models.Domain {
	t.Helper()
	domain := models.Domain{
		Domain:          name,
		Mode:            mode,
		OwnerID:         ownerID,
		Active:          true,
		MXVerified:      true,
		WildcardEnabled: true,
	}
	if err := db.Create(&domain).Error; err != nil {
		t.Fatal(err)
	}
	return domain
}

func createShareTestMailbox(t *testing.T, db *gorm.DB, owner models.User, domain models.Domain, email string) models.Mailbox {
	t.Helper()
	local := strings.Split(email, "@")[0]
	mailbox := models.Mailbox{
		OwnerID:   owner.ID,
		Email:     email,
		LocalPart: local,
		Host:      domain.Domain,
		DomainID:  domain.ID,
	}
	if err := db.Create(&mailbox).Error; err != nil {
		t.Fatal(err)
	}
	return mailbox
}

func createShareTestMessage(t *testing.T, db *gorm.DB, id, recipient string, domain models.Domain, seen bool) models.Message {
	t.Helper()
	parts := strings.Split(recipient, "@")
	local := parts[0]
	msg := models.Message{
		ID:              id,
		Recipient:       recipient,
		RecipientLocal:  local,
		RecipientDomain: domain.Domain,
		RootDomain:      domain.Domain,
		DomainID:        &domain.ID,
		FromAddress:     "sender@example.test",
		FromName:        "Sender",
		Subject:         "Safe subject",
		Seen:            seen,
		TextContent:     "hello from shared message",
		HTMLContent:     `<p>Safe</p><script>alert("x")</script>`,
		HeadersJSON:     `{"x-secret":"do-not-share"}`,
		ExpiresAt:       time.Now().Add(time.Hour),
	}
	if err := db.Create(&msg).Error; err != nil {
		t.Fatal(err)
	}
	return msg
}

func loginShareTestUser(t *testing.T, router http.Handler, email string) *httptest.ResponseRecorder {
	t.Helper()
	login := perform(router, http.MethodPost, "/api/auth/login", map[string]any{
		"email":    email,
		"password": "password123",
	}, nil)
	if login.Code != http.StatusOK {
		t.Fatalf("login %s = %d: %s", email, login.Code, login.Body.String())
	}
	return login
}

func cookieHeaders(cookies []*http.Cookie) map[string]string {
	values := make([]string, 0, len(cookies))
	for _, cookie := range cookies {
		values = append(values, cookie.Name+"="+cookie.Value)
	}
	return map[string]string{"Cookie": strings.Join(values, "; ")}
}

func uintPath(id uint) string {
	return strconv.FormatUint(uint64(id), 10)
}
