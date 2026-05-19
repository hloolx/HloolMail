package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"gptmail/internal/auth"
	"gptmail/internal/models"
)

func TestBindOAuthIdentityCreatesSingleProviderBinding(t *testing.T) {
	db := httpTestDB(t)
	hash, err := auth.HashSecret("password123")
	if err != nil {
		t.Fatal(err)
	}
	user := models.User{
		Email:        "user@example.com",
		PasswordHash: hash,
		Role:         models.UserRoleUser,
		Enabled:      true,
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
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	handler := &Handler{DB: db}

	boundUser, err := handler.bindOAuthIdentity(user.ID, oauthProviderGitHub, OAuthUserInfo{
		ProviderUID: "github-1",
		Email:       user.Email,
		AvatarURL:   "https://example.com/avatar.png",
	}, oauthToken{})
	if err != nil {
		t.Fatalf("bind identity: %v", err)
	}
	if boundUser.Email != user.Email {
		t.Fatalf("bound user email = %q", boundUser.Email)
	}

	var count int64
	db.Model(&models.OAuthIdentity{}).Where("user_id = ? AND provider = ?", user.ID, oauthProviderGitHub).Count(&count)
	if count != 1 {
		t.Fatalf("identity count = %d, want 1", count)
	}

	_, err = handler.bindOAuthIdentity(user.ID, oauthProviderGitHub, OAuthUserInfo{
		ProviderUID: "github-2",
		Email:       user.Email,
	}, oauthToken{})
	if err == nil || !strings.Contains(err.Error(), "already bound") {
		t.Fatalf("expected duplicate provider bind error, got %v", err)
	}
}

func TestUserOAuthIdentityEndpointsListAndUnbind(t *testing.T) {
	db := httpTestDB(t)
	hash, err := auth.HashSecret("password123")
	if err != nil {
		t.Fatal(err)
	}
	user := models.User{
		Email:        "user@example.com",
		PasswordHash: hash,
		Role:         models.UserRoleUser,
		Enabled:      true,
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
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&models.OAuthIdentity{
		UserID:      user.ID,
		Provider:    oauthProviderGitHub,
		ProviderUID: "github-1",
	}).Error; err != nil {
		t.Fatal(err)
	}
	router := testRouter(t, db)
	login := perform(router, http.MethodPost, "/api/auth/login", map[string]any{
		"email":    user.Email,
		"password": "password123",
	}, nil)
	if login.Code != http.StatusOK {
		t.Fatalf("login = %d: %s", login.Code, login.Body.String())
	}

	list := performWithCookies(router, http.MethodGet, "/api/user/oauth-identities", login.Result().Cookies())
	if list.Code != http.StatusOK {
		t.Fatalf("list = %d: %s", list.Code, list.Body.String())
	}
	var payload struct {
		Data []oauthIdentityDTO `json:"data"`
	}
	if err := json.Unmarshal(list.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Data) != 1 || payload.Data[0].Provider != oauthProviderGitHub {
		t.Fatalf("unexpected identities: %+v", payload.Data)
	}

	unbind := performWithCookies(router, http.MethodDelete, "/api/user/oauth-identities/github", login.Result().Cookies())
	if unbind.Code != http.StatusOK {
		t.Fatalf("unbind = %d: %s", unbind.Code, unbind.Body.String())
	}
	var count int64
	db.Model(&models.OAuthIdentity{}).Where("user_id = ? AND provider = ?", user.ID, oauthProviderGitHub).Count(&count)
	if count != 0 {
		t.Fatalf("identity count after unbind = %d", count)
	}
}

func performWithCookies(handler http.Handler, method, path string, cookies []*http.Cookie) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, nil)
	for _, cookie := range cookies {
		request.AddCookie(cookie)
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func TestBindOAuthIdentityRejectsIdentityBoundToAnotherUser(t *testing.T) {
	db := httpTestDB(t)
	hash, err := auth.HashSecret("password123")
	if err != nil {
		t.Fatal(err)
	}
	first := models.User{
		Email:        "first@example.com",
		PasswordHash: hash,
		Role:         models.UserRoleUser,
		Enabled:      true,
	}
	second := models.User{
		Email:        "second@example.com",
		PasswordHash: hash,
		Role:         models.UserRoleUser,
		Enabled:      true,
	}
	if err := db.Create(&first).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&second).Error; err != nil {
		t.Fatal(err)
	}
	handler := &Handler{DB: db}

	if _, err := handler.bindOAuthIdentity(first.ID, oauthProviderLinuxDo, OAuthUserInfo{
		ProviderUID: "linuxdo-1",
		Email:       first.Email,
	}, oauthToken{}); err != nil {
		t.Fatalf("bind first identity: %v", err)
	}

	_, err = handler.bindOAuthIdentity(second.ID, oauthProviderLinuxDo, OAuthUserInfo{
		ProviderUID: "linuxdo-1",
		Email:       second.Email,
	}, oauthToken{})
	if err == nil || !strings.Contains(err.Error(), "already bound to another user") {
		t.Fatalf("expected cross-user bind error, got %v", err)
	}
}
