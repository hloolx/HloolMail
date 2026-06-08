package httpapi

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
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
		Email:         "user@example.com",
		PasswordHash:  hash,
		EmailVerified: true,
		Role:          models.UserRoleUser,
		Enabled:       true,
	}
	admin := models.User{
		Email:         "admin@example.com",
		PasswordHash:  hash,
		EmailVerified: true,
		Role:          models.UserRoleAdmin,
		Enabled:       true,
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
		Email:         "user@example.com",
		PasswordHash:  hash,
		EmailVerified: true,
		Role:          models.UserRoleUser,
		Enabled:       true,
	}
	admin := models.User{
		Email:         "admin@example.com",
		PasswordHash:  hash,
		EmailVerified: true,
		Role:          models.UserRoleAdmin,
		Enabled:       true,
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
	markSameOrigin(request)
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
		Email:         "first@example.com",
		PasswordHash:  hash,
		EmailVerified: true,
		Role:          models.UserRoleUser,
		Enabled:       true,
	}
	second := models.User{
		Email:         "second@example.com",
		PasswordHash:  hash,
		EmailVerified: true,
		Role:          models.UserRoleUser,
		Enabled:       true,
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

func TestBindOAuthIdentityMarksCurrentUserEmailVerified(t *testing.T) {
	db := httpTestDB(t)
	hash, err := auth.HashSecret("password123")
	if err != nil {
		t.Fatal(err)
	}
	user := models.User{
		Email:        "bind-me@example.com",
		PasswordHash: hash,
		Role:         models.UserRoleUser,
		Enabled:      true,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	handler := &Handler{DB: db}

	boundUser, err := handler.bindOAuthIdentity(user.ID, oauthProviderGitHub, OAuthUserInfo{
		ProviderUID: "github-bind-me",
		Email:       "bind-me@example.com",
	}, oauthToken{})
	if err != nil {
		t.Fatalf("bind identity: %v", err)
	}
	if !boundUser.EmailVerified {
		t.Fatal("bound user should be marked email verified")
	}

	var reloaded models.User
	if err := db.First(&reloaded, user.ID).Error; err != nil {
		t.Fatal(err)
	}
	if !reloaded.EmailVerified {
		t.Fatal("stored user should be marked email verified")
	}
}

func TestBindOAuthIdentityFillsBlankNicknameAndAvatarURL(t *testing.T) {
	db := httpTestDB(t)
	hash, err := auth.HashSecret("password123")
	if err != nil {
		t.Fatal(err)
	}
	user := models.User{
		Email:         "bind-nickname@example.com",
		PasswordHash:  hash,
		EmailVerified: true,
		Role:          models.UserRoleUser,
		Enabled:       true,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	handler := &Handler{DB: db}

	boundUser, err := handler.bindOAuthIdentity(user.ID, oauthProviderLinuxDo, OAuthUserInfo{
		ProviderUID: "linuxdo-bind-nickname",
		Email:       "bind-nickname@example.com",
		Name:        "Linux Friend",
		AvatarURL:   "https://example.com/linux.png",
	}, oauthToken{})
	if err != nil {
		t.Fatalf("bind identity: %v", err)
	}
	if boundUser.Nickname != "Linux Friend" {
		t.Fatalf("bound nickname = %q, want %q", boundUser.Nickname, "Linux Friend")
	}
	var reloaded models.User
	if err := db.First(&reloaded, user.ID).Error; err != nil {
		t.Fatal(err)
	}
	if reloaded.Nickname != "Linux Friend" {
		t.Fatalf("stored nickname = %q, want %q", reloaded.Nickname, "Linux Friend")
	}
	if reloaded.AvatarURL != "https://example.com/linux.png" {
		t.Fatalf("stored avatar_url = %q, want %q", reloaded.AvatarURL, "https://example.com/linux.png")
	}
}

func TestLoginOAuthUserRejectsUnverifiedEmailMatch(t *testing.T) {
	db := httpTestDB(t)
	hash, err := auth.HashSecret("password123")
	if err != nil {
		t.Fatal(err)
	}
	user := models.User{
		Email:        "claimed@example.com",
		PasswordHash: hash,
		Role:         models.UserRoleUser,
		Enabled:      true,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	handler := &Handler{DB: db}

	_, _, err = handler.loginOAuthUser(oauthProviderGitHub, OAuthUserInfo{
		ProviderUID: "github-claimed",
		Email:       "claimed@example.com",
	}, oauthToken{})
	if err == nil || !strings.Contains(err.Error(), "unverified local account") {
		t.Fatalf("expected unverified local account error, got %v", err)
	}

	var identityCount int64
	db.Model(&models.OAuthIdentity{}).Where("user_id = ?", user.ID).Count(&identityCount)
	if identityCount != 0 {
		t.Fatalf("identity count = %d, want 0", identityCount)
	}
	var reloaded models.User
	if err := db.First(&reloaded, user.ID).Error; err != nil {
		t.Fatal(err)
	}
	if reloaded.EmailVerified {
		t.Fatal("unverified local account was marked verified")
	}
}

func TestLoginOAuthUserRejectsNewUserWhenRegistrationClosed(t *testing.T) {
	db := httpTestDB(t)
	if err := db.Create(&models.LoginSettings{
		ID:                       1,
		RegistrationOpen:         false,
		EmailRegistrationEnabled: true,
	}).Error; err != nil {
		t.Fatal(err)
	}
	handler := &Handler{DB: db}

	_, isNew, err := handler.loginOAuthUser(oauthProviderGitHub, OAuthUserInfo{
		ProviderUID: "github-new-closed",
		Email:       "new-closed@example.com",
	}, oauthToken{})
	if err == nil || !strings.Contains(err.Error(), "registration is disabled") {
		t.Fatalf("expected registration disabled error, got %v", err)
	}
	if !errors.Is(err, errOAuthRegistrationDisabled) {
		t.Fatalf("expected registration disabled sentinel, got %v", err)
	}
	if isNew {
		t.Fatal("closed registration should not report a new OAuth user")
	}

	var userCount int64
	db.Model(&models.User{}).Where("email = ?", "new-closed@example.com").Count(&userCount)
	if userCount != 0 {
		t.Fatalf("user count = %d, want 0", userCount)
	}
	var identityCount int64
	db.Model(&models.OAuthIdentity{}).Where("provider = ? AND provider_uid = ?", oauthProviderGitHub, "github-new-closed").Count(&identityCount)
	if identityCount != 0 {
		t.Fatalf("identity count = %d, want 0", identityCount)
	}
}

func TestOAuthRegistrationClosedRedirect(t *testing.T) {
	redirect := oauthRegistrationClosedRedirect(oauthProviderGitHub)
	want := "/#/login?oauth_error=registration_closed&oauth_provider=github"
	if redirect != want {
		t.Fatalf("redirect = %q, want %q", redirect, want)
	}
}

func TestLoginOAuthUserAllowsExistingIdentityWhenRegistrationClosed(t *testing.T) {
	db := httpTestDB(t)
	if err := db.Create(&models.LoginSettings{
		ID:                       1,
		RegistrationOpen:         false,
		EmailRegistrationEnabled: false,
	}).Error; err != nil {
		t.Fatal(err)
	}
	hash, err := auth.HashSecret("password123")
	if err != nil {
		t.Fatal(err)
	}
	user := models.User{
		Email:         "bound@example.com",
		PasswordHash:  hash,
		EmailVerified: true,
		Role:          models.UserRoleUser,
		Enabled:       true,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&models.OAuthIdentity{
		UserID:      user.ID,
		Provider:    oauthProviderGitHub,
		ProviderUID: "github-bound",
	}).Error; err != nil {
		t.Fatal(err)
	}
	handler := &Handler{DB: db}

	loggedIn, isNew, err := handler.loginOAuthUser(oauthProviderGitHub, OAuthUserInfo{
		ProviderUID: "github-bound",
		Email:       "bound@example.com",
		Name:        "Bound Name",
		AvatarURL:   "https://example.com/bound.png",
	}, oauthToken{})
	if err != nil {
		t.Fatalf("login oauth user: %v", err)
	}
	if isNew {
		t.Fatal("existing OAuth identity should not create a new user")
	}
	if loggedIn.ID != user.ID {
		t.Fatalf("logged in user id = %d, want %d", loggedIn.ID, user.ID)
	}
	if loggedIn.Nickname != "Bound Name" {
		t.Fatalf("logged in nickname = %q, want %q", loggedIn.Nickname, "Bound Name")
	}

	var identityCount int64
	db.Model(&models.OAuthIdentity{}).Where("user_id = ? AND provider = ?", user.ID, oauthProviderGitHub).Count(&identityCount)
	if identityCount != 1 {
		t.Fatalf("identity count = %d, want 1", identityCount)
	}
	var reloaded models.User
	if err := db.First(&reloaded, user.ID).Error; err != nil {
		t.Fatal(err)
	}
	if reloaded.AvatarURL != "https://example.com/bound.png" {
		t.Fatalf("stored avatar_url = %q, want %q", reloaded.AvatarURL, "https://example.com/bound.png")
	}
}

func TestLoginOAuthUserMergesVerifiedEmailMatch(t *testing.T) {
	db := httpTestDB(t)
	if err := db.Create(&models.LoginSettings{
		ID:                       1,
		RegistrationOpen:         false,
		EmailRegistrationEnabled: false,
	}).Error; err != nil {
		t.Fatal(err)
	}
	hash, err := auth.HashSecret("password123")
	if err != nil {
		t.Fatal(err)
	}
	user := models.User{
		Email:         "verified@example.com",
		PasswordHash:  hash,
		EmailVerified: true,
		Role:          models.UserRoleUser,
		Enabled:       true,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	handler := &Handler{DB: db}

	merged, isNew, err := handler.loginOAuthUser(oauthProviderGitHub, OAuthUserInfo{
		ProviderUID: "github-verified",
		Email:       "verified@example.com",
	}, oauthToken{})
	if err != nil {
		t.Fatalf("login oauth user: %v", err)
	}
	if isNew {
		t.Fatal("verified email match should merge existing account when registration is closed")
	}
	if merged.ID != user.ID {
		t.Fatalf("merged user id = %d, want %d", merged.ID, user.ID)
	}

	var identityCount int64
	db.Model(&models.OAuthIdentity{}).Where("user_id = ? AND provider = ?", user.ID, oauthProviderGitHub).Count(&identityCount)
	if identityCount != 1 {
		t.Fatalf("identity count = %d, want 1", identityCount)
	}
}

func TestLoginOAuthUserCreatesNicknameAndAvatarURL(t *testing.T) {
	db := httpTestDB(t)
	if err := db.Create(&models.LoginSettings{
		ID:                       1,
		RegistrationOpen:         true,
		EmailRegistrationEnabled: false,
	}).Error; err != nil {
		t.Fatal(err)
	}
	handler := &Handler{DB: db}

	user, isNew, err := handler.loginOAuthUser(oauthProviderGitHub, OAuthUserInfo{
		ProviderUID: "github-new-nickname",
		Email:       "oauth-new@example.com",
		Name:        "OAuth Person",
		AvatarURL:   "https://example.com/oauth.png",
	}, oauthToken{})
	if err != nil {
		t.Fatalf("login oauth user: %v", err)
	}
	if !isNew {
		t.Fatal("new OAuth user should report isNew")
	}
	if user.Nickname != "OAuth Person" {
		t.Fatalf("nickname = %q, want %q", user.Nickname, "OAuth Person")
	}
	var reloaded models.User
	if err := db.First(&reloaded, user.ID).Error; err != nil {
		t.Fatal(err)
	}
	if reloaded.Nickname != "OAuth Person" {
		t.Fatalf("stored nickname = %q, want %q", reloaded.Nickname, "OAuth Person")
	}
	if reloaded.AvatarURL != "https://example.com/oauth.png" {
		t.Fatalf("stored avatar_url = %q, want %q", reloaded.AvatarURL, "https://example.com/oauth.png")
	}
}

func TestLoginOAuthUserIgnoresUnsafeAvatarURL(t *testing.T) {
	db := httpTestDB(t)
	if err := db.Create(&models.LoginSettings{
		ID:                       1,
		RegistrationOpen:         true,
		EmailRegistrationEnabled: false,
	}).Error; err != nil {
		t.Fatal(err)
	}
	handler := &Handler{DB: db}
	cases := []string{
		"http://example.com/avatar.png",
		"data:image/png;base64,abc",
		"file:///tmp/avatar.png",
		"/avatar.png",
	}

	for index, avatarURL := range cases {
		t.Run(avatarURL, func(t *testing.T) {
			user, isNew, err := handler.loginOAuthUser(oauthProviderGitHub, OAuthUserInfo{
				ProviderUID: "github-unsafe-avatar-" + strconv.Itoa(index),
				Email:       fmt.Sprintf("unsafe-avatar-%d@example.com", index),
				Name:        "Unsafe Avatar",
				AvatarURL:   avatarURL,
			}, oauthToken{})
			if err != nil {
				t.Fatalf("login oauth user: %v", err)
			}
			if !isNew {
				t.Fatal("new OAuth user should report isNew")
			}
			var reloaded models.User
			if err := db.First(&reloaded, user.ID).Error; err != nil {
				t.Fatal(err)
			}
			if reloaded.AvatarURL != "" {
				t.Fatalf("stored avatar_url = %q, want empty", reloaded.AvatarURL)
			}
		})
	}
}

func TestLoginOAuthUserNicknameFallbackAndNoOverwrite(t *testing.T) {
	db := httpTestDB(t)
	if err := db.Create(&models.LoginSettings{
		ID:                       1,
		RegistrationOpen:         true,
		EmailRegistrationEnabled: false,
	}).Error; err != nil {
		t.Fatal(err)
	}
	handler := &Handler{DB: db}

	created, _, err := handler.loginOAuthUser(oauthProviderGitHub, OAuthUserInfo{
		ProviderUID: "github-fallback",
		Email:       "fallback@example.com",
		Name:        "bad\nname",
	}, oauthToken{})
	if err != nil {
		t.Fatalf("login oauth user: %v", err)
	}
	if created.Nickname != "fallback" {
		t.Fatalf("fallback nickname = %q, want %q", created.Nickname, "fallback")
	}

	created.Nickname = "Kept Name"
	if err := db.Save(created).Error; err != nil {
		t.Fatal(err)
	}
	loggedIn, isNew, err := handler.loginOAuthUser(oauthProviderGitHub, OAuthUserInfo{
		ProviderUID: "github-fallback",
		Email:       "fallback@example.com",
		Name:        "Replacement",
	}, oauthToken{})
	if err != nil {
		t.Fatalf("login oauth user again: %v", err)
	}
	if isNew {
		t.Fatal("existing OAuth identity should not report new user")
	}
	if loggedIn.Nickname != "Kept Name" {
		t.Fatalf("nickname was overwritten to %q", loggedIn.Nickname)
	}
}

func TestOAuthIdentityListDoesNotExposeAvatarURL(t *testing.T) {
	db := httpTestDB(t)
	hash, err := auth.HashSecret("password123")
	if err != nil {
		t.Fatal(err)
	}
	user := models.User{
		Email:         "identity-list@example.com",
		PasswordHash:  hash,
		Nickname:      "Identity List",
		EmailVerified: true,
		Role:          models.UserRoleUser,
		Enabled:       true,
		AvatarURL:     "https://example.com/stored.png",
	}
	admin := models.User{
		Email:         "identity-admin@example.com",
		PasswordHash:  hash,
		EmailVerified: true,
		Role:          models.UserRoleAdmin,
		Enabled:       true,
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
		ProviderUID: "github-identity-list",
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

	list := perform(router, http.MethodGet, "/api/user/oauth-identities", nil, sessionHeaders(login))
	if list.Code != http.StatusOK {
		t.Fatalf("list = %d: %s", list.Code, list.Body.String())
	}
	if strings.Contains(list.Body.String(), "avatar_url") || strings.Contains(list.Body.String(), "stored.png") {
		t.Fatalf("identity list exposed avatar data: %s", list.Body.String())
	}
}

func TestDecodeLinuxDoUserInfoExtractsNicknameClaimsAndAvatarURL(t *testing.T) {
	raw := []byte(`{
		"id": 12345,
		"email": "linux@example.com",
		"username": "Linux Nick",
		"avatar_url": "https://example.com/avatar.png"
	}`)
	info, err := decodeLinuxDoUserInfo(raw)
	if err != nil {
		t.Fatalf("decode linux.do json: %v", err)
	}
	if info.ProviderUID != "12345" || info.Email != "linux@example.com" || info.Name != "Linux Nick" {
		t.Fatalf("decoded info = %+v", info)
	}
	if info.AvatarURL != "https://example.com/avatar.png" {
		t.Fatalf("decoded avatar_url = %q, want %q", info.AvatarURL, "https://example.com/avatar.png")
	}
}

func TestDecodeLinuxDoUserInfoSupportsNestedUserPayload(t *testing.T) {
	raw := []byte(`{
		"user": {
			"id": 67890,
			"email": "nested@example.com",
			"login": "nested-user"
		},
		"avatar_template": "/user_avatar/connect.linux.do/nested/{size}/1.png"
	}`)
	info, err := decodeLinuxDoUserInfo(raw)
	if err != nil {
		t.Fatalf("decode nested linux.do json: %v", err)
	}
	if info.ProviderUID != "67890" || info.Email != "nested@example.com" || info.Name != "nested-user" {
		t.Fatalf("decoded nested info = %+v", info)
	}
	wantAvatar := "https://connect.linux.do/user_avatar/connect.linux.do/nested/96/1.png"
	if info.AvatarURL != wantAvatar {
		t.Fatalf("decoded nested avatar_url = %q, want %q", info.AvatarURL, wantAvatar)
	}
}

func TestDecodeLinuxDoUserInfoRejectsJWTClaims(t *testing.T) {
	claims := base64.RawURLEncoding.EncodeToString([]byte(`{
		"sub": "linux-jwt-1",
		"email": "jwt@example.com",
		"name": "JWT Nick",
		"picture": "https://example.com/picture.png"
	}`))
	if _, err := decodeLinuxDoUserInfo([]byte("e30." + claims + ".sig")); err == nil {
		t.Fatal("expected linux.do userinfo JWT payload to be rejected")
	}
	if _, err := decodeLinuxDoUserInfo([]byte(`"e30.` + claims + `.sig"`)); err == nil {
		t.Fatal("expected JSON string JWT payload to be rejected")
	}
}

func TestFetchLinuxDoUserInfoDoesNotFallbackToIDTokenOnPrimaryError(t *testing.T) {
	restore := stubOAuthHTTPClient(t, func(req *http.Request) (*http.Response, error) {
		if req.URL.Path != "/api/user" {
			t.Fatalf("unexpected linux.do endpoint: %s", req.URL.String())
		}
		return oauthTestResponse(req, http.StatusInternalServerError, `{"error":"temporary"}`), nil
	})
	defer restore()

	_, err := fetchLinuxDoUserInfo(context.Background(), oauthToken{
		AccessToken: "access-token",
		IDToken:     unsignedLinuxDoIDToken(`{"sub":"jwt-id","email":"jwt@example.com"}`),
	})
	if err == nil {
		t.Fatal("expected primary userinfo error to be returned without id_token fallback")
	}
}

func TestFetchLinuxDoUserInfoDoesNotFallbackToIDTokenOnSecondaryError(t *testing.T) {
	paths := []string{}
	restore := stubOAuthHTTPClient(t, func(req *http.Request) (*http.Response, error) {
		paths = append(paths, req.URL.Path)
		switch req.URL.Path {
		case "/api/user":
			return oauthTestResponse(req, http.StatusNotFound, `{"error":"not found"}`), nil
		case "/oauth2/userinfo":
			return oauthTestResponse(req, http.StatusBadGateway, `{"error":"temporary"}`), nil
		default:
			t.Fatalf("unexpected linux.do endpoint: %s", req.URL.String())
			return nil, nil
		}
	})
	defer restore()

	_, err := fetchLinuxDoUserInfo(context.Background(), oauthToken{
		AccessToken: "access-token",
		IDToken:     unsignedLinuxDoIDToken(`{"sub":"jwt-id","email":"jwt@example.com"}`),
	})
	if err == nil {
		t.Fatal("expected secondary userinfo error to be returned without id_token fallback")
	}
	if got := strings.Join(paths, ","); got != "/api/user,/oauth2/userinfo" {
		t.Fatalf("linux.do userinfo endpoints = %s", got)
	}
}

func TestFetchLinuxDoUserInfoDoesNotFillMissingFieldsFromIDToken(t *testing.T) {
	restore := stubOAuthHTTPClient(t, func(req *http.Request) (*http.Response, error) {
		if req.URL.Path != "/api/user" {
			t.Fatalf("unexpected linux.do endpoint: %s", req.URL.String())
		}
		return oauthTestResponse(req, http.StatusOK, `{"name":"Missing Fields"}`), nil
	})
	defer restore()

	_, err := fetchLinuxDoUserInfo(context.Background(), oauthToken{
		AccessToken: "access-token",
		IDToken:     unsignedLinuxDoIDToken(`{"sub":"jwt-id","email":"jwt@example.com"}`),
	})
	if err == nil || !strings.Contains(err.Error(), "user id") {
		t.Fatalf("expected missing user id error without id_token fallback, got %v", err)
	}
}

func TestFetchLinuxDoUserInfoUsesSecondaryUserInfoAfterNotFound(t *testing.T) {
	restore := stubOAuthHTTPClient(t, func(req *http.Request) (*http.Response, error) {
		switch req.URL.Path {
		case "/api/user":
			return oauthTestResponse(req, http.StatusNotFound, `{"error":"not found"}`), nil
		case "/oauth2/userinfo":
			return oauthTestResponse(req, http.StatusOK, `{
				"sub": "linux-secondary",
				"email": "secondary@example.com",
				"name": "Secondary User"
			}`), nil
		default:
			t.Fatalf("unexpected linux.do endpoint: %s", req.URL.String())
			return nil, nil
		}
	})
	defer restore()

	info, err := fetchLinuxDoUserInfo(context.Background(), oauthToken{AccessToken: "access-token"})
	if err != nil {
		t.Fatalf("fetch linux.do userinfo: %v", err)
	}
	if info.ProviderUID != "linux-secondary" || info.Email != "secondary@example.com" || info.Name != "Secondary User" {
		t.Fatalf("linux.do secondary userinfo = %+v", info)
	}
}

func TestSanitizeOAuthAvatarURLAllowsOnlyHTTPS(t *testing.T) {
	cases := []struct {
		name  string
		input string
		want  string
	}{
		{name: "https", input: " https://example.com/avatar.png ", want: "https://example.com/avatar.png"},
		{name: "http", input: "http://example.com/avatar.png", want: ""},
		{name: "data", input: "data:image/png;base64,abc", want: ""},
		{name: "file", input: "file:///tmp/avatar.png", want: ""},
		{name: "relative", input: "/avatar.png", want: ""},
		{name: "missing host", input: "https:///avatar.png", want: ""},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := sanitizeOAuthAvatarURL(tc.input); got != tc.want {
				t.Fatalf("sanitizeOAuthAvatarURL(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func stubOAuthHTTPClient(t *testing.T, fn roundTripFunc) func() {
	t.Helper()
	originalClient := oauthHTTPClient
	oauthHTTPClient = &http.Client{Transport: fn}
	return func() {
		oauthHTTPClient = originalClient
	}
}

func oauthTestResponse(req *http.Request, status int, body string) *http.Response {
	header := make(http.Header)
	header.Set("Content-Type", "application/json")
	return &http.Response{
		StatusCode: status,
		Header:     header,
		Body:       io.NopCloser(strings.NewReader(body)),
		Request:    req,
	}
}

func unsignedLinuxDoIDToken(claims string) string {
	return "e30." + base64.RawURLEncoding.EncodeToString([]byte(claims)) + ".sig"
}
