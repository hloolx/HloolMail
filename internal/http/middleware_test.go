package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"gptmail/internal/config"
	"gptmail/internal/ratelimit"

	"github.com/gin-gonic/gin"
)

func TestEnsureRateLimiterConcurrentInitializesOnce(t *testing.T) {
	var h Handler

	const workers = 64
	start := make(chan struct{})
	results := make(chan *ratelimit.Limiter, workers)

	var wg sync.WaitGroup
	wg.Add(workers)
	for i := 0; i < workers; i++ {
		go func() {
			defer wg.Done()
			<-start
			results <- h.ensureRateLimiter()
		}()
	}

	close(start)
	wg.Wait()
	close(results)

	limiter := h.RateLimiter
	if limiter == nil {
		t.Fatal("expected rate limiter to be initialized")
	}
	for result := range results {
		if result != limiter {
			t.Fatal("expected all callers to receive the same rate limiter")
		}
	}
}

func TestRequestIDMiddlewareSetsResponseHeader(t *testing.T) {
	gin.SetMode(gin.ReleaseMode)
	handler := &Handler{}
	router := gin.New()
	router.Use(handler.requestID())
	router.GET("/", func(c *gin.Context) {
		c.String(http.StatusOK, requestID(c))
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.Header.Set(requestIDHeader, "edge-request-id")
	router.ServeHTTP(recorder, request)

	if got := recorder.Header().Get(requestIDHeader); got != "edge-request-id" {
		t.Fatalf("response request id = %q, want edge-request-id", got)
	}
	if got := recorder.Body.String(); got != "edge-request-id" {
		t.Fatalf("context request id = %q, want edge-request-id", got)
	}

	recorder = httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/", nil))
	if got := recorder.Header().Get(requestIDHeader); got == "" {
		t.Fatal("expected generated response request id")
	}
}

func TestMetricsRouteRequiresEnable(t *testing.T) {
	disabled := NewRouter(&Handler{Config: config.Config{FrontendDist: t.TempDir()}})
	if routeRegistered(disabled, http.MethodGet, "/metrics") {
		t.Fatal("metrics route should be disabled by default")
	}

	enabled := NewRouter(&Handler{Config: config.Config{FrontendDist: t.TempDir(), MetricsEnabled: true}})
	if !routeRegistered(enabled, http.MethodGet, "/metrics") {
		t.Fatal("metrics route should be registered when enabled")
	}
}

func routeRegistered(router *gin.Engine, method, path string) bool {
	for _, route := range router.Routes() {
		if route.Method == method && route.Path == path {
			return true
		}
	}
	return false
}

func TestSecurityHeadersAllowTurnstile(t *testing.T) {
	gin.SetMode(gin.ReleaseMode)
	handler := &Handler{}
	router := gin.New()
	router.Use(handler.securityHeaders())
	router.GET("/", func(c *gin.Context) {
		c.String(http.StatusOK, "ok")
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	router.ServeHTTP(recorder, request)

	csp := recorder.Header().Get("Content-Security-Policy")
	if !strings.Contains(csp, "script-src 'self' https://challenges.cloudflare.com") {
		t.Fatalf("CSP does not allow Turnstile scripts: %q", csp)
	}
	if !strings.Contains(csp, "frame-src 'self' https://challenges.cloudflare.com") {
		t.Fatalf("CSP does not allow Turnstile frames: %q", csp)
	}
	if !strings.Contains(csp, "img-src 'self' https: data: blob:") {
		t.Fatalf("CSP does not allow HTTPS avatar images: %q", csp)
	}
	if !strings.Contains(csp, "connect-src 'self'") {
		t.Fatalf("CSP does not allow pre-clearance same-origin fetches: %q", csp)
	}
}

func TestLegacyAdminTokenRequiresExplicitEnable(t *testing.T) {
	gin.SetMode(gin.ReleaseMode)

	for _, tc := range []struct {
		name string
		cfg  config.Config
		want int
	}{
		{
			name: "disabled by default even when token is set",
			cfg:  config.Config{AdminToken: "test-admin-token"},
			want: http.StatusForbidden,
		},
		{
			name: "enabled by explicit legacy flag",
			cfg:  config.Config{AdminToken: "test-admin-token", AllowLegacyAdminToken: true},
			want: http.StatusOK,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			handler := &Handler{Config: tc.cfg}
			router := gin.New()
			router.GET("/admin-only", func(c *gin.Context) {
				if !handler.requireAdmin(c) {
					return
				}
				ok(c, gin.H{"admin": true})
			})

			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodGet, "/admin-only", nil)
			request.Header.Set("X-Admin-Token", "test-admin-token")
			router.ServeHTTP(recorder, request)

			if recorder.Code != tc.want {
				t.Fatalf("admin token response = %d, want %d: %s", recorder.Code, tc.want, recorder.Body.String())
			}
		})
	}
}

func TestCORSDoesNotAllowAdminTokenHeaderByDefault(t *testing.T) {
	gin.SetMode(gin.ReleaseMode)

	for _, tc := range []struct {
		name       string
		cfg        config.Config
		wantHeader bool
	}{
		{
			name:       "legacy token disabled",
			cfg:        config.Config{AllowedOrigin: "https://app.example", AdminToken: "test-admin-token"},
			wantHeader: false,
		},
		{
			name:       "legacy token explicitly enabled",
			cfg:        config.Config{AllowedOrigin: "https://app.example", AdminToken: "test-admin-token", AllowLegacyAdminToken: true},
			wantHeader: true,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			handler := &Handler{Config: tc.cfg}
			router := gin.New()
			router.Use(handler.cors())
			router.GET("/", func(c *gin.Context) {
				c.String(http.StatusOK, "ok")
			})

			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodOptions, "/", nil)
			request.Header.Set("Origin", "https://app.example")
			router.ServeHTTP(recorder, request)

			if recorder.Code != http.StatusNoContent {
				t.Fatalf("preflight status = %d, want %d", recorder.Code, http.StatusNoContent)
			}
			headers := recorder.Header().Get("Access-Control-Allow-Headers")
			if !strings.Contains(headers, "X-API-Key") {
				t.Fatalf("allowed headers missing X-API-Key: %q", headers)
			}
			hasAdminTokenHeader := strings.Contains(headers, "X-Admin-Token")
			if hasAdminTokenHeader != tc.wantHeader {
				t.Fatalf("X-Admin-Token allowed = %t, want %t in %q", hasAdminTokenHeader, tc.wantHeader, headers)
			}
		})
	}
}

