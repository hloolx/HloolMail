package jobs

import (
	"context"
	"testing"
	"time"

	"gptmail/internal/config"
	"gptmail/internal/domain"
	"gptmail/internal/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

type mxRetryProbeRunner struct {
	t      *testing.T
	called *bool
}

func (r mxRetryProbeRunner) CheckMX(ctx context.Context, host string, expectedMX string, options domain.CheckOptions) (domain.CheckResult, error) {
	*r.called = true
	return domain.CheckResult{
		Domain:     host,
		MXVerified: false,
		DNSStatus:  domain.DNSStatusMisconfigured,
		MXRecords:  []string{"wrong.example.test"},
		DNSChecks: []domain.DNSProbe{{
			Source:    "fake",
			Resolver:  "127.0.0.1:53",
			Verified:  false,
			MXRecords: []string{"wrong.example.test"},
		}},
	}, nil
}

func TestRunMXAutoRetrySchedulesFromRetryCompletionTime(t *testing.T) {
	db := mxRetryTestDB(t)
	start := time.Date(2026, 5, 18, 8, 0, 0, 0, time.UTC)
	retryAt := start.Add(37 * time.Second)
	d := createRetryDomain(t, db, start, retryAt.Add(time.Hour))
	probeCalled := false
	checker := domain.DNSChecker{
		DB:          db,
		Config:      config.Config{ExpectedMX: "mail.example.test"},
		ProbeRunner: mxRetryProbeRunner{t: t, called: &probeCalled},
	}
	now := sequenceNow(t, []time.Time{start, retryAt}, func(call int) {
		if call == 1 && !probeCalled {
			t.Fatal("retry timestamp was taken before DNS check completed")
		}
	})

	runMXAutoRetryAt(context.Background(), checker, now)

	var updated models.Domain
	if err := db.First(&updated, "id = ?", d.ID).Error; err != nil {
		t.Fatal(err)
	}
	if updated.MXAutoRetryLastAt == nil || !updated.MXAutoRetryLastAt.Equal(retryAt) {
		t.Fatalf("last retry = %v, want %v", updated.MXAutoRetryLastAt, retryAt)
	}
	wantNext := retryAt.Add(10 * time.Minute)
	if updated.MXAutoRetryNextAt == nil || !updated.MXAutoRetryNextAt.Equal(wantNext) {
		t.Fatalf("next retry = %v, want %v", updated.MXAutoRetryNextAt, wantNext)
	}
}

func TestRunMXAutoRetryDoesNotExpireBeforeRetryDeadline(t *testing.T) {
	db := mxRetryTestDB(t)
	start := time.Date(2026, 5, 18, 8, 0, 0, 0, time.UTC)
	retryAt := start.Add(30 * time.Second)
	until := retryAt.Add(5 * time.Minute)
	d := createRetryDomain(t, db, start, until)
	probeCalled := false
	checker := domain.DNSChecker{
		DB:          db,
		Config:      config.Config{ExpectedMX: "mail.example.test"},
		ProbeRunner: mxRetryProbeRunner{t: t, called: &probeCalled},
	}

	runMXAutoRetryAt(context.Background(), checker, sequenceNow(t, []time.Time{start, retryAt}, nil))

	var updated models.Domain
	if err := db.First(&updated, "id = ?", d.ID).Error; err != nil {
		t.Fatal(err)
	}
	if updated.MXAutoRetryNextAt == nil || !updated.MXAutoRetryNextAt.Equal(until) {
		t.Fatalf("next retry = %v, want capped deadline %v", updated.MXAutoRetryNextAt, until)
	}
}

func TestRunMXAutoRetryDeletesOnlyExpiredNeverVerifiedPendingDomain(t *testing.T) {
	db := mxRetryTestDB(t)
	now := time.Date(2026, 5, 18, 8, 0, 0, 0, time.UTC)
	expiredAt := now.Add(-time.Minute)
	d := createRetryDomain(t, db, now, expiredAt)
	probeCalled := false
	checker := domain.DNSChecker{
		DB:          db,
		Config:      config.Config{ExpectedMX: "mail.example.test"},
		ProbeRunner: mxRetryProbeRunner{t: t, called: &probeCalled},
	}

	runMXAutoRetryAt(context.Background(), checker, func() time.Time { return now })

	var count int64
	db.Model(&models.Domain{}).Where("id = ?", d.ID).Count(&count)
	if count != 0 {
		t.Fatalf("expired never-verified pending domain remained, count=%d", count)
	}
}

func TestRunMXAutoRetryDoesNotDeletePreviouslyVerifiedDomain(t *testing.T) {
	db := mxRetryTestDB(t)
	now := time.Date(2026, 5, 18, 8, 0, 0, 0, time.UTC)
	expiredAt := now.Add(-time.Minute)
	d := createRetryDomain(t, db, now, expiredAt)
	firstVerifiedAt := now.Add(-24 * time.Hour)
	if err := db.Model(&models.Domain{}).Where("id = ?", d.ID).Updates(map[string]interface{}{
		"first_verified_at":  &firstVerifiedAt,
		"pending_delete_at":  nil,
		"mx_verified":        false,
		"last_health_status": "healthy",
	}).Error; err != nil {
		t.Fatal(err)
	}
	probeCalled := false
	checker := domain.DNSChecker{
		DB:          db,
		Config:      config.Config{ExpectedMX: "mail.example.test"},
		ProbeRunner: mxRetryProbeRunner{t: t, called: &probeCalled},
	}

	runMXAutoRetryAt(context.Background(), checker, func() time.Time { return now })

	var updated models.Domain
	if err := db.First(&updated, d.ID).Error; err != nil {
		t.Fatal(err)
	}
	if updated.MXAutoRetryEnabled {
		t.Fatal("expected retry to be disabled after retry window")
	}
	if updated.MXAutoRetryNextAt != nil {
		t.Fatalf("expected retry next time to be cleared, got %v", updated.MXAutoRetryNextAt)
	}
	if updated.LastHealthStatus != DomainHealthStatusUnhealthy {
		t.Fatalf("last health status = %q, want unhealthy", updated.LastHealthStatus)
	}
	var notifications int64
	if err := db.Model(&models.Notification{}).Where("domain_id = ? AND type = ?", d.ID, "MX_FAILED").Count(&notifications).Error; err != nil {
		t.Fatal(err)
	}
	if notifications != 1 {
		t.Fatalf("notifications = %d, want 1", notifications)
	}
}

func mxRetryTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.Domain{}, &models.Notification{}); err != nil {
		t.Fatal(err)
	}
	return db
}

func createRetryDomain(t *testing.T, db *gorm.DB, nextAt time.Time, until time.Time) models.Domain {
	t.Helper()
	d := models.Domain{
		Domain:               "retry.local",
		Mode:                 models.DomainModePrivate,
		Active:               true,
		MXAutoRetryEnabled:   true,
		MXAutoRetryNextAt:    &nextAt,
		MXAutoRetryUntil:     &until,
		MXAutoRetryStartedAt: &nextAt,
		PendingDeleteAt:      &until,
		CreatedAt:            nextAt.Add(-time.Hour),
	}
	if err := db.Create(&d).Error; err != nil {
		t.Fatal(err)
	}
	return d
}

func sequenceNow(t *testing.T, values []time.Time, afterCall func(call int)) func() time.Time {
	t.Helper()
	call := 0
	return func() time.Time {
		if call >= len(values) {
			t.Fatalf("unexpected time request %d", call)
		}
		if afterCall != nil {
			afterCall(call)
		}
		value := values[call]
		call++
		return value
	}
}
