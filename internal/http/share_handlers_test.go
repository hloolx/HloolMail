package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"gptmail/internal/auth"
	"gptmail/internal/config"
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
		"mailbox_id": mailbox.ID,
	}, cookieHeaders(login.Result().Cookies()))
	if create.Code != http.StatusCreated {
		t.Fatalf("create share = %d: %s", create.Code, create.Body.String())
	}
	created := decodeShareEnvelope[ShareLinkDTO](t, create.Body.Bytes()).Data
	if created.ResourceType != models.ShareResourceTypeMailbox || created.MailboxID == nil || *created.MailboxID != mailbox.ID {
		t.Fatalf("created share is not a mailbox share: %+v", created)
	}
	if created.MailboxEmail != mailbox.Email {
		t.Fatalf("created share missing mailbox email: %+v", created)
	}
	if created.Token == "" {
		t.Fatal("create response did not include one-time token")
	}
	if created.AccessKey == "" {
		t.Fatal("create response did not include one-time access key")
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
	if stored.AccessKeyHash == "" || stored.AccessKeyHash == created.AccessKey {
		t.Fatalf("access key hash was not stored safely: hash=%q key=%q", stored.AccessKeyHash, created.AccessKey)
	}

	list := perform(router, http.MethodGet, "/api/share-links", nil, cookieHeaders(login.Result().Cookies()))
	if list.Code != http.StatusOK {
		t.Fatalf("list share links = %d: %s", list.Code, list.Body.String())
	}
	if strings.Contains(list.Body.String(), created.Token) || strings.Contains(list.Body.String(), created.AccessKey) {
		t.Fatalf("list response leaked one-time token/key: %s", list.Body.String())
	}
	listPage := decodeShareEnvelope[paginatedResponse[ShareLinkDTO]](t, list.Body.Bytes()).Data
	if len(listPage.Items) != 1 || listPage.Items[0].MailboxEmail != mailbox.Email {
		t.Fatalf("list response missing mailbox email: %+v", listPage)
	}
	get := perform(router, http.MethodGet, "/api/share-links/"+uintPath(created.ID), nil, cookieHeaders(login.Result().Cookies()))
	if get.Code != http.StatusOK {
		t.Fatalf("get share link = %d: %s", get.Code, get.Body.String())
	}
	if strings.Contains(get.Body.String(), created.Token) || strings.Contains(get.Body.String(), created.AccessKey) {
		t.Fatalf("get response leaked one-time token/key: %s", get.Body.String())
	}
	got := decodeShareEnvelope[ShareLinkDTO](t, get.Body.Bytes()).Data
	if got.MailboxEmail != mailbox.Email {
		t.Fatalf("get response missing mailbox email: %+v", got)
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
	apiKeyOnlyCreate := perform(router, http.MethodPost, "/api/share-links", map[string]any{
		"mailbox_id": mailbox.ID,
	}, map[string]string{
		"X-API-Key": plainAPIKey,
	})
	if apiKeyOnlyCreate.Code != http.StatusUnauthorized {
		t.Fatalf("api key-only share link create = %d: %s", apiKeyOnlyCreate.Code, apiKeyOnlyCreate.Body.String())
	}
	sessionWithBadAPIKeyHeaders := cookieHeaders(login.Result().Cookies())
	sessionWithBadAPIKeyHeaders["X-API-Key"] = "definitely-wrong"
	sessionWithBadAPIKey := perform(router, http.MethodGet, "/api/share-links", nil, sessionWithBadAPIKeyHeaders)
	if sessionWithBadAPIKey.Code != http.StatusOK {
		t.Fatalf("session share link management should ignore api key header, got %d: %s", sessionWithBadAPIKey.Code, sessionWithBadAPIKey.Body.String())
	}
	public := perform(router, http.MethodGet, "/api/shared/"+created.Token+"/messages/"+message.ID+"?key="+url.QueryEscape(created.AccessKey), nil, map[string]string{
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

	badHeaderRead := perform(router, http.MethodGet, "/api/shared/"+created.Token+"?key="+url.QueryEscape(created.AccessKey), nil, map[string]string{
		"X-API-Key": "definitely-wrong",
	})
	if badHeaderRead.Code != http.StatusOK {
		t.Fatalf("public shared read with bad api key = %d: %s", badHeaderRead.Code, badHeaderRead.Body.String())
	}
}

func TestShareLinkCreationIsMailboxOnly(t *testing.T) {
	db := httpTestDB(t)
	mailboxOwner := createShareTestUser(t, db, "mailbox-owner@example.test")
	otherUser := createShareTestUser(t, db, "other-user@example.test")
	domain := createShareTestDomain(t, db, "mailbox-only.test", models.DomainModePrivate, &mailboxOwner.ID)
	mailbox := createShareTestMailbox(t, db, mailboxOwner, domain, "demo@mailbox-only.test")
	message := createShareTestMessage(t, db, "mailbox-only-message", mailbox.Email, domain, false)

	router := testRouter(t, db)
	mailboxOwnerLogin := loginShareTestUser(t, router, mailboxOwner.Email)
	implicitMessage := perform(router, http.MethodPost, "/api/share-links", map[string]any{
		"message_id": message.ID,
	}, cookieHeaders(mailboxOwnerLogin.Result().Cookies()))
	if implicitMessage.Code != http.StatusBadRequest {
		t.Fatalf("implicit message_id share request = %d: %s", implicitMessage.Code, implicitMessage.Body.String())
	}

	explicitMessage := perform(router, http.MethodPost, "/api/share-links", map[string]any{
		"resource_type": "message",
		"message_id":    message.ID,
	}, cookieHeaders(mailboxOwnerLogin.Result().Cookies()))
	if explicitMessage.Code != http.StatusBadRequest {
		t.Fatalf("explicit message resource share request = %d: %s", explicitMessage.Code, explicitMessage.Body.String())
	}

	missingMailbox := perform(router, http.MethodPost, "/api/share-links", map[string]any{}, cookieHeaders(mailboxOwnerLogin.Result().Cookies()))
	if missingMailbox.Code != http.StatusBadRequest {
		t.Fatalf("default mailbox share without mailbox_id = %d: %s", missingMailbox.Code, missingMailbox.Body.String())
	}

	mailboxShare := perform(router, http.MethodPost, "/api/share-links", map[string]any{
		"resource_type": "mailbox",
		"mailbox_id":    mailbox.ID,
	}, cookieHeaders(mailboxOwnerLogin.Result().Cookies()))
	if mailboxShare.Code != http.StatusCreated {
		t.Fatalf("mailbox share = %d: %s", mailboxShare.Code, mailboxShare.Body.String())
	}
	created := decodeShareEnvelope[ShareLinkDTO](t, mailboxShare.Body.Bytes()).Data
	if created.ResourceType != models.ShareResourceTypeMailbox || created.MailboxID == nil || *created.MailboxID != mailbox.ID {
		t.Fatalf("created share should be mailbox-only: %+v", created)
	}

	mailboxShareWithMessage := perform(router, http.MethodPost, "/api/share-links", map[string]any{
		"resource_type": "mailbox",
		"mailbox_id":    mailbox.ID,
		"message_id":    message.ID,
	}, cookieHeaders(mailboxOwnerLogin.Result().Cookies()))
	if mailboxShareWithMessage.Code != http.StatusBadRequest {
		t.Fatalf("mailbox share with message_id = %d: %s", mailboxShareWithMessage.Code, mailboxShareWithMessage.Body.String())
	}

	otherLogin := loginShareTestUser(t, router, otherUser.Email)
	otherCreate := perform(router, http.MethodPost, "/api/share-links", map[string]any{
		"mailbox_id": mailbox.ID,
	}, cookieHeaders(otherLogin.Result().Cookies()))
	if otherCreate.Code != http.StatusForbidden {
		t.Fatalf("other user mailbox share = %d: %s", otherCreate.Code, otherCreate.Body.String())
	}
}

func TestShareLinkManagementIsAlwaysOwnerScoped(t *testing.T) {
	db := httpTestDB(t)
	owner := createShareTestUser(t, db, "owner-scope@example.test")
	var admin models.User
	if err := db.First(&admin, "email = ?", "admin@example.test").Error; err != nil {
		t.Fatal(err)
	}
	ownerDomain := createShareTestDomain(t, db, "owner-scope.test", models.DomainModePrivate, &owner.ID)
	adminDomain := createShareTestDomain(t, db, "admin-scope.test", models.DomainModePrivate, &admin.ID)
	ownerMailbox := createShareTestMailbox(t, db, owner, ownerDomain, "owner@owner-scope.test")
	adminMailbox := createShareTestMailbox(t, db, admin, adminDomain, "admin@admin-scope.test")
	router := testRouter(t, db)
	ownerLogin := loginShareTestUser(t, router, owner.Email)
	adminLogin := loginShareTestUser(t, router, admin.Email)

	ownerCreate := perform(router, http.MethodPost, "/api/share-links", map[string]any{
		"mailbox_id": ownerMailbox.ID,
	}, cookieHeaders(ownerLogin.Result().Cookies()))
	if ownerCreate.Code != http.StatusCreated {
		t.Fatalf("owner create share = %d: %s", ownerCreate.Code, ownerCreate.Body.String())
	}
	ownerShare := decodeShareEnvelope[ShareLinkDTO](t, ownerCreate.Body.Bytes()).Data

	adminCreate := perform(router, http.MethodPost, "/api/share-links", map[string]any{
		"mailbox_id": adminMailbox.ID,
	}, cookieHeaders(adminLogin.Result().Cookies()))
	if adminCreate.Code != http.StatusCreated {
		t.Fatalf("admin own create share = %d: %s", adminCreate.Code, adminCreate.Body.String())
	}
	adminShare := decodeShareEnvelope[ShareLinkDTO](t, adminCreate.Body.Bytes()).Data

	adminCreateOther := perform(router, http.MethodPost, "/api/share-links", map[string]any{
		"mailbox_id": ownerMailbox.ID,
	}, cookieHeaders(adminLogin.Result().Cookies()))
	if adminCreateOther.Code != http.StatusForbidden {
		t.Fatalf("admin personal endpoint created another user's share = %d: %s", adminCreateOther.Code, adminCreateOther.Body.String())
	}

	adminList := perform(router, http.MethodGet, "/api/share-links?page=1&per_page=10", nil, cookieHeaders(adminLogin.Result().Cookies()))
	if adminList.Code != http.StatusOK {
		t.Fatalf("admin personal list = %d: %s", adminList.Code, adminList.Body.String())
	}
	adminPage := decodeShareEnvelope[paginatedResponse[ShareLinkDTO]](t, adminList.Body.Bytes()).Data
	if adminPage.Total != 1 || len(adminPage.Items) != 1 || adminPage.Items[0].ID != adminShare.ID {
		t.Fatalf("admin personal list should contain only admin-owned share: %+v", adminPage)
	}

	ownerList := perform(router, http.MethodGet, "/api/share-links?page=1&per_page=10", nil, cookieHeaders(ownerLogin.Result().Cookies()))
	if ownerList.Code != http.StatusOK {
		t.Fatalf("owner list = %d: %s", ownerList.Code, ownerList.Body.String())
	}
	ownerPage := decodeShareEnvelope[paginatedResponse[ShareLinkDTO]](t, ownerList.Body.Bytes()).Data
	if ownerPage.Total != 1 || len(ownerPage.Items) != 1 || ownerPage.Items[0].ID != ownerShare.ID {
		t.Fatalf("owner list should contain only owner-owned share: %+v", ownerPage)
	}

	adminGetOwner := perform(router, http.MethodGet, "/api/share-links/"+uintPath(ownerShare.ID), nil, cookieHeaders(adminLogin.Result().Cookies()))
	if adminGetOwner.Code != http.StatusNotFound {
		t.Fatalf("admin personal get another user's share = %d: %s", adminGetOwner.Code, adminGetOwner.Body.String())
	}

	var beforeOwnerShare models.ShareLink
	if err := db.First(&beforeOwnerShare, ownerShare.ID).Error; err != nil {
		t.Fatal(err)
	}
	adminHeaders := cookieHeaders(adminLogin.Result().Cookies())
	futureExpires := time.Now().Add(2 * time.Hour).UTC().Format(time.RFC3339)
	for _, attempt := range []struct {
		name   string
		method string
		path   string
		body   map[string]any
	}{
		{"patch", http.MethodPatch, "/api/share-links/" + uintPath(ownerShare.ID), map[string]any{"expires_at": futureExpires}},
		{"revoke", http.MethodPost, "/api/share-links/" + uintPath(ownerShare.ID) + "/revoke", nil},
		{"rotate-token", http.MethodPost, "/api/share-links/" + uintPath(ownerShare.ID) + "/rotate-token", nil},
		{"rotate-key", http.MethodPost, "/api/share-links/" + uintPath(ownerShare.ID) + "/rotate-key", nil},
		{"access-logs", http.MethodGet, "/api/share-links/" + uintPath(ownerShare.ID) + "/access-logs", nil},
		{"delete", http.MethodDelete, "/api/share-links/" + uintPath(ownerShare.ID), nil},
	} {
		response := perform(router, attempt.method, attempt.path, attempt.body, adminHeaders)
		if response.Code != http.StatusNotFound {
			t.Fatalf("admin personal %s another user's share = %d: %s", attempt.name, response.Code, response.Body.String())
		}
	}
	var afterOwnerShare models.ShareLink
	if err := db.First(&afterOwnerShare, ownerShare.ID).Error; err != nil {
		t.Fatal(err)
	}
	if afterOwnerShare.TokenPrefix != beforeOwnerShare.TokenPrefix ||
		afterOwnerShare.TokenHash != beforeOwnerShare.TokenHash ||
		afterOwnerShare.AccessKeyHash != beforeOwnerShare.AccessKeyHash ||
		afterOwnerShare.RevokedAt != nil {
		t.Fatalf("admin personal subroutes modified another user's share: before=%+v after=%+v", beforeOwnerShare, afterOwnerShare)
	}
}

func TestAdminShareLinksGlobalManagement(t *testing.T) {
	db := httpTestDB(t)
	owner := createShareTestUser(t, db, "global-share-owner@example.test")
	var admin models.User
	if err := db.First(&admin, "email = ?", "admin@example.test").Error; err != nil {
		t.Fatal(err)
	}
	ownerDomain := createShareTestDomain(t, db, "global-owner.test", models.DomainModePrivate, &owner.ID)
	adminDomain := createShareTestDomain(t, db, "global-admin.test", models.DomainModePrivate, &admin.ID)
	ownerMailbox := createShareTestMailbox(t, db, owner, ownerDomain, "owner@global-owner.test")
	adminMailbox := createShareTestMailbox(t, db, admin, adminDomain, "admin@global-admin.test")
	router := testRouterWithConfig(t, db, func(cfg *config.Config) {
		cfg.AdminToken = "test-admin-token"
	})
	ownerLogin := loginShareTestUser(t, router, owner.Email)
	adminLogin := loginShareTestUser(t, router, admin.Email)

	ownerCreate := perform(router, http.MethodPost, "/api/share-links", map[string]any{
		"mailbox_id": ownerMailbox.ID,
	}, cookieHeaders(ownerLogin.Result().Cookies()))
	if ownerCreate.Code != http.StatusCreated {
		t.Fatalf("owner create share = %d: %s", ownerCreate.Code, ownerCreate.Body.String())
	}
	ownerShare := decodeShareEnvelope[ShareLinkDTO](t, ownerCreate.Body.Bytes()).Data
	adminCreate := perform(router, http.MethodPost, "/api/share-links", map[string]any{
		"mailbox_id": adminMailbox.ID,
	}, cookieHeaders(adminLogin.Result().Cookies()))
	if adminCreate.Code != http.StatusCreated {
		t.Fatalf("admin create share = %d: %s", adminCreate.Code, adminCreate.Body.String())
	}
	adminShare := decodeShareEnvelope[ShareLinkDTO](t, adminCreate.Body.Bytes()).Data

	userGlobalList := perform(router, http.MethodGet, "/api/admin/share-links", nil, cookieHeaders(ownerLogin.Result().Cookies()))
	if userGlobalList.Code != http.StatusForbidden {
		t.Fatalf("non-admin global share list = %d: %s", userGlobalList.Code, userGlobalList.Body.String())
	}
	for _, attempt := range []struct {
		name   string
		method string
		path   string
	}{
		{"logs", http.MethodGet, "/api/admin/share-links/" + uintPath(ownerShare.ID) + "/access-logs"},
		{"revoke", http.MethodPost, "/api/admin/share-links/" + uintPath(ownerShare.ID) + "/revoke"},
		{"delete", http.MethodDelete, "/api/admin/share-links/" + uintPath(ownerShare.ID)},
	} {
		response := perform(router, attempt.method, attempt.path, nil, cookieHeaders(ownerLogin.Result().Cookies()))
		if response.Code != http.StatusForbidden {
			t.Fatalf("non-admin global share %s = %d: %s", attempt.name, response.Code, response.Body.String())
		}
	}
	for _, attempt := range []struct {
		name   string
		method string
		path   string
	}{
		{"list", http.MethodGet, "/api/admin/share-links"},
		{"logs", http.MethodGet, "/api/admin/share-links/" + uintPath(ownerShare.ID) + "/access-logs"},
		{"revoke", http.MethodPost, "/api/admin/share-links/" + uintPath(ownerShare.ID) + "/revoke"},
		{"delete", http.MethodDelete, "/api/admin/share-links/" + uintPath(ownerShare.ID)},
	} {
		response := perform(router, attempt.method, attempt.path, nil, map[string]string{"X-Admin-Token": "test-admin-token"})
		if response.Code != http.StatusForbidden {
			t.Fatalf("admin token-only global share %s = %d: %s", attempt.name, response.Code, response.Body.String())
		}
	}

	adminGlobalList := perform(router, http.MethodGet, "/api/admin/share-links?page=1&per_page=10", nil, cookieHeaders(adminLogin.Result().Cookies()))
	if adminGlobalList.Code != http.StatusOK {
		t.Fatalf("admin global share list = %d: %s", adminGlobalList.Code, adminGlobalList.Body.String())
	}
	body := adminGlobalList.Body.String()
	if strings.Contains(body, ownerShare.Token) || strings.Contains(body, ownerShare.AccessKey) || strings.Contains(body, adminShare.Token) || strings.Contains(body, adminShare.AccessKey) {
		t.Fatalf("admin global list leaked one-time token/key: %s", body)
	}
	assertAdminShareLinkResponseRedacted(t, adminGlobalList.Body.Bytes())
	globalPage := decodeShareEnvelope[paginatedResponse[AdminShareLinkDTO]](t, adminGlobalList.Body.Bytes()).Data
	if globalPage.Total != 2 || len(globalPage.Items) != 2 {
		t.Fatalf("admin global list should include all shares: %+v", globalPage)
	}
	if !adminSharePageContains(globalPage, ownerShare.ID, owner.Email, ownerMailbox.Email) {
		t.Fatalf("admin global list missing owner share metadata: %+v", globalPage)
	}
	if !adminSharePageContains(globalPage, adminShare.ID, admin.Email, adminMailbox.Email) {
		t.Fatalf("admin global list missing admin share metadata: %+v", globalPage)
	}

	searchOwner := perform(router, http.MethodGet, "/api/admin/share-links?q=global-share-owner%40example.test&page=1&per_page=10", nil, cookieHeaders(adminLogin.Result().Cookies()))
	if searchOwner.Code != http.StatusOK {
		t.Fatalf("admin global share search = %d: %s", searchOwner.Code, searchOwner.Body.String())
	}
	searchPage := decodeShareEnvelope[paginatedResponse[AdminShareLinkDTO]](t, searchOwner.Body.Bytes()).Data
	if searchPage.Total != 1 || len(searchPage.Items) != 1 || searchPage.Items[0].ID != ownerShare.ID {
		t.Fatalf("admin global search should isolate owner share: %+v", searchPage)
	}

	read := perform(router, http.MethodGet, "/api/shared/"+ownerShare.Token+"?key="+url.QueryEscape(ownerShare.AccessKey), nil, nil)
	if read.Code != http.StatusOK {
		t.Fatalf("shared read before admin actions = %d: %s", read.Code, read.Body.String())
	}
	logs := perform(router, http.MethodGet, "/api/admin/share-links/"+uintPath(ownerShare.ID)+"/access-logs", nil, cookieHeaders(adminLogin.Result().Cookies()))
	if logs.Code != http.StatusOK {
		t.Fatalf("admin global share logs = %d: %s", logs.Code, logs.Body.String())
	}
	logPage := decodeShareEnvelope[paginatedResponse[shareLinkAccessLogDTO]](t, logs.Body.Bytes()).Data
	if logPage.Total != 1 || len(logPage.Items) != 1 || logPage.Items[0].ShareLinkID != ownerShare.ID {
		t.Fatalf("admin global logs should show owner share access: %+v", logPage)
	}

	revoke := perform(router, http.MethodPost, "/api/admin/share-links/"+uintPath(ownerShare.ID)+"/revoke", nil, cookieHeaders(adminLogin.Result().Cookies()))
	if revoke.Code != http.StatusOK {
		t.Fatalf("admin revoke owner share = %d: %s", revoke.Code, revoke.Body.String())
	}
	assertAdminShareLinkResponseRedacted(t, revoke.Body.Bytes())
	revokedRead := perform(router, http.MethodGet, "/api/shared/"+ownerShare.Token+"?key="+url.QueryEscape(ownerShare.AccessKey), nil, nil)
	if revokedRead.Code != http.StatusGone {
		t.Fatalf("revoked share read = %d: %s", revokedRead.Code, revokedRead.Body.String())
	}

	deleteResponse := perform(router, http.MethodDelete, "/api/admin/share-links/"+uintPath(ownerShare.ID), nil, cookieHeaders(adminLogin.Result().Cookies()))
	if deleteResponse.Code != http.StatusOK {
		t.Fatalf("admin delete owner share = %d: %s", deleteResponse.Code, deleteResponse.Body.String())
	}
	var remaining int64
	if err := db.Model(&models.ShareLink{}).Where("id = ?", ownerShare.ID).Count(&remaining).Error; err != nil {
		t.Fatal(err)
	}
	if remaining != 0 {
		t.Fatalf("owner share still exists after admin delete: %d", remaining)
	}
	var remainingLogs int64
	if err := db.Model(&models.ShareLinkAccessLog{}).Where("share_link_id = ?", ownerShare.ID).Count(&remainingLogs).Error; err != nil {
		t.Fatal(err)
	}
	if remainingLogs != 0 {
		t.Fatalf("owner share access logs still exist after admin delete: %d", remainingLogs)
	}
	var auditLogs []models.AuditLog
	if err := db.Where("action IN ?", []string{"share_link.revoke", "share_link.delete"}).Order("created_at asc").Find(&auditLogs).Error; err != nil {
		t.Fatal(err)
	}
	if len(auditLogs) != 2 {
		t.Fatalf("admin share audit logs = %+v, want revoke and delete", auditLogs)
	}
	for _, log := range auditLogs {
		if log.Actor != admin.Email || log.TargetType != "share_link" || log.TargetID != uintPath(ownerShare.ID) || log.Target != uintPath(ownerShare.ID) {
			t.Fatalf("unexpected admin share audit log identity: %+v", log)
		}
		if log.Category != auditCategorySecurity || log.Severity != auditSeverityWarning {
			t.Fatalf("unexpected admin share audit classification: %+v", log)
		}
		if !strings.Contains(log.Metadata, "owner_id="+uintPath(owner.ID)) || !strings.Contains(log.Metadata, "token_prefix="+ownerShare.TokenPrefix) {
			t.Fatalf("admin share audit metadata missing redacted target context: %+v", log)
		}
		for _, forbidden := range []string{ownerShare.Token, ownerShare.AccessKey, "token_hash", "access_key_hash"} {
			if strings.Contains(log.Metadata, forbidden) {
				t.Fatalf("admin share audit metadata leaked %q: %+v", forbidden, log)
			}
		}
	}
}

func TestMailboxShareKeyAccessRevokeAndRotate(t *testing.T) {
	db := httpTestDB(t)
	owner := createShareTestUser(t, db, "owner@example.test")
	domain := createShareTestDomain(t, db, "secure.test", models.DomainModePrivate, &owner.ID)
	mailbox := createShareTestMailbox(t, db, owner, domain, "secret@secure.test")
	router := testRouter(t, db)
	login := loginShareTestUser(t, router, owner.Email)

	expiresAt := time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
	create := perform(router, http.MethodPost, "/api/share-links", map[string]any{
		"mailbox_id":  mailbox.ID,
		"expires_at":  expiresAt,
		"extra_field": "ignored",
	}, cookieHeaders(login.Result().Cookies()))
	if create.Code != http.StatusCreated {
		t.Fatalf("create mailbox share = %d: %s", create.Code, create.Body.String())
	}
	created := decodeShareEnvelope[ShareLinkDTO](t, create.Body.Bytes()).Data
	if !created.KeySet || created.AccessKey == "" {
		t.Fatalf("created mailbox share key fields mismatch: %+v", created)
	}

	locked := perform(router, http.MethodGet, "/api/shared/"+created.Token, nil, nil)
	if locked.Code != http.StatusOK {
		t.Fatalf("locked mailbox shared GET = %d: %s", locked.Code, locked.Body.String())
	}
	lockedBody := locked.Body.String()
	if !strings.Contains(lockedBody, "key_required") || strings.Contains(lockedBody, mailbox.Email) || strings.Contains(lockedBody, "text_content") || strings.Contains(lockedBody, "html_content") {
		t.Fatalf("locked response exposed content or missed key state: %s", lockedBody)
	}

	wrong := perform(router, http.MethodGet, "/api/shared/"+created.Token+"?key=wrong", nil, nil)
	if wrong.Code != http.StatusUnauthorized {
		t.Fatalf("wrong key response = %d: %s", wrong.Code, wrong.Body.String())
	}
	var link models.ShareLink
	if err := db.First(&link, created.ID).Error; err != nil {
		t.Fatal(err)
	}
	if link.AccessCount != 0 {
		t.Fatalf("wrong key incremented access count: %d", link.AccessCount)
	}

	correct := perform(router, http.MethodGet, "/api/shared/"+created.Token+"?key="+url.QueryEscape(created.AccessKey), nil, nil)
	if correct.Code != http.StatusOK {
		t.Fatalf("correct key response = %d: %s", correct.Code, correct.Body.String())
	}
	unlocked := decodeShareEnvelope[publicSharedMailboxDTO](t, correct.Body.Bytes()).Data
	if unlocked.Mailbox.ID != mailbox.ID || unlocked.Mailbox.Email != mailbox.Email {
		t.Fatalf("unlocked mailbox metadata mismatch: %+v", unlocked)
	}
	if err := db.First(&link, created.ID).Error; err != nil {
		t.Fatal(err)
	}
	if link.AccessCount != 1 {
		t.Fatalf("correct key access count = %d, want 1", link.AccessCount)
	}
	var logs []models.ShareLinkAccessLog
	if err := db.Order("created_at asc").Find(&logs, "share_link_id = ?", created.ID).Error; err != nil {
		t.Fatal(err)
	}
	if len(logs) != 2 || logs[0].Success || logs[0].FailureReason != "invalid_key" || !logs[1].Success {
		t.Fatalf("unexpected access logs: %+v", logs)
	}
	removedAccessEndpoint := perform(router, http.MethodPost, "/api/shared/"+created.Token+"/access", map[string]any{
		"key": created.AccessKey,
	}, nil)
	if removedAccessEndpoint.Code != http.StatusNotFound {
		t.Fatalf("removed shared access endpoint = %d: %s", removedAccessEndpoint.Code, removedAccessEndpoint.Body.String())
	}

	revoke := perform(router, http.MethodPost, "/api/share-links/"+uintPath(created.ID)+"/revoke", nil, cookieHeaders(login.Result().Cookies()))
	if revoke.Code != http.StatusOK {
		t.Fatalf("revoke share = %d: %s", revoke.Code, revoke.Body.String())
	}
	var revokeAudit models.AuditLog
	if err := db.First(&revokeAudit, "action = ? AND target = ?", "share_link.revoke", uintPath(created.ID)).Error; err != nil {
		t.Fatal(err)
	}
	if revokeAudit.Actor != owner.Email || revokeAudit.TargetType != "share_link" || revokeAudit.TargetID != uintPath(created.ID) {
		t.Fatalf("unexpected owner revoke audit log: %+v", revokeAudit)
	}
	for _, forbidden := range []string{created.Token, created.AccessKey, "access_url", "share_url"} {
		if strings.Contains(revokeAudit.Metadata, forbidden) {
			t.Fatalf("owner revoke audit metadata leaked %q: %+v", forbidden, revokeAudit)
		}
	}
	gone := perform(router, http.MethodGet, "/api/shared/"+created.Token, nil, nil)
	if gone.Code != http.StatusGone {
		t.Fatalf("revoked shared read = %d: %s", gone.Code, gone.Body.String())
	}

	rotateCreate := perform(router, http.MethodPost, "/api/share-links", map[string]any{
		"mailbox_id": mailbox.ID,
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
	if rotated.Token == "" || rotated.Token == rotating.Token || rotated.AccessKey == "" || rotated.AccessKey == rotating.AccessKey || rotated.AccessURL == "" {
		t.Fatalf("rotate did not return a complete new one-time link: before=%+v after=%+v", rotating, rotated)
	}
	oldToken := perform(router, http.MethodGet, "/api/shared/"+rotating.Token+"?key="+url.QueryEscape(rotating.AccessKey), nil, nil)
	if oldToken.Code != http.StatusNotFound {
		t.Fatalf("old token response = %d: %s", oldToken.Code, oldToken.Body.String())
	}
	newToken := perform(router, http.MethodGet, "/api/shared/"+rotated.Token+"?key="+url.QueryEscape(rotating.AccessKey), nil, nil)
	if newToken.Code != http.StatusUnauthorized {
		t.Fatalf("new token with old key response = %d: %s", newToken.Code, newToken.Body.String())
	}
	newLink := perform(router, http.MethodGet, "/api/shared/"+rotated.Token+"?key="+url.QueryEscape(rotated.AccessKey), nil, nil)
	if newLink.Code != http.StatusOK {
		t.Fatalf("new token and key response = %d: %s", newLink.Code, newLink.Body.String())
	}

	rotateKey := perform(router, http.MethodPost, "/api/share-links/"+uintPath(rotating.ID)+"/rotate-key", nil, cookieHeaders(login.Result().Cookies()))
	if rotateKey.Code != http.StatusOK {
		t.Fatalf("rotate key = %d: %s", rotateKey.Code, rotateKey.Body.String())
	}
	keyRotated := decodeShareEnvelope[ShareLinkDTO](t, rotateKey.Body.Bytes()).Data
	if keyRotated.AccessKey == "" || keyRotated.AccessKey == rotating.AccessKey {
		t.Fatalf("rotate key did not return a new one-time key: before=%q after=%q", rotating.AccessKey, keyRotated.AccessKey)
	}
	oldKey := perform(router, http.MethodGet, "/api/shared/"+rotated.Token+"?key="+url.QueryEscape(rotated.AccessKey), nil, nil)
	if oldKey.Code != http.StatusUnauthorized {
		t.Fatalf("old key response = %d: %s", oldKey.Code, oldKey.Body.String())
	}
	newKey := perform(router, http.MethodGet, "/api/shared/"+rotated.Token+"?key="+url.QueryEscape(keyRotated.AccessKey), nil, nil)
	if newKey.Code != http.StatusOK {
		t.Fatalf("new key response = %d: %s", newKey.Code, newKey.Body.String())
	}
}

func TestShareLinkDeleteRemovesLinkAndAccessLogs(t *testing.T) {
	db := httpTestDB(t)
	owner := createShareTestUser(t, db, "delete-owner@example.test")
	other := createShareTestUser(t, db, "delete-other@example.test")
	domain := createShareTestDomain(t, db, "delete-share.test", models.DomainModePrivate, &owner.ID)
	mailbox := createShareTestMailbox(t, db, owner, domain, "remove@delete-share.test")
	router := testRouter(t, db)
	ownerLogin := loginShareTestUser(t, router, owner.Email)
	otherLogin := loginShareTestUser(t, router, other.Email)

	create := perform(router, http.MethodPost, "/api/share-links", map[string]any{
		"mailbox_id": mailbox.ID,
	}, cookieHeaders(ownerLogin.Result().Cookies()))
	if create.Code != http.StatusCreated {
		t.Fatalf("create share = %d: %s", create.Code, create.Body.String())
	}
	created := decodeShareEnvelope[ShareLinkDTO](t, create.Body.Bytes()).Data

	read := perform(router, http.MethodGet, "/api/shared/"+created.Token+"?key="+url.QueryEscape(created.AccessKey), nil, nil)
	if read.Code != http.StatusOK {
		t.Fatalf("shared read before delete = %d: %s", read.Code, read.Body.String())
	}

	otherDelete := perform(router, http.MethodDelete, "/api/share-links/"+uintPath(created.ID), nil, cookieHeaders(otherLogin.Result().Cookies()))
	if otherDelete.Code != http.StatusNotFound {
		t.Fatalf("other user delete = %d: %s", otherDelete.Code, otherDelete.Body.String())
	}

	deleteResponse := perform(router, http.MethodDelete, "/api/share-links/"+uintPath(created.ID), nil, cookieHeaders(ownerLogin.Result().Cookies()))
	if deleteResponse.Code != http.StatusOK {
		t.Fatalf("delete share = %d: %s", deleteResponse.Code, deleteResponse.Body.String())
	}
	if !strings.Contains(deleteResponse.Body.String(), `"deleted":true`) {
		t.Fatalf("delete response did not confirm deletion: %s", deleteResponse.Body.String())
	}

	deletedRead := perform(router, http.MethodGet, "/api/shared/"+created.Token+"?key="+url.QueryEscape(created.AccessKey), nil, nil)
	if deletedRead.Code != http.StatusNotFound {
		t.Fatalf("shared read after delete = %d: %s", deletedRead.Code, deletedRead.Body.String())
	}
	var remainingLinks int64
	if err := db.Model(&models.ShareLink{}).Where("id = ?", created.ID).Count(&remainingLinks).Error; err != nil {
		t.Fatal(err)
	}
	if remainingLinks != 0 {
		t.Fatalf("share link was not deleted, count=%d", remainingLinks)
	}
	var remainingLogs int64
	if err := db.Model(&models.ShareLinkAccessLog{}).Where("share_link_id = ?", created.ID).Count(&remainingLogs).Error; err != nil {
		t.Fatal(err)
	}
	if remainingLogs != 0 {
		t.Fatalf("share access logs were not deleted, count=%d", remainingLogs)
	}
	var deleteAudit models.AuditLog
	if err := db.First(&deleteAudit, "action = ? AND target = ?", "share_link.delete", uintPath(created.ID)).Error; err != nil {
		t.Fatal(err)
	}
	if deleteAudit.Actor != owner.Email || deleteAudit.TargetType != "share_link" || deleteAudit.TargetID != uintPath(created.ID) {
		t.Fatalf("unexpected owner delete audit log: %+v", deleteAudit)
	}
	for _, forbidden := range []string{created.Token, created.AccessKey, "access_url", "share_url"} {
		if strings.Contains(deleteAudit.Metadata, forbidden) {
			t.Fatalf("owner delete audit metadata leaked %q: %+v", forbidden, deleteAudit)
		}
	}
}

func TestGenerateEmailMailboxSharePublicAccessAndDeletion(t *testing.T) {
	db := httpTestDB(t)
	owner := createShareTestUser(t, db, "mailbox-share-owner@example.test")
	domain := createShareTestDomain(t, db, "generate-share.test", models.DomainModePrivate, &owner.ID)
	_, plainAPIKey, err := (auth.APIKeyService{DB: db}).CreateFor(&owner.ID, "mailbox-share", 100, 0, nil)
	if err != nil {
		t.Fatal(err)
	}
	router := testRouterWithConfig(t, db, func(cfg *config.Config) {
		cfg.PublicBaseURL = "https://public.example.test/base"
	})

	requestBody, err := json.Marshal(map[string]any{
		"prefix": "shared",
		"domain": domain.Domain,
		"share":  true,
	})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:4321/api/generate-email", bytes.NewReader(requestBody))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-API-Key", plainAPIKey)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusCreated {
		t.Fatalf("generate-email share = %d: %s", response.Code, response.Body.String())
	}
	generated := decodeShareEnvelope[generateEmailTestResponse](t, response.Body.Bytes()).Data
	if generated.Email != "shared@"+domain.Domain {
		t.Fatalf("generated email = %q", generated.Email)
	}
	if generated.Share.URL == "" || generated.Share.AccessURL == "" {
		t.Fatalf("share response missing urls: %+v", generated.Share)
	}
	if strings.Contains(generated.Share.URL, "127.0.0.1") || strings.Contains(generated.Share.AccessURL, "127.0.0.1") {
		t.Fatalf("share URLs used request host: %+v", generated.Share)
	}
	if !strings.HasPrefix(generated.Share.URL, "https://public.example.test/base/share/") {
		t.Fatalf("share URL did not use PUBLIC_BASE_URL: %s", generated.Share.URL)
	}
	accessURL, err := url.Parse(generated.Share.AccessURL)
	if err != nil {
		t.Fatal(err)
	}
	accessKey := accessURL.Query().Get("key")
	if accessKey == "" {
		t.Fatalf("access_url missing key: %s", generated.Share.AccessURL)
	}
	if generated.Share.Key != "" && generated.Share.Key != accessKey {
		t.Fatalf("share key field and access_url key differ: key=%q access_url=%q", generated.Share.Key, accessKey)
	}

	var stored models.ShareLink
	if err := db.First(&stored, generated.Share.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.ResourceType != models.ShareResourceTypeMailbox || stored.MailboxID == nil {
		t.Fatalf("stored share is not mailbox share: %+v", stored)
	}
	if stored.TokenHash == "" || stored.TokenHash == generated.Share.Token {
		t.Fatalf("token was not stored as hash only: %+v", stored)
	}
	if stored.AccessKeyHash == "" || stored.AccessKeyHash == accessKey {
		t.Fatalf("access key was not stored as hash only: %+v", stored)
	}

	locked := perform(router, http.MethodGet, "/api/shared/"+generated.Share.Token, nil, nil)
	if locked.Code != http.StatusOK {
		t.Fatalf("locked mailbox share = %d: %s", locked.Code, locked.Body.String())
	}
	lockedData := decodeShareEnvelope[publicSharedMailboxLockedDTO](t, locked.Body.Bytes()).Data
	if !lockedData.Locked || !lockedData.KeyRequired || strings.Contains(locked.Body.String(), generated.Email) {
		t.Fatalf("locked response exposed mailbox or missed lock state: %s", locked.Body.String())
	}

	wrongKey := perform(router, http.MethodGet, "/api/shared/"+generated.Share.Token+"?key=wrong", nil, nil)
	if wrongKey.Code != http.StatusUnauthorized {
		t.Fatalf("wrong key response = %d: %s", wrongKey.Code, wrongKey.Body.String())
	}

	metadata := perform(router, http.MethodGet, "/api/shared/"+generated.Share.Token+"?key="+url.QueryEscape(accessKey), nil, nil)
	if metadata.Code != http.StatusOK {
		t.Fatalf("correct key metadata = %d: %s", metadata.Code, metadata.Body.String())
	}
	metadataData := decodeShareEnvelope[publicSharedMailboxDTO](t, metadata.Body.Bytes()).Data
	if metadataData.Mailbox.Email != generated.Email || metadataData.Mailbox.ID != *stored.MailboxID {
		t.Fatalf("metadata mismatch: %+v", metadataData)
	}

	message := createShareTestMessage(t, db, "mailbox-share-message", generated.Email, domain, false)
	otherMailbox := createShareTestMailbox(t, db, owner, domain, "other@"+domain.Domain)
	otherMessage := createShareTestMessage(t, db, "mailbox-share-other-message", otherMailbox.Email, domain, false)

	list := perform(router, http.MethodGet, "/api/shared/"+generated.Share.Token+"/messages?key="+url.QueryEscape(accessKey), nil, nil)
	if list.Code != http.StatusOK {
		t.Fatalf("shared mailbox list = %d: %s", list.Code, list.Body.String())
	}
	listData := decodeShareEnvelope[[]messageSummary](t, list.Body.Bytes()).Data
	if len(listData) != 1 || listData[0].ID != message.ID {
		t.Fatalf("shared mailbox list = %+v, want only %s", listData, message.ID)
	}

	detail := perform(router, http.MethodGet, "/api/shared/"+generated.Share.Token+"/messages/"+message.ID+"?key="+url.QueryEscape(accessKey), nil, nil)
	if detail.Code != http.StatusOK {
		t.Fatalf("shared mailbox detail = %d: %s", detail.Code, detail.Body.String())
	}
	detailData := decodeShareEnvelope[PublicSharedMailboxMessageDTO](t, detail.Body.Bytes()).Data
	if detailData.ID != message.ID || detailData.Recipient != generated.Email {
		t.Fatalf("detail mismatch: %+v", detailData)
	}
	otherDetail := perform(router, http.MethodGet, "/api/shared/"+generated.Share.Token+"/messages/"+otherMessage.ID+"?key="+url.QueryEscape(accessKey), nil, nil)
	if otherDetail.Code != http.StatusNotFound {
		t.Fatalf("other mailbox detail = %d: %s", otherDetail.Code, otherDetail.Body.String())
	}

	var mailbox models.Mailbox
	if err := db.First(&mailbox, "id = ?", *stored.MailboxID).Error; err != nil {
		t.Fatal(err)
	}
	deleteResponse := perform(router, http.MethodDelete, "/api/mailboxes/"+uintPath(mailbox.ID), nil, map[string]string{"X-API-Key": plainAPIKey})
	if deleteResponse.Code != http.StatusOK {
		t.Fatalf("delete mailbox = %d: %s", deleteResponse.Code, deleteResponse.Body.String())
	}
	deletedShareRead := perform(router, http.MethodGet, "/api/shared/"+generated.Share.Token+"?key="+url.QueryEscape(accessKey), nil, nil)
	if deletedShareRead.Code != http.StatusNotFound {
		t.Fatalf("deleted mailbox share read = %d: %s", deletedShareRead.Code, deletedShareRead.Body.String())
	}
	var remainingLinks int64
	if err := db.Model(&models.ShareLink{}).Where("id = ?", generated.Share.ID).Count(&remainingLinks).Error; err != nil {
		t.Fatal(err)
	}
	if remainingLinks != 0 {
		t.Fatalf("mailbox share link was not deleted, count=%d", remainingLinks)
	}
	var remainingLogs int64
	if err := db.Model(&models.ShareLinkAccessLog{}).Where("share_link_id = ?", generated.Share.ID).Count(&remainingLogs).Error; err != nil {
		t.Fatal(err)
	}
	if remainingLogs != 0 {
		t.Fatalf("mailbox share access logs were not deleted, count=%d", remainingLogs)
	}
}

func TestShareLinkExpiredReturnsGone(t *testing.T) {
	db := httpTestDB(t)
	owner := createShareTestUser(t, db, "owner@example.test")
	domain := createShareTestDomain(t, db, "expired-share.test", models.DomainModePrivate, &owner.ID)
	mailbox := createShareTestMailbox(t, db, owner, domain, "gone@expired-share.test")
	router := testRouter(t, db)
	login := loginShareTestUser(t, router, owner.Email)

	create := perform(router, http.MethodPost, "/api/share-links", map[string]any{
		"mailbox_id": mailbox.ID,
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

type generateEmailTestResponse struct {
	Email    string                `json:"email"`
	DomainID uint                  `json:"domain_id"`
	Domain   models.Domain         `json:"domain"`
	Reuse    bool                  `json:"reuse"`
	Share    generateEmailShareDTO `json:"share"`
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
	var mailbox models.Mailbox
	var ownerID *uint
	var mailboxID *uint
	if err := db.First(&mailbox, "email = ?", recipient).Error; err == nil {
		resolvedOwnerID := mailbox.OwnerID
		resolvedMailboxID := mailbox.ID
		ownerID = &resolvedOwnerID
		mailboxID = &resolvedMailboxID
	}
	msg := models.Message{
		ID:              id,
		Recipient:       recipient,
		RecipientLocal:  local,
		RecipientDomain: domain.Domain,
		RootDomain:      domain.Domain,
		DomainID:        &domain.ID,
		OwnerID:         ownerID,
		MailboxID:       mailboxID,
		FromAddress:     "sender@example.test",
		FromName:        "Sender",
		Subject:         "Safe subject",
		Seen:            seen,
		TextContent:     "hello from shared mailbox",
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
	return map[string]string{
		"Cookie":         strings.Join(values, "; "),
		"Sec-Fetch-Site": "same-origin",
	}
}

func adminSharePageContains(page paginatedResponse[AdminShareLinkDTO], id uint, ownerEmail, mailboxEmail string) bool {
	for _, item := range page.Items {
		if item.ID == id && item.OwnerEmail == ownerEmail && item.MailboxEmail == mailboxEmail {
			return true
		}
	}
	return false
}

func assertAdminShareLinkResponseRedacted(t *testing.T, body []byte) {
	t.Helper()
	var payload any
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"token", "access_key", "share_url", "access_url", "token_hash", "access_key_hash"} {
		if jsonFieldExists(payload, field) {
			t.Fatalf("admin share response exposed %q: %s", field, string(body))
		}
	}
}

func jsonFieldExists(value any, field string) bool {
	switch typed := value.(type) {
	case map[string]any:
		if _, ok := typed[field]; ok {
			return true
		}
		for _, child := range typed {
			if jsonFieldExists(child, field) {
				return true
			}
		}
	case []any:
		for _, child := range typed {
			if jsonFieldExists(child, field) {
				return true
			}
		}
	}
	return false
}

func uintPath(id uint) string {
	return strconv.FormatUint(uint64(id), 10)
}
