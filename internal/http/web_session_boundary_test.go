package httpapi

import (
	"net/http"
	"strings"
	"testing"

	"gptmail/internal/auth"
	"gptmail/internal/models"
)

func TestWebSessionOnlyRoutesRejectAPIKeyAndDoNotConsumeQuota(t *testing.T) {
	db := httpTestDB(t)
	owner := createShareTestUser(t, db, "web-session-owner@example.test")
	domain := models.Domain{
		Domain:     "web-session.test",
		Mode:       models.DomainModePrivate,
		OwnerID:    &owner.ID,
		Active:     true,
		MXVerified: true,
	}
	if err := db.Create(&domain).Error; err != nil {
		t.Fatal(err)
	}
	announcement := models.Announcement{
		Title:   "Session only",
		Content: "Only the web console should read this.",
		AdminID: owner.ID,
	}
	if err := db.Create(&announcement).Error; err != nil {
		t.Fatal(err)
	}
	key, plain, err := (auth.APIKeyService{DB: db}).CreateFor(&owner.ID, "web-session-key", 1, 0, nil)
	if err != nil {
		t.Fatal(err)
	}
	router := testRouter(t, db)

	for _, request := range []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/api/stats/timeseries?days=7"},
		{http.MethodGet, "/api/domains"},
		{http.MethodGet, "/api/domains/" + uintPath(domain.ID)},
		{http.MethodGet, "/api/announcements"},
		{http.MethodGet, "/api/announcements/unread-count"},
		{http.MethodPatch, "/api/announcements/" + uintPath(announcement.ID) + "/read"},
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
		t.Fatalf("web-session-only API key requests consumed quota: used_today=%d total_used=%d last_used_at=%v", refreshed.UsedToday, refreshed.TotalUsed, refreshed.LastUsedAt)
	}
	var usageLogs int64
	if err := db.Model(&models.APIUsageLog{}).Where("api_key_id = ?", key.ID).Count(&usageLogs).Error; err != nil {
		t.Fatal(err)
	}
	if usageLogs != 0 {
		t.Fatalf("web-session-only API key requests wrote %d APIUsageLog rows", usageLogs)
	}

	login := loginShareTestUser(t, router, owner.Email)
	headers := cookieHeaders(login.Result().Cookies())
	headers["X-API-Key"] = "definitely-wrong"
	for _, request := range []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/api/stats/timeseries?days=7"},
		{http.MethodGet, "/api/domains"},
		{http.MethodGet, "/api/domains/" + uintPath(domain.ID)},
		{http.MethodGet, "/api/announcements"},
		{http.MethodGet, "/api/announcements/unread-count"},
		{http.MethodPatch, "/api/announcements/" + uintPath(announcement.ID) + "/read"},
	} {
		response := perform(router, request.method, request.path, nil, headers)
		if response.Code != http.StatusOK {
			t.Fatalf("%s %s with session and bad API key = %d, want 200: %s", request.method, request.path, response.Code, response.Body.String())
		}
	}

	available := perform(router, http.MethodGet, "/api/domains/available", nil, map[string]string{"X-API-Key": plain})
	if available.Code != http.StatusOK {
		t.Fatalf("domains/available should remain API-key accessible, got %d: %s", available.Code, available.Body.String())
	}
}

func TestInvalidAPIKeyAttemptsArePreAuthRateLimited(t *testing.T) {
	db := httpTestDB(t)
	router := testRouter(t, db)

	var response *httptestResponse
	for i := 0; i < 21; i++ {
		recorder := perform(router, http.MethodGet, "/api/stats", nil, map[string]string{"X-API-Key": "not-a-real-key"})
		response = &httptestResponse{code: recorder.Code, body: recorder.Body.String()}
		if i < 20 && recorder.Code != http.StatusUnauthorized {
			t.Fatalf("invalid API key attempt %d = %d, want 401: %s", i+1, recorder.Code, recorder.Body.String())
		}
	}
	if response == nil || response.code != http.StatusTooManyRequests {
		t.Fatalf("expected the 21st invalid API key attempt to be 429, got %+v", response)
	}
	if !strings.Contains(response.body, "rate limit exceeded") {
		t.Fatalf("rate limited response did not stay generic: %s", response.body)
	}
}

func TestAPIKeyAttemptFingerprintDoesNotExposeSecret(t *testing.T) {
	secret := "key-hloolmail-this-is-a-test-secret"
	fingerprint := apiKeyAttemptFingerprint(secret)
	if fingerprint == "" || len(fingerprint) >= len(secret) {
		t.Fatalf("unexpected fingerprint length %q", fingerprint)
	}
	if strings.Contains(fingerprint, secret) || strings.Contains(secret, fingerprint) {
		t.Fatalf("fingerprint exposes raw secret: %q", fingerprint)
	}
}

type httptestResponse struct {
	code int
	body string
}
