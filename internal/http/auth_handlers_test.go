package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"

	"gptmail/internal/auth"
	appdb "gptmail/internal/db"
	"gptmail/internal/mailer"
	"gptmail/internal/models"

	"gorm.io/gorm"
)

func TestRegisterClosedReturnsForbidden(t *testing.T) {
	database := httpTestDB(t)
	createInstalledAdmin(t, database)
	router := testRouterWithMailer(t, database, &capturingMailer{})

	response := perform(router, http.MethodPost, "/api/auth/register", map[string]any{
		"email":    "closed@example.com",
		"password": "password123",
	}, nil)
	if response.Code != http.StatusForbidden {
		t.Fatalf("register = %d, want %d: %s", response.Code, http.StatusForbidden, response.Body.String())
	}
}

func TestPublicLoginSettingsExposeRegistrationFlagsOnly(t *testing.T) {
	database := httpTestDB(t)
	createInstalledAdmin(t, database)
	settings, err := appdb.EnsureLoginSettings(database)
	if err != nil {
		t.Fatal(err)
	}
	settings.RegistrationOpen = true
	settings.EmailRegistrationEnabled = true
	settings.EmailVerificationMode = models.EmailVerificationModeSMTP
	settings.SMTPHost = "smtp.example.com"
	settings.SMTPPassword = "super-secret-password"
	settings.SMTPFromEmail = "no-reply@example.com"
	if err := database.Save(settings).Error; err != nil {
		t.Fatal(err)
	}
	router := testRouterWithMailer(t, database, &capturingMailer{})

	response := perform(router, http.MethodGet, "/api/auth/login-settings", nil, nil)
	if response.Code != http.StatusOK {
		t.Fatalf("login settings = %d: %s", response.Code, response.Body.String())
	}
	var payload testEnvelope[map[string]any]
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Data["registration_open"] != true || payload.Data["email_registration_enabled"] != true {
		t.Fatalf("registration flags missing from public settings: %s", response.Body.String())
	}
	if _, ok := payload.Data["smtp_password"]; ok {
		t.Fatalf("public settings exposed smtp_password: %s", response.Body.String())
	}
	if strings.Contains(response.Body.String(), "super-secret-password") {
		t.Fatalf("public settings leaked smtp password: %s", response.Body.String())
	}
}

func TestRegisterCreatesPendingWithoutUserOrSession(t *testing.T) {
	database := httpTestDB(t)
	createInstalledAdmin(t, database)
	enableEmailRegistration(t, database)
	sender := &capturingMailer{}
	router := testRouterWithMailer(t, database, sender)

	response := registerForVerification(t, router, "new-user@example.com", "password123")
	if response.VerificationID == "" {
		t.Fatal("verification_id is empty")
	}
	if !response.ExpiresAt.After(time.Now()) {
		t.Fatalf("expires_at = %s, want future", response.ExpiresAt)
	}
	if len(sender.messages) != 1 {
		t.Fatalf("sent messages = %d, want 1", len(sender.messages))
	}
	var userCount int64
	if err := database.Model(&models.User{}).Where("email = ?", "new-user@example.com").Count(&userCount).Error; err != nil {
		t.Fatal(err)
	}
	if userCount != 0 {
		t.Fatalf("user count = %d, want 0", userCount)
	}
	var pending models.PendingRegistration
	if err := database.First(&pending, "verification_id = ?", response.VerificationID).Error; err != nil {
		t.Fatal(err)
	}
	if pending.Email != "new-user@example.com" || pending.CodeHash == "" || pending.PasswordHash == "" {
		t.Fatalf("pending registration not populated safely: %+v", pending)
	}
}

