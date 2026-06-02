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

func TestUserOnboardingRequiresNewUserAndCanComplete(t *testing.T) {
	db := httpTestDB(t)
	createInstalledAdmin(t, db)
	router := testRouter(t, db)

	adminLogin := perform(router, http.MethodPost, "/api/auth/login", map[string]any{
		"email":    "admin@example.com",
		"password": "password123",
	}, nil)
	if adminLogin.Code != http.StatusOK {
		t.Fatalf("admin login = %d: %s", adminLogin.Code, adminLogin.Body.String())
	}
	adminHeaders := sessionHeaders(adminLogin)
	settings := perform(router, http.MethodPatch, "/api/admin/quota-settings", map[string]any{
		"enable_user_onboarding":          true,
		"require_public_domain_for_quota": true,
	}, adminHeaders)
	if settings.Code != http.StatusOK {
		t.Fatalf("patch quota settings = %d: %s", settings.Code, settings.Body.String())
	}

	created := perform(router, http.MethodPost, "/api/admin/users", map[string]any{
		"email":       "onboarding@example.com",
		"nickname":    "Onboarding",
		"password":    "password123",
		"role":        models.UserRoleUser,
		"daily_limit": 1000,
		"total_limit": 0,
	}, adminHeaders)
	if created.Code != http.StatusCreated {
		t.Fatalf("create user = %d: %s", created.Code, created.Body.String())
	}
	var createdPayload testEnvelope[UserDTO]
	if err := json.Unmarshal(created.Body.Bytes(), &createdPayload); err != nil {
		t.Fatal(err)
	}
	if !createdPayload.Data.OnboardingRequired {
		t.Fatalf("new user onboarding_required = false, want true: %+v", createdPayload.Data)
	}

	userLogin := perform(router, http.MethodPost, "/api/auth/login", map[string]any{
		"email":    "onboarding@example.com",
		"password": "password123",
	}, nil)
	if userLogin.Code != http.StatusOK {
		t.Fatalf("user login = %d: %s", userLogin.Code, userLogin.Body.String())
	}
	userHeaders := sessionHeaders(userLogin)
	status := perform(router, http.MethodGet, "/api/user/onboarding", nil, userHeaders)
	if status.Code != http.StatusOK {
		t.Fatalf("get onboarding = %d: %s", status.Code, status.Body.String())
	}
	var statusPayload testEnvelope[userOnboardingStatus]
	if err := json.Unmarshal(status.Body.Bytes(), &statusPayload); err != nil {
		t.Fatal(err)
	}
	if !statusPayload.Data.Enabled || !statusPayload.Data.Required || !statusPayload.Data.RequirePublicDomainForQuota {
		t.Fatalf("onboarding status = %+v, want enabled required require-domain", statusPayload.Data)
	}
	if statusPayload.Data.CanComplete || statusPayload.Data.NextStep != "domain" || statusPayload.Data.HasReadyPublicDomain || statusPayload.Data.HasMailbox || statusPayload.Data.HasAPIKey {
		t.Fatalf("initial onboarding progress = %+v, want blocked at domain", statusPayload.Data)
	}

	blockedComplete := perform(router, http.MethodPatch, "/api/user/onboarding", map[string]any{
		"completed": true,
	}, userHeaders)
	if blockedComplete.Code != http.StatusBadRequest {
		t.Fatalf("complete unfinished onboarding = %d, want %d: %s", blockedComplete.Code, http.StatusBadRequest, blockedComplete.Body.String())
	}

	ownerID := createdPayload.Data.ID
	domain := models.Domain{
		Domain:     "onboarding-public.test",
		Mode:       models.DomainModePublic,
		OwnerID:    &ownerID,
		Active:     true,
		MXVerified: true,
	}
	if err := db.Create(&domain).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&models.Mailbox{
		OwnerID:   ownerID,
		Email:     "first@onboarding-public.test",
		LocalPart: "first",
		Host:      "onboarding-public.test",
		DomainID:  domain.ID,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if _, _, err := (auth.APIKeyService{DB: db}).CreateFor(&ownerID, "onboarding-key", 20, 0, nil); err != nil {
		t.Fatal(err)
	}
	readyStatus := perform(router, http.MethodGet, "/api/user/onboarding", nil, userHeaders)
	if readyStatus.Code != http.StatusOK {
		t.Fatalf("get ready onboarding = %d: %s", readyStatus.Code, readyStatus.Body.String())
	}
	var readyPayload testEnvelope[userOnboardingStatus]
	if err := json.Unmarshal(readyStatus.Body.Bytes(), &readyPayload); err != nil {
		t.Fatal(err)
	}
	if !readyPayload.Data.CanComplete || readyPayload.Data.NextStep != "api-docs" || !readyPayload.Data.HasReadyPublicDomain || !readyPayload.Data.HasMailbox || !readyPayload.Data.HasAPIKey {
		t.Fatalf("ready onboarding progress = %+v, want completable api-docs", readyPayload.Data)
	}

	completed := perform(router, http.MethodPatch, "/api/user/onboarding", map[string]any{
		"completed": true,
	}, userHeaders)
	if completed.Code != http.StatusOK {
		t.Fatalf("complete onboarding = %d: %s", completed.Code, completed.Body.String())
	}
	var completedPayload testEnvelope[userOnboardingStatus]
	if err := json.Unmarshal(completed.Body.Bytes(), &completedPayload); err != nil {
		t.Fatal(err)
	}
	if !completedPayload.Data.Completed || completedPayload.Data.Required {
		t.Fatalf("completed onboarding status = %+v, want completed and not required", completedPayload.Data)
	}

	var reloaded models.User
	if err := db.First(&reloaded, createdPayload.Data.ID).Error; err != nil {
		t.Fatal(err)
	}
	if reloaded.OnboardingRequired || reloaded.OnboardingCompletedAt == nil || reloaded.OnboardingSkippedAt != nil {
		t.Fatalf("stored onboarding fields = required:%t completed:%v skipped:%v", reloaded.OnboardingRequired, reloaded.OnboardingCompletedAt, reloaded.OnboardingSkippedAt)
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
