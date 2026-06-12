package ratelimit

import (
	"testing"
	"time"

	"golang.org/x/time/rate"
)

func TestLimiterEvictsOldestAtCapacity(t *testing.T) {
	now := time.Date(2026, 6, 12, 10, 0, 0, 0, time.UTC)
	limiter := NewWithOptions(Options{
		MaxEntries: 3,
		Now: func() time.Time {
			return now
		},
	})

	for _, key := range []string{"a", "b", "c"} {
		if !limiter.Allow(key, rate.Inf, 1) {
			t.Fatalf("Allow(%q) = false, want true", key)
		}
		now = now.Add(time.Second)
	}
	if got := limiter.Len(); got != 3 {
		t.Fatalf("len = %d, want 3", got)
	}

	if !limiter.Allow("d", rate.Inf, 1) {
		t.Fatal("Allow(new key) = false, want true")
	}
	if got := limiter.Len(); got != 3 {
		t.Fatalf("len after eviction = %d, want 3", got)
	}
	if _, exists := limiter.entries["a"]; exists {
		t.Fatal("oldest entry was not evicted")
	}
}

func TestLimiterEvictsExpiredBeforeOldest(t *testing.T) {
	now := time.Date(2026, 6, 12, 10, 0, 0, 0, time.UTC)
	limiter := NewWithOptions(Options{
		MaxEntries: 3,
		TTL:        time.Minute,
		Now: func() time.Time {
			return now
		},
	})

	for _, key := range []string{"expired-a", "expired-b", "fresh"} {
		if !limiter.Allow(key, rate.Inf, 1) {
			t.Fatalf("Allow(%q) = false, want true", key)
		}
	}
	now = now.Add(2 * time.Minute)
	if !limiter.Allow("fresh", rate.Inf, 1) {
		t.Fatal("Allow(fresh refresh) = false, want true")
	}

	if !limiter.Allow("new", rate.Inf, 1) {
		t.Fatal("Allow(new key) = false, want true")
	}
	if got := limiter.Len(); got != 2 {
		t.Fatalf("len after expired cleanup = %d, want 2", got)
	}
	if _, exists := limiter.entries["fresh"]; !exists {
		t.Fatal("fresh entry was removed")
	}
	if _, exists := limiter.entries["new"]; !exists {
		t.Fatal("new entry was not stored")
	}
}

func TestLimiterBatchCleanupScansBoundedEntries(t *testing.T) {
	now := time.Date(2026, 6, 12, 10, 0, 0, 0, time.UTC)
	limiter := NewWithOptions(Options{
		MaxEntries:   10,
		TTL:          time.Minute,
		CleanupBatch: 2,
		Now: func() time.Time {
			return now
		},
	})
	for _, key := range []string{"a", "b", "c", "d", "e"} {
		if !limiter.Allow(key, rate.Inf, 1) {
			t.Fatalf("Allow(%q) = false, want true", key)
		}
	}

	now = now.Add(2 * time.Minute)
	limiter.mu.Lock()
	limiter.evictExpiredBatchLocked(now)
	limiter.mu.Unlock()

	if got := limiter.Len(); got != 3 {
		t.Fatalf("len after one cleanup batch = %d, want 3", got)
	}
}