func TestRegisterWithTurnstileStillRequiresEmailVerification(t *testing.T) {
	database := httpTestDB(t)
	createInstalledAdmin(t, database)
	enableEmailRegistration(t, database)
	settings, err := appdb.EnsureLoginSettings(database)
	if err != nil {
		t.Fatal(err)
	}
	settings.TurnstileEnabled = true
	settings.TurnstileSiteKey = "site-key"
	settings.TurnstileSecretKey = "secret-key"
	if err := database.Save(settings).Error; err != nil {
		t.Fatal(err)
	}
	originalClient := oauthHTTPClient
	oauthHTTPClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     make(http.Header),
			Body:       io.NopCloser(strings.NewReader(`{"success":true}`)),
			Request:    req,
		}, nil
	})}
	defer func() { oauthHTTPClient = originalClient }()

	sender := &capturingMailer{}
	router := testRouterWithMailer(t, database, sender)
	response := perform(router, http.MethodPost, "/api/auth/register", map[string]any{
		"email":           "turnstile@example.com",
		"password":        "password123",
		"turnstile_token": "valid-turnstile-token",
	}, nil)
	if response.Code != http.StatusOK {
		t.Fatalf("register = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
	}
	if hasSessionCookie(response.Result().Cookies()) {
		t.Fatal("turnstile registration unexpectedly set a session cookie")
	}
	var payload testEnvelope[registrationResponse]
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if !payload.Data.EmailVerificationRequired || payload.Data.VerificationID == "" {
		t.Fatalf("turnstile registration should require email verification: %s", response.Body.String())
	}
	if len(sender.messages) != 1 {
		t.Fatalf("turnstile registration sent email verification messages = %d, want 1", len(sender.messages))
	}
	var userCount int64
	if err := database.Model(&models.User{}).Where("email = ?", "turnstile@example.com").Count(&userCount).Error; err != nil {
		t.Fatal(err)
	}
	if userCount != 0 {
		t.Fatalf("user count = %d, want 0", userCount)
	}
}

func TestLoginRejectsUnverifiedUserWhenTurnstileEnabled(t *testing.T) {
	database := httpTestDB(t)
	createInstalledAdmin(t, database)
	settings, err := appdb.EnsureLoginSettings(database)
	if err != nil {
		t.Fatal(err)
	}
	settings.TurnstileEnabled = true
	settings.TurnstileSiteKey = "site-key"
	settings.TurnstileSecretKey = "secret-key"
	if err := database.Save(settings).Error; err != nil {
		t.Fatal(err)
	}
	router := testRouterWithMailer(t, database, &capturingMailer{})
	hash, err := auth.HashSecret("password123")
	if err != nil {
		t.Fatal(err)
	}
	if err := database.Create(&models.User{
		Email:         "unverified@example.com",
		PasswordHash:  hash,
		EmailVerified: false,
		Role:          models.UserRoleUser,
		Enabled:       true,
	}).Error; err != nil {
		t.Fatal(err)
	}
	originalClient := oauthHTTPClient
	oauthHTTPClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     make(http.Header),
			Body:       io.NopCloser(strings.NewReader(`{"success":true}`)),
			Request:    req,
		}, nil
	})}
	defer func() { oauthHTTPClient = originalClient }()
	login := perform(router, http.MethodPost, "/api/auth/login", map[string]any{
		"email":           "unverified@example.com",
		"password":        "password123",
		"turnstile_token": "valid-turnstile-token",
	}, nil)
	if login.Code != http.StatusForbidden {
		t.Fatalf("login = %d, want %d: %s", login.Code, http.StatusForbidden, login.Body.String())
	}
}

func TestRegisterWithoutTurnstileRejectsMissingCaptcha(t *testing.T) {
	database := httpTestDB(t)
	createInstalledAdmin(t, database)
	enableEmailRegistration(t, database)
	sender := &capturingMailer{}
	router := testRouterWithMailer(t, database, sender)

	response := perform(router, http.MethodPost, "/api/auth/register", map[string]any{
		"email":    "missing-captcha@example.com",
		"password": "password123",
	}, nil)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("register = %d, want %d: %s", response.Code, http.StatusBadRequest, response.Body.String())
	}
	if len(sender.messages) != 0 {
		t.Fatalf("sent messages = %d, want 0", len(sender.messages))
	}
}