func TestSecurityHeadersNoIndexSensitivePaths(t *testing.T) {
	gin.SetMode(gin.ReleaseMode)
	handler := &Handler{}
	router := gin.New()
	router.Use(handler.securityHeaders())
	router.NoRoute(func(c *gin.Context) {
		c.String(http.StatusOK, "ok")
	})

	for _, target := range []string{
		"/login",
		"/register",
		"/dashboard",
		"/share/share-hloolmail-example",
		"/api/shared/share-hloolmail-example?key=sharekey-hloolmail-example",
		"/api/auth/login",
		"/api/generate-email",
		"/api/docs.md",
		"/api/health",
		"/api/version",
		"/?api_key=secret",
	} {
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, target, nil))
		if got := recorder.Header().Get("X-Robots-Tag"); got != noIndexRobotsTag {
			t.Fatalf("%s X-Robots-Tag = %q, want %q", target, got, noIndexRobotsTag)
		}
	}
}

func TestSecurityHeadersKeepPublicIndexingPaths(t *testing.T) {
	gin.SetMode(gin.ReleaseMode)
	handler := &Handler{}
	router := gin.New()
	router.Use(handler.securityHeaders())
	router.NoRoute(func(c *gin.Context) {
		c.String(http.StatusOK, "ok")
	})

	for _, target := range []string{
		"/",
		"/robots.txt",
		"/sitemap.xml",
		"/assets/app.js",
		"/favicon.ico",
		"/brand-logo.svg",
	} {
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, target, nil))
		if got := recorder.Header().Get("X-Robots-Tag"); got != "" {
			t.Fatalf("%s X-Robots-Tag = %q, want empty", target, got)
		}
	}
}

func TestSecurityHeadersPublicIndexingNoneNoIndexesContent(t *testing.T) {
	gin.SetMode(gin.ReleaseMode)
	handler := &Handler{Config: config.Config{PublicIndexing: config.PublicIndexingNone}}
	router := gin.New()
	router.Use(handler.securityHeaders())
	router.NoRoute(func(c *gin.Context) {
		c.String(http.StatusOK, "ok")
	})

	for _, target := range []string{
		"/",
		"/api/docs.md",
		"/api/openapi.json",
		"/api/skill.md",
		"/api/version",
		"/api/health",
		"/dashboard",
	} {
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, target, nil))
		if got := recorder.Header().Get("X-Robots-Tag"); got != noIndexRobotsTag {
			t.Fatalf("%s X-Robots-Tag = %q, want %q", target, got, noIndexRobotsTag)
		}
	}

	for _, target := range []string{
		"/robots.txt",
		"/sitemap.xml",
		"/assets/app.js",
		"/favicon.ico",
		"/brand-logo.svg",
	} {
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, target, nil))
		if got := recorder.Header().Get("X-Robots-Tag"); got != "" {
			t.Fatalf("%s X-Robots-Tag = %q, want empty", target, got)
		}
	}
}

func TestSecurityHeadersPublicIndexingDocsAllowsPublicDocsAndStatus(t *testing.T) {
	gin.SetMode(gin.ReleaseMode)
	handler := &Handler{Config: config.Config{PublicIndexing: config.PublicIndexingDocs}}
	router := gin.New()
	router.Use(handler.securityHeaders())
	router.NoRoute(func(c *gin.Context) {
		c.String(http.StatusOK, "ok")
	})

	for _, target := range []string{
		"/",
		"/api/docs.md",
		"/api/openapi.json",
		"/api/openapi.yaml",
		"/api/skill.md",
		"/api/version",
		"/api/health",
	} {
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, target, nil))
		if got := recorder.Header().Get("X-Robots-Tag"); got != "" {
			t.Fatalf("%s X-Robots-Tag = %q, want empty", target, got)
		}
	}

	for _, target := range []string{
		"/api/version/check",
		"/api/shared/share-hloolmail-example",
		"/dashboard",
		"/share/share-hloolmail-example",
		"/api/docs.md?key=share-key",
		"/api/health?api_key=share-key",
	} {
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, target, nil))
		if got := recorder.Header().Get("X-Robots-Tag"); got != noIndexRobotsTag {
			t.Fatalf("%s X-Robots-Tag = %q, want %q", target, got, noIndexRobotsTag)
		}
	}
}
