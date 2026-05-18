package httpapi

import (
	"sync"
	"time"

	"golang.org/x/time/rate"
)

type rateLimiter struct {
	mu       sync.Mutex
	limiters map[string]*clientLimiter
}

type clientLimiter struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

func NewRateLimiter() *rateLimiter {
	rl := &rateLimiter{limiters: make(map[string]*clientLimiter)}
	go rl.cleanup(5 * time.Minute)
	return rl
}

func (rl *rateLimiter) allow(key string, r rate.Limit, burst int) bool {
	if rl == nil {
		return true
	}
	rl.mu.Lock()
	entry, exists := rl.limiters[key]
	if !exists {
		entry = &clientLimiter{limiter: rate.NewLimiter(r, burst)}
		rl.limiters[key] = entry
	}
	entry.lastSeen = time.Now()
	rl.mu.Unlock()
	return entry.limiter.Allow()
}

func (rl *rateLimiter) cleanup(interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for range ticker.C {
		rl.mu.Lock()
		for key, entry := range rl.limiters {
			if time.Since(entry.lastSeen) > 10*time.Minute {
				delete(rl.limiters, key)
			}
		}
		rl.mu.Unlock()
	}
}