func TestRegisterWithoutTurnstileRejectsWrongCaptchaAndIncrementsAttempts(t *testing.T) {
	database := httpTestDB(t)
	createInstalledAdmin(t, database)
	enableEmailRegistration(t, database)
	sender := &capturingMailer{}
	router := testRouterWithMailer(t, database, sender)
	captcha := requestRegistrationCaptcha(t, router)

	wrongAnswer := solveCaptchaChallenge(t, captcha.Challenge) + 1
	response := perform(router, http.MethodPost, "/api/auth/register", map[string]any{
		"email":          "wrong-captcha@example.com",
		"password":       "password123",
		"captcha_id":     captcha.CaptchaID,
		"captcha_answer": fmt.Sprintf("%d", wrongAnswer),
	}, nil)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("register = %d, want %d: %s", response.Code, http.StatusBadRequest, response.Body.String())
	}
	var stored models.RegistrationCaptcha
	if err := database.First(&stored, "captcha_id = ?", captcha.CaptchaID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.AttemptCount != 1 {
		t.Fatalf("attempt_count = %d, want 1", stored.AttemptCount)
	}
	if len(sender.messages) != 0 {
		t.Fatalf("sent messages = %d, want 0", len(sender.messages))
	}
}

func TestRegisterWithoutTurnstileAcceptsCorrectCaptchaAndCreatesPending(t *testing.T) {
	database := httpTestDB(t)
	createInstalledAdmin(t, database)
	enableEmailRegistration(t, database)
	sender := &capturingMailer{}
	router := testRouterWithMailer(t, database, sender)

	response := registerForVerification(t, router, "correct-captcha@example.com", "password123")
	if response.VerificationID == "" {
		t.Fatal("verification_id is empty")
	}
	var captchaCount int64
	if err := database.Model(&models.RegistrationCaptcha{}).Count(&captchaCount).Error; err != nil {
		t.Fatal(err)
	}
	if captchaCount != 0 {
		t.Fatalf("captcha count = %d, want 0", captchaCount)
	}
	if len(sender.messages) != 1 {
		t.Fatalf("sent messages = %d, want 1", len(sender.messages))
	}
}

func TestRegisterDuplicateEmailWithinCooldownDoesNotResend(t *testing.T) {
	database := httpTestDB(t)
	createInstalledAdmin(t, database)
	enableEmailRegistration(t, database)
	sender := &capturingMailer{}
	router := testRouterWithMailer(t, database, sender)

	registered := registerForVerification(t, router, "cooldown@example.com", "password123")
	response := submitRegistrationWithCaptcha(t, router, "cooldown@example.com", "password123")
	if response.Code != http.StatusTooManyRequests {
		t.Fatalf("duplicate register = %d, want %d: %s", response.Code, http.StatusTooManyRequests, response.Body.String())
	}
	if len(sender.messages) != 1 {
		t.Fatalf("sent messages = %d, want 1", len(sender.messages))
	}
	var pending models.PendingRegistration
	if err := database.First(&pending, "verification_id = ?", registered.VerificationID).Error; err != nil {
		t.Fatal(err)
	}
	if pending.SentCount != 1 {
		t.Fatalf("sent_count = %d, want 1", pending.SentCount)
	}
}

