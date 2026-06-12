package ratelimit

import (
	"sync"
	"time"

	"golang.org/x/time/rate"
)

const (
	DefaultMaxEntries      = 100_000
	DefaultTTL             = 10 * time.Minute
	DefaultCleanupInterval = 5 * time.Minute
	DefaultCleanupBatch    = 1_000
)

type Options struct {
	MaxEntries      int
	TTL             time.Duration
	CleanupInterval time.Duration
	CleanupBatch    int
	Now             func() time.Time
}

type Limiter struct {
	mu           sync.Mutex
	entries      map[string]*clientLimiter
	maxEntries   int
	cleanupBatch int
	ttl          time.Duration
	now          func() time.Time
}

type clientLimiter struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

func New() *Limiter {
	return NewWithOptions(Options{CleanupInterval: DefaultCleanupInterval})
}

func NewWithOptions(opts Options) *Limiter {
	maxEntries := opts.MaxEntries
	if maxEntries <= 0 {
		maxEntries = DefaultMaxEntries
	}
	ttl := opts.TTL
	if ttl <= 0 {
		ttl = DefaultTTL
	}
	cleanupBatch := opts.CleanupBatch
	if cleanupBatch <= 0 {
		cleanupBatch = DefaultCleanupBatch
	}
	now := opts.Now
	if now == nil {
		now = time.Now
	}
	limiter := &Limiter{
		entries:      make(map[string]*clientLimiter),
		maxEntries:   maxEntries,
		cleanupBatch: cleanupBatch,
		ttl:          ttl,
		now:          now,
	}
	if opts.CleanupInterval > 0 {
		go limiter.cleanup(opts.CleanupInterval)
	}
	return limiter
}

func (l *Limiter) Allow(key string, r rate.Limit, burst int) bool {
	if l == nil {
		return true
	}
	now := l.now()
	l.mu.Lock()
	entry, exists := l.entries[key]
	if !exists {
		l.ensureCapacityLocked(now)
		entry = &clientLimiter{limiter: rate.NewLimiter(r, burst)}
		l.entries[key] = entry
	}
	entry.lastSeen = now
	l.mu.Unlock()
	return entry.limiter.Allow()
}

func (l *Limiter) Len() int {
	if l == nil {
		return 0
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.entries)
}

func (l *Limiter) ensureCapacityLocked(now time.Time) {
	if len(l.entries) < l.maxEntries {
		return
	}
	l.evictExpiredLocked(now)
	if len(l.entries) < l.maxEntries {
		return
	}
	l.evictOldestLocked()
}

func (l *Limiter) evictExpiredLocked(now time.Time) {
	for key, entry := range l.entries {
		if now.Sub(entry.lastSeen) > l.ttl {
			delete(l.entries, key)
		}
	}
}

func (l *Limiter) evictOldestLocked() {
	var oldestKey string
	var oldestSeen time.Time
	for key, entry := range l.entries {
		if oldestKey == "" || entry.lastSeen.Before(oldestSeen) {
			oldestKey = key
			oldestSeen = entry.lastSeen
		}
	}
	if oldestKey != "" {
		delete(l.entries, oldestKey)
	}
}

func (l *Limiter) cleanup(interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for range ticker.C {
		now := l.now()
		l.mu.Lock()
		l.evictExpiredBatchLocked(now)
		l.mu.Unlock()
	}
}

func (l *Limiter) evictExpiredBatchLocked(now time.Time) {
	scanned := 0
	for key, entry := range l.entries {
		if now.Sub(entry.lastSeen) > l.ttl {
			delete(l.entries, key)
		}
		scanned++
		if scanned >= l.cleanupBatch {
			return
		}
	}
}
