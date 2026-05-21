package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"gptmail/internal/auth"
	"gptmail/internal/models"
)

func TestNotificationRESTRequiresSessionAndIgnoresAPIKey(t *testing.T) {
	db := httpTestDB(t)
	owner := createShareTestUser(t, db, "notification-owner@example.test")
	other := createShareTestUser(t, db, "notification-other@example.test")
	if err := db.Create(&[]models.Notification{
		{UserID: &owner.ID, Type: "OWNER_UNREAD", Message: "owner unread", Read: false},
		{UserID: &owner.ID, Type: "OWNER_READ", Message: "owner read", Read: true},
		{UserID: &other.ID, Type: "OTHER_UNREAD", Message: "other unread", Read: false},
	}).Error; err != nil {
		t.Fatal(err)
	}
	var ownerUnread models.Notification
	if err := db.First(&ownerUnread, "user_id = ? AND read = ?", owner.ID, false).Error; err != nil {
		t.Fatal(err)
	}
	key, plain, err := (auth.APIKeyService{DB: db}).CreateFor(&owner.ID, "notification-key", 1, 0, nil)
	if err != nil {
		t.Fatal(err)
	}
	router := testRouter(t, db)

	for _, request := range []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/api/notifications"},
		{http.MethodGet, "/api/notifications/unread-count"},
		{http.MethodPatch, "/api/notifications/" + uintPath(ownerUnread.ID) + "/read"},
		{http.MethodPost, "/api/notifications/read-all"},
	} {
		response := perform(router, request.method, request.path, nil, map[string]string{"X-API-Key": plain})
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("%s %s with API key only = %d, want 401: %s", request.method, request.path, response.Code, response.Body.String())
		}
		if !strings.Contains(response.Body.String(), "login required") {
			t.Fatalf("%s %s response did not require login: %s", request.method, request.path, response.Body.String())
		}
	}

	var refreshed models.APIKey
	if err := db.First(&refreshed, key.ID).Error; err != nil {
		t.Fatal(err)
	}
	if refreshed.UsedToday != 0 || refreshed.TotalUsed != 0 || refreshed.LastUsedAt != nil {
		t.Fatalf("API key-only notification requests consumed quota: used_today=%d total_used=%d last_used_at=%v", refreshed.UsedToday, refreshed.TotalUsed, refreshed.LastUsedAt)
	}
	var usageLogs int64
	if err := db.Model(&models.APIUsageLog{}).Where("api_key_id = ?", key.ID).Count(&usageLogs).Error; err != nil {
		t.Fatal(err)
	}
	if usageLogs != 0 {
		t.Fatalf("API key-only notification requests wrote %d APIUsageLog rows", usageLogs)
	}

	login := loginShareTestUser(t, router, owner.Email)
	headers := cookieHeaders(login.Result().Cookies())
	headers["X-API-Key"] = "definitely-wrong"

	list := perform(router, http.MethodGet, "/api/notifications", nil, headers)
	if list.Code != http.StatusOK {
		t.Fatalf("session notification list with bad API key = %d: %s", list.Code, list.Body.String())
	}
	if !strings.Contains(list.Body.String(), "owner unread") || strings.Contains(list.Body.String(), "other unread") {
		t.Fatalf("session notification list did not stay scoped to cookie user: %s", list.Body.String())
	}

	count := perform(router, http.MethodGet, "/api/notifications/unread-count", nil, headers)
	if count.Code != http.StatusOK {
		t.Fatalf("session unread count with bad API key = %d: %s", count.Code, count.Body.String())
	}
	var countBody struct {
		Success bool `json:"success"`
		Data    struct {
			Unread int64 `json:"unread"`
		} `json:"data"`
	}
	if err := json.Unmarshal(count.Body.Bytes(), &countBody); err != nil {
		t.Fatal(err)
	}
	if !countBody.Success || countBody.Data.Unread != 1 {
		t.Fatalf("unread count = %+v, response: %s", countBody, count.Body.String())
	}

	read := perform(router, http.MethodPatch, "/api/notifications/"+uintPath(ownerUnread.ID)+"/read", nil, headers)
	if read.Code != http.StatusOK {
		t.Fatalf("session mark read with bad API key = %d: %s", read.Code, read.Body.String())
	}
	readAll := perform(router, http.MethodPost, "/api/notifications/read-all", nil, headers)
	if readAll.Code != http.StatusOK {
		t.Fatalf("session mark all read with bad API key = %d: %s", readAll.Code, readAll.Body.String())
	}
}