func TestRegisterDuplicateEmailAfterCooldownResends(t *testing.T) {
	database := httpTestDB(t)
	createInstalledAdmin(t, database)
	enableEmailRegistration(t, database)
	sender := &capturingMailer{}
	router := testRouterWithMailer(t, database, sender)

	first := registerForVerification(t, router, "resend@example.com", "password123")
	oldSentAt := time.Now().Add(-registrationVerificationCooldown - time.Second)
	if err := database.Model(&models.PendingRegistration{}).
		Where("verification_id = ?", first.VerificationID).
		Update("last_sent_at", oldSentAt).Error; err != nil {
		t.Fatal(err)
	}
	response := submitRegistrationWithCaptcha(t, router, "resend@example.com", "password456")
	if response.Code != http.StatusOK {
		t.Fatalf("register after cooldown = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
	}
	if len(sender.messages) != 2 {
		t.Fatalf("sent messages = %d, want 2", len(sender.messages))
	}
	var payload testEnvelope[registrationResponse]
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Data.VerificationID == "" || payload.Data.VerificationID == first.VerificationID {
		t.Fatalf("unexpected resend verification id: %+v", payload.Data)
	}
	var pending models.PendingRegistration
	if err := database.First(&pending, "verification_id = ?", payload.Data.VerificationID).Error; err != nil {
		t.Fatal(err)
	}
	if pending.SentCount != 2 {
		t.Fatalf("sent_count = %d, want 2", pending.SentCount)
	}
}

func TestRegisterDuplicateEmailSendLimit(t *testing.T) {
	database := httpTestDB(t)
	createInstalledAdmin(t, database)
	enableEmailRegistration(t, database)
	sender := &capturingMailer{}
	router := testRouterWithMailer(t, database, sender)

	registered := registerForVerification(t, router, "send-limit@example.com", "password123")
	if err := database.Model(&models.PendingRegistration{}).
		Where("verification_id = ?", registered.VerificationID).
		Updates(map[string]any{
			"last_sent_at": time.Now().Add(-registrationVerificationCooldown - time.Second),
			"sent_count":   maxRegistrationVerificationSends,
		}).Error; err != nil {
		t.Fatal(err)
	}
	response := submitRegistrationWithCaptcha(t, router, "send-limit@example.com", "password456")
	if response.Code != http.StatusTooManyRequests {
		t.Fatalf("register over send limit = %d, want %d: %s", response.Code, http.StatusTooManyRequests, response.Body.String())
	}
	if len(sender.messages) != 1 {
		t.Fatalf("sent messages = %d, want 1", len(sender.messages))
	}
}

func TestRegisterVerifyWrongCodeFails(t *testing.T) {
	database := httpTestDB(t)
	createInstalledAdmin(t, database)
	enableEmailRegistration(t, database)
	sender := &capturingMailer{}
	router := testRouterWithMailer(t, database, sender)

	registered := registerForVerification(t, router, "wrong-code@example.com", "password123")
	wrongCode := "000000"
	if sender.lastCode(t) == wrongCode {
		wrongCode = "111111"
	}
	verify := perform(router, http.MethodPost, "/api/auth/register/verify", map[string]any{
		"verification_id": registered.VerificationID,
		"code":            wrongCode,
	}, nil)
	if verify.Code != http.StatusBadRequest {
		t.Fatalf("verify = %d, want %d: %s", verify.Code, http.StatusBadRequest, verify.Body.String())
	}
	var userCount int64
	if err := database.Model(&models.User{}).Where("email = ?", "wrong-code@example.com").Count(&userCount).Error; err != nil {
		t.Fatal(err)
	}
	if userCount != 0 {
		t.Fatalf("user count = %d, want 0", userCount)
	}
	var pending models.PendingRegistration
	if err := database.First(&pending, "verification_id = ?", registered.VerificationID).Error; err != nil {
		t.Fatal(err)
	}
	if pending.AttemptCount != 1 {
		t.Fatalf("attempt_count = %d, want 1", pending.AttemptCount)
	}
}

func TestRegisterVerifyRejectsAfterMaxAttempts(t *testing.T) {
	database := httpTestDB(t)
	createInstalledAdmin(t, database)
	enableEmailRegistration(t, database)
	sender := &capturingMailer{}
	router := testRouterWithMailer(t, database, sender)

	registered := registerForVerification(t, router, "attempt-limit@example.com", "password123")
	wrongCode := wrongVerificationCode(t, sender)
	for i := 0; i < maxRegistrationVerificationAttempts; i++ {
		verify := perform(router, http.MethodPost, "/api/auth/register/verify", map[string]any{
			"verification_id": registered.VerificationID,
			"code":            wrongCode,
		}, nil)
		if verify.Code != http.StatusBadRequest {
			t.Fatalf("verify attempt %d = %d, want %d: %s", i+1, verify.Code, http.StatusBadRequest, verify.Body.String())
		}
	}
	verify := perform(router, http.MethodPost, "/api/auth/register/verify", map[string]any{
		"verification_id": registered.VerificationID,
		"code":            wrongCode,
	}, nil)
	if verify.Code != http.StatusTooManyRequests {
		t.Fatalf("verify over limit = %d, want %d: %s", verify.Code, http.StatusTooManyRequests, verify.Body.String())
	}
	var pending models.PendingRegistration
	if err := database.First(&pending, "verification_id = ?", registered.VerificationID).Error; err != nil {
		t.Fatal(err)
	}
	if pending.AttemptCount != maxRegistrationVerificationAttempts {
		t.Fatalf("attempt_count = %d, want %d", pending.AttemptCount, maxRegistrationVerificationAttempts)
	}
	var userCount int64
	if err := database.Model(&models.User{}).Where("email = ?", "attempt-limit@example.com").Count(&userCount).Error; err != nil {
		t.Fatal(err)
	}
	if userCount != 0 {
		t.Fatalf("user count = %d, want 0", userCount)
	}
}

func TestRegisterVerifyCorrectCodeCreatesVerifiedUserAndSession(t *testing.T) {
	database := httpTestDB(t)
	createInstalledAdmin(t, database)
	enableEmailRegistration(t, database)
	sender := &capturingMailer{}
	router := testRouterWithMailer(t, database, sender)

	registered := registerForVerification(t, router, "verified@example.com", "password123")
	verify := perform(router, http.MethodPost, "/api/auth/register/verify", map[string]any{
		"verification_id": registered.VerificationID,
		"code":            sender.lastCode(t),
	}, nil)
	if verify.Code != http.StatusOK {
		t.Fatalf("verify = %d, want %d: %s", verify.Code, http.StatusOK, verify.Body.String())
	}
	if !hasSessionCookie(verify.Result().Cookies()) {
		t.Fatal("verify did not set a session cookie")
	}
	var user models.User
	if err := database.First(&user, "email = ?", "verified@example.com").Error; err != nil {
		t.Fatal(err)
	}
	if !user.EmailVerified || !user.Enabled {
		t.Fatalf("user verification/enabled flags = verified:%t enabled:%t", user.EmailVerified, user.Enabled)
	}
	var pendingCount int64
	if err := database.Model(&models.PendingRegistration{}).Where("email = ?", "verified@example.com").Count(&pendingCount).Error; err != nil {
		t.Fatal(err)
	}
	if pendingCount != 0 {
		t.Fatalf("pending count = %d, want 0", pendingCount)
	}
}

func TestLegacyUnverifiedRegisterVerifyOverwritesPassword(t *testing.T) {
	database := httpTestDB(t)
	createInstalledAdmin(t, database)
	enableEmailRegistration(t, database)
	sender := &capturingMailer{}
	router := testRouterWithMailer(t, database, sender)

	oldHash, err := auth.HashSecret("old-password")
	if err != nil {
		t.Fatal(err)
	}
	legacy := models.User{
		Email:         "legacy@example.com",
		PasswordHash:  oldHash,
		EmailVerified: false,
		Role:          models.UserRoleUser,
		Enabled:       true,
		DailyLimit:    1000,
	}
	if err := database.Create(&legacy).Error; err != nil {
		t.Fatal(err)
	}

	registered := registerForVerification(t, router, "legacy@example.com", "new-password")
	verify := perform(router, http.MethodPost, "/api/auth/register/verify", map[string]any{
		"verification_id": registered.VerificationID,
		"code":            sender.lastCode(t),
	}, nil)
	if verify.Code != http.StatusOK {
		t.Fatalf("verify = %d, want %d: %s", verify.Code, http.StatusOK, verify.Body.String())
	}
	var user models.User
	if err := database.First(&user, "email = ?", "legacy@example.com").Error; err != nil {
		t.Fatal(err)
	}
	if !user.EmailVerified {
		t.Fatal("legacy user was not marked verified")
	}
	if auth.VerifySecret(user.PasswordHash, "old-password") {
		t.Fatal("legacy password still works after verification")
	}
	if !auth.VerifySecret(user.PasswordHash, "new-password") {
		t.Fatal("new registration password was not stored")
	}
}

type registrationResponse struct {
	EmailVerificationRequired bool      `json:"email_verification_required"`
	VerificationID            string    `json:"verification_id"`
	ExpiresAt                 time.Time `json:"expires_at"`
}

type captchaResponse struct {
	CaptchaID string    `json:"captcha_id"`
	Challenge string    `json:"challenge"`
	ExpiresAt time.Time `json:"expires_at"`
}

type testEnvelope[T any] struct {
	Success bool `json:"success"`
	Data    T    `json:"data"`
	Error   any  `json:"error"`
}

type capturingMailer struct {
	settings []mailer.Settings
	messages []mailer.Message
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func (m *capturingMailer) Send(_ context.Context, settings mailer.Settings, message mailer.Message) error {
	m.settings = append(m.settings, settings)
	m.messages = append(m.messages, message)
	return nil
}

func (m *capturingMailer) lastCode(t *testing.T) string {
	t.Helper()
	if len(m.messages) == 0 {
		t.Fatal("no email was sent")
	}
	code := regexp.MustCompile(`\b\d{6}\b`).FindString(m.messages[len(m.messages)-1].Text)
	if code == "" {
		t.Fatalf("verification code not found in email text: %q", m.messages[len(m.messages)-1].Text)
	}
	return code
}

func createInstalledAdmin(t *testing.T, database *gorm.DB) {
	t.Helper()
	hash, err := auth.HashSecret("password123")
	if err != nil {
		t.Fatal(err)
	}
	admin := models.User{
		Email:         "admin@example.com",
		PasswordHash:  hash,
		EmailVerified: true,
		Role:          models.UserRoleAdmin,
		Enabled:       true,
	}
	if err := database.Create(&admin).Error; err != nil {
		t.Fatal(err)
	}
}

func enableEmailRegistration(t *testing.T, database *gorm.DB) {
	t.Helper()
	settings, err := appdb.EnsureLoginSettings(database)
	if err != nil {
		t.Fatal(err)
	}
	settings.RegistrationOpen = true
	settings.EmailRegistrationEnabled = true
	settings.EmailVerificationMode = models.EmailVerificationModeInternal
	settings.InternalSenderPrefix = "no-reply"
	if err := database.Save(settings).Error; err != nil {
		t.Fatal(err)
	}
}

func registerForVerification(t *testing.T, router http.Handler, email, password string) registrationResponse {
	t.Helper()
	response := submitRegistrationWithCaptcha(t, router, email, password)
	if response.Code != http.StatusOK {
		t.Fatalf("register = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
	}
	if hasSessionCookie(response.Result().Cookies()) {
		t.Fatal("register unexpectedly set a session cookie")
	}
	var payload testEnvelope[registrationResponse]
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if !payload.Success || !payload.Data.EmailVerificationRequired {
		t.Fatalf("unexpected register payload: %+v", payload)
	}
	return payload.Data
}

func submitRegistrationWithCaptcha(t *testing.T, router http.Handler, email, password string) *httptest.ResponseRecorder {
	t.Helper()
	captcha := requestRegistrationCaptcha(t, router)
	return perform(router, http.MethodPost, "/api/auth/register", map[string]any{
		"email":          email,
		"password":       password,
		"captcha_id":     captcha.CaptchaID,
		"captcha_answer": fmt.Sprintf("%d", solveCaptchaChallenge(t, captcha.Challenge)),
	}, nil)
}

func requestRegistrationCaptcha(t *testing.T, router http.Handler) captchaResponse {
	t.Helper()
	response := perform(router, http.MethodPost, "/api/auth/register/captcha", nil, nil)
	if response.Code != http.StatusOK {
		t.Fatalf("captcha = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
	}
	var payload testEnvelope[captchaResponse]
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Data.CaptchaID == "" || payload.Data.Challenge == "" || !payload.Data.ExpiresAt.After(time.Now()) {
		t.Fatalf("unexpected captcha payload: %+v", payload)
	}
	return payload.Data
}

func solveCaptchaChallenge(t *testing.T, challenge string) int {
	t.Helper()
	var left, right int
	if _, err := fmt.Sscanf(challenge, "%d + %d = ?", &left, &right); err != nil {
		t.Fatalf("cannot solve captcha challenge %q: %v", challenge, err)
	}
	return left + right
}

func wrongVerificationCode(t *testing.T, sender *capturingMailer) string {
	t.Helper()
	wrongCode := "000000"
	if sender.lastCode(t) == wrongCode {
		wrongCode = "111111"
	}
	return wrongCode
}

func hasSessionCookie(cookies []*http.Cookie) bool {
	for _, cookie := range cookies {
		if cookie.Name == sessionCookieName && cookie.Value != "" {
			return true
		}
	}
	return false
}
