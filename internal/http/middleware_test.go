package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

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
