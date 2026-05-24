package httpapi

import (
	"net/http"
	"strings"
	"testing"

	"gptmail/internal/auth"
	"gptmail/internal/config"
	"gptmail/internal/models"

	"gorm.io/gorm"
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

func TestSessionCookieWritesRequireSameOriginWhenBrowserSendsOrigin(t *testing.T) {
	db := httpTestDB(t)
	owner := createShareTestUser(t, db, "csrf-owner@example.test")
	router := testRouterWithConfig(t, db, func(cfg *config.Config) {
		cfg.PublicBaseURL = "https://console.example.test/app"
	})
	login := loginShareTestUser(t, router, owner.Email)
	headers := cookieHeaders(login.Result().Cookies())

	crossSiteAnnouncement := createCSRFTestAnnouncement(t, db, owner.ID, "cross-site")
	headers["Origin"] = "https://evil.example.test"
	blocked := perform(router, http.MethodPatch, "/api/announcements/"+uintPath(crossSiteAnnouncement.ID)+"/read", nil, headers)
	if blocked.Code != http.StatusForbidden {
		t.Fatalf("cross-site session write = %d, want 403: %s", blocked.Code, blocked.Body.String())
	}
	var reads int64
	if err := db.Model(&models.AnnouncementRead{}).Where("announcement_id = ?", crossSiteAnnouncement.ID).Count(&reads).Error; err != nil {
		t.Fatal(err)
	}
	if reads != 0 {
		t.Fatalf("cross-site session write created %d announcement reads", reads)
	}

	samePublicBaseHeaders := cookieHeaders(login.Result().Cookies())
	samePublicBaseHeaders["Origin"] = "https://console.example.test"
	publicBaseAnnouncement := createCSRFTestAnnouncement(t, db, owner.ID, "public-base")
	allowed := perform(router, http.MethodPatch, "/api/announcements/"+uintPath(publicBaseAnnouncement.ID)+"/read", nil, samePublicBaseHeaders)
	if allowed.Code != http.StatusOK {
		t.Fatalf("same PublicBaseURL origin session write = %d: %s", allowed.Code, allowed.Body.String())
	}

	sameHostRefererHeaders := cookieHeaders(login.Result().Cookies())
	sameHostRefererHeaders["Referer"] = "http://example.com/settings"
	hostAnnouncement := createCSRFTestAnnouncement(t, db, owner.ID, "host-referer")
	hostAllowed := perform(router, http.MethodPatch, "/api/announcements/"+uintPath(hostAnnouncement.ID)+"/read", nil, sameHostRefererHeaders)
	if hostAllowed.Code != http.StatusOK {
		t.Fatalf("same Host referer session write = %d: %s", hostAllowed.Code, hostAllowed.Body.String())
	}

	schemeMismatchHeaders := cookieHeaders(login.Result().Cookies())
	schemeMismatchHeaders["Origin"] = "http://example.com"
	schemeMismatchHeaders["X-Forwarded-Proto"] = "https"
	schemeMismatchAnnouncement := createCSRFTestAnnouncement(t, db, owner.ID, "scheme-mismatch")
	schemeMismatchBlocked := perform(router, http.MethodPatch, "/api/announcements/"+uintPath(schemeMismatchAnnouncement.ID)+"/read", nil, schemeMismatchHeaders)
	if schemeMismatchBlocked.Code != http.StatusForbidden {
		t.Fatalf("scheme-mismatched same-host session write = %d, want 403: %s", schemeMismatchBlocked.Code, schemeMismatchBlocked.Body.String())
	}

	noBrowserOriginHeaders := cookieHeaders(login.Result().Cookies())
	noOriginAnnouncement := createCSRFTestAnnouncement(t, db, owner.ID, "no-origin")
	noOriginAllowed := perform(router, http.MethodPatch, "/api/announcements/"+uintPath(noOriginAnnouncement.ID)+"/read", nil, noBrowserOriginHeaders)
	if noOriginAllowed.Code != http.StatusOK {
		t.Fatalf("session write without browser origin = %d: %s", noOriginAllowed.Code, noOriginAllowed.Body.String())
	}
}

func TestAPIKeyWritesIgnoreBrowserOriginCSRFCheck(t *testing.T) {
	db := httpTestDB(t)
	owner := createShareTestUser(t, db, "csrf-api-key-owner@example.test")
	createShareTestDomain(t, db, "csrf-api-key.test", models.DomainModePrivate, &owner.ID)
	_, plain, err := (auth.APIKeyService{DB: db}).CreateFor(&owner.ID, "csrf-api-key", 20, 0, nil)
	if err != nil {
		t.Fatal(err)
	}
	router := testRouterWithConfig(t, db, func(cfg *config.Config) {
		cfg.PublicBaseURL = "https://console.example.test"
	})

	response := perform(router, http.MethodPost, "/api/generate-email", map[string]any{
		"prefix": "allowed",
		"domain": "csrf-api-key.test",
	}, map[string]string{
		"X-API-Key": plain,
		"Origin":    "https://evil.example.test",
	})
	if response.Code != http.StatusCreated {
		t.Fatalf("api key write with cross-site origin = %d: %s", response.Code, response.Body.String())
	}
}

func createCSRFTestAnnouncement(t *testing.T, db *gorm.DB, adminID uint, title string) models.Announcement {
	t.Helper()
	announcement := models.Announcement{
		Title:   title,
		Content: "csrf boundary test",
		AdminID: adminID,
	}
	if err := db.Create(&announcement).Error; err != nil {
		t.Fatal(err)
	}
	return announcement
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
