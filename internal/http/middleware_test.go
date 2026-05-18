package httpapi

import (
	"sync"
	"testing"
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
