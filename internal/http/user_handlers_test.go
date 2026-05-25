package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"gptmail/internal/auth"
	"gptmail/internal/models"
)

func TestPatchUserProfileUpdatesNicknameAndIgnoresAvatarURL(t *testing.T) {
	db := httpTestDB(t)
	createInstalledAdmin(t, db)
	hash, err := auth.HashSecret("password123")
	if err != nil {
		t.Fatal(err)
	}
	user := models.User{
		Email:         "profile@example.com",
		PasswordHash:  hash,
		EmailVerified: true,
		Role:          models.UserRoleUser,
		Enabled:       true,
		AvatarURL:     "https://example.com/old.png",
	}
	if err := db.Create(&user).Error; err != nil {
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

	response := perform(router, http.MethodPatch, "/api/user/profile", map[string]any{
		"nickname":   "  Fresh Name  ",
		"avatar_url": "https://example.com/new.png",
	}, sessionHeaders(login))
	if response.Code != http.StatusOK {
		t.Fatalf("patch profile = %d: %s", response.Code, response.Body.String())
	}
	if strings.Contains(response.Body.String(), "new.png") {
		t.Fatalf("profile response accepted submitted avatar_url: %s", response.Body.String())
	}
	assertNoUserPrivateFields(t, response.Body.String())
	var payload testEnvelope[struct {
		User UserDTO `json:"user"`
	}]
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Data.User.Nickname != "Fresh Name" {
		t.Fatalf("response nickname = %q, want %q", payload.Data.User.Nickname, "Fresh Name")
	}
	var reloaded models.User
	if err := db.First(&reloaded, user.ID).Error; err != nil {
		t.Fatal(err)
	}
	if reloaded.Nickname != "Fresh Name" {
		t.Fatalf("stored nickname = %q, want %q", reloaded.Nickname, "Fresh Name")
	}
	if reloaded.AvatarURL != "https://example.com/old.png" {
		t.Fatalf("stored avatar_url = %q, want old value unchanged", reloaded.AvatarURL)
	}
}

func TestUserResponsesUseSafeDTO(t *testing.T) {
	db := httpTestDB(t)
	createInstalledAdmin(t, db)
	hash, err := auth.HashSecret("password123")
	if err != nil {
		t.Fatal(err)
	}
	user := models.User{
		Email:         "safe-user@example.com",
		PasswordHash:  hash,
		Nickname:      "Safe User",
		EmailVerified: true,
		Role:          models.UserRoleUser,
		Enabled:       true,
		AvatarURL:     "https://example.com/private-avatar.png",
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	router := testRouter(t, db)
	login := perform(router, http.MethodPost, "/api/auth/login", map[string]any{
		"email":    "admin@example.com",
		"password": "password123",
	}, nil)
	if login.Code != http.StatusOK {
		t.Fatalf("admin login = %d: %s", login.Code, login.Body.String())
	}
	headers := sessionHeaders(login)

	list := perform(router, http.MethodGet, "/api/admin/users?page=1&page_size=10", nil, headers)
	if list.Code != http.StatusOK {
		t.Fatalf("list users = %d: %s", list.Code, list.Body.String())
	}
	assertNoUserPrivateFields(t, list.Body.String())
	var listPayload testEnvelope[paginatedResponse[UserDTO]]
	if err := json.Unmarshal(list.Body.Bytes(), &listPayload); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, item := range listPayload.Data.Items {
		if item.ID == user.ID {
			found = true
			if item.Email != user.Email || item.Nickname != user.Nickname {
				t.Fatalf("listed user dto = %+v, want email/nickname from user", item)
			}
		}
	}
	if !found {
		t.Fatalf("list users missing test user: %+v", listPayload.Data.Items)
	}

	patch := perform(router, http.MethodPatch, "/api/admin/users/"+uintPath(user.ID), map[string]any{
		"nickname": "Updated Safe User",
	}, headers)
	if patch.Code != http.StatusOK {
		t.Fatalf("patch user = %d: %s", patch.Code, patch.Body.String())
	}
	assertNoUserPrivateFields(t, patch.Body.String())
	var patchPayload testEnvelope[UserDTO]
	if err := json.Unmarshal(patch.Body.Bytes(), &patchPayload); err != nil {
		t.Fatal(err)
	}
	if patchPayload.Data.Nickname != "Updated Safe User" {
		t.Fatalf("patched nickname = %q, want updated", patchPayload.Data.Nickname)
	}
}

func assertNoUserPrivateFields(t *testing.T, body string) {
	t.Helper()
	for _, forbidden := range []string{
		"avatar_url",
		"private-avatar.png",
		"password_hash",
		"passwordHash",
	} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("user response exposed %q: %s", forbidden, body)
		}
	}
}

func TestPatchUserProfileRequiresLogin(t *testing.T) {
	db := httpTestDB(t)
	createInstalledAdmin(t, db)
	router := testRouter(t, db)

	response := perform(router, http.MethodPatch, "/api/user/profile", map[string]any{
		"nickname": "No Session",
	}, nil)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("patch profile = %d, want %d: %s", response.Code, http.StatusUnauthorized, response.Body.String())
	}
}

func TestPatchUserProfileRejectsInvalidNicknames(t *testing.T) {
	cases := []struct {
		name     string
		nickname string
	}{
		{name: "blank", nickname: "   "},
		{name: "too long", nickname: strings.Repeat("a", maxNicknameRunes+1)},
		{name: "control char", nickname: "bad\nname"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			db := httpTestDB(t)
			createInstalledAdmin(t, db)
			hash, err := auth.HashSecret("password123")
			if err != nil {
				t.Fatal(err)
			}
			user := models.User{
				Email:         "profile-invalid@example.com",
				PasswordHash:  hash,
				Nickname:      "Original",
				EmailVerified: true,
				Role:          models.UserRoleUser,
				Enabled:       true,
			}
			if err := db.Create(&user).Error; err != nil {
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

			response := perform(router, http.MethodPatch, "/api/user/profile", map[string]any{
				"nickname": tc.nickname,
			}, sessionHeaders(login))
			if response.Code != http.StatusBadRequest {
				t.Fatalf("patch profile = %d, want %d: %s", response.Code, http.StatusBadRequest, response.Body.String())
			}
			var reloaded models.User
			if err := db.First(&reloaded, user.ID).Error; err != nil {
				t.Fatal(err)
			}
			if reloaded.Nickname != "Original" {
				t.Fatalf("nickname changed to %q after invalid patch", reloaded.Nickname)
			}
		})
	}
}
