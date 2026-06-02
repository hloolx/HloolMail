package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"gptmail/internal/config"

	"github.com/gin-gonic/gin"
)

func TestEnsureRateLimiterConcurrentInitializesOnce(t *testing.T) {
	var h Handler

	const workers = 64
	start := make(chan struct{})
	results := make(chan *rateLimiter, workers)

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
