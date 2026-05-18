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

type fakeDNSProbeRunner struct {
	verified bool
	records  []string
}

func (r fakeDNSProbeRunner) CheckMX(ctx context.Context, host string, expectedMX string, options domain.CheckOptions) (domain.CheckResult, error) {
	status := domain.DNSStatusMisconfigured
	if r.verified {
		status = domain.DNSStatusVerified
	}
	return domain.CheckResult{
		Domain:     host,
		MXVerified: r.verified,
		DNSStatus:  status,
		MXRecords:  r.records,
		DNSChecks: []domain.DNSProbe{{
			Source:    "fake",
			Resolver:  "127.0.0.1:53",
			Verified:  r.verified,
			MXRecords: r.records,
		}},
	}, nil
}

func TestEnsureDomainCheckSettingsCreatesDefaults(t *testing.T) {
	db := domainHealthTestDB(t)
	settings, err := EnsureDomainCheckSettings(db)
	if err != nil {
		t.Fatal(err)
	}
	if !settings.Enabled {
		t.Fatal("expected default settings to be enabled")
	}
	if settings.IntervalMinutes != 30 || settings.TimeoutMS != 3500 || settings.MaxConcurrency != 5 {
		t.Fatalf("unexpected defaults: %+v", settings)
	}
	if len(DomainCheckResolvers(settings)) != 3 {
		t.Fatalf("expected default resolvers, got %v", DomainCheckResolvers(settings))
	}
}

func TestDomainHealthRunRecordsFailureAndNotifies(t *testing.T) {
	db := domainHealthTestDB(t)
	user := models.User{Email: "owner@example.test", Role: models.UserRoleUser, Enabled: true}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	d := models.Domain{
		Domain:     "example.test",
		Mode:       models.DomainModePrivate,
		OwnerID:    &user.ID,
		Active:     true,
		MXVerified: true,
		CreatedAt:  time.Now(),
	}
	if err := db.Create(&d).Error; err != nil {
		t.Fatal(err)
	}
	settings, err := EnsureDomainCheckSettings(db)
	if err != nil {
		t.Fatal(err)
	}
	settings.FailureThreshold = 1
	settings, err = SaveDomainCheckSettings(db, settings)
	if err != nil {
		t.Fatal(err)
	}

	checker := domain.DNSChecker{
		DB:          db,
		Config:      config.Config{ExpectedMX: "mail.example.test"},
		ProbeRunner: fakeDNSProbeRunner{verified: false, records: []string{"wrong.example.test"}},
	}
	job := NewDomainHealthJob(db, checker, nil)
	run, err := job.StartRun(context.Background(), DomainCheckTriggerManual)
	if err != nil {
		t.Fatal(err)
	}
	waitForDomainCheckRun(t, db, run.ID)

	var record models.DomainCheckResultRecord
	if err := db.First(&record, "run_id = ?", run.ID).Error; err != nil {
		t.Fatal(err)
	}
	if record.Status != DomainHealthStatusUnhealthy || record.MXVerified {
		t.Fatalf("unexpected result record: %+v", record)
	}
	var updated models.Domain
	if err := db.First(&updated, "id = ?", d.ID).Error; err != nil {
		t.Fatal(err)
	}
	if updated.HealthFailureCount != 1 || updated.LastHealthStatus != DomainHealthStatusUnhealthy {
		t.Fatalf("unexpected domain health counters: %+v", updated)
	}
	var notifications int64
	if err := db.Model(&models.Notification{}).Where("domain_id = ? AND type = ?", d.ID, "MX_FAILED").Count(&notifications).Error; err != nil {
		t.Fatal(err)
	}
	if notifications != 2 {
		t.Fatalf("expected owner and global notifications, got %d", notifications)
	}
}

func TestDomainHealthRunDueStartsWhenNeverRun(t *testing.T) {
	db := domainHealthTestDB(t)
	settings, err := EnsureDomainCheckSettings(db)
	if err != nil {
		t.Fatal(err)
	}
	future := time.Now().Add(24 * time.Hour)
	settings.NextRunAt = &future
	settings.LastRunAt = nil
	if _, err := SaveDomainCheckSettings(db, settings); err != nil {
		t.Fatal(err)
	}

	checker := domain.DNSChecker{
		DB:          db,
		Config:      config.Config{ExpectedMX: "mail.example.test"},
		ProbeRunner: fakeDNSProbeRunner{verified: true, records: []string{"mail.example.test"}},
	}
	job := NewDomainHealthJob(db, checker, nil)
	if err := job.RunDue(context.Background()); err != nil {
		t.Fatal(err)
	}

	var run models.DomainCheckRun
	if err := db.Order("started_at desc").First(&run).Error; err != nil {
		t.Fatal(err)
	}
	waitForDomainCheckRun(t, db, run.ID)
}

func domainHealthTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	if err := db.AutoMigrate(
		&models.User{},
		&models.Domain{},
		&models.Notification{},
		&models.DomainCheckSettings{},
		&models.DomainCheckRun{},
		&models.DomainCheckResultRecord{},
	); err != nil {
		t.Fatal(err)
	}
	return db
}

func waitForDomainCheckRun(t *testing.T, db *gorm.DB, id uint) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		var run models.DomainCheckRun
		if err := db.First(&run, "id = ?", id).Error; err != nil {
			t.Fatal(err)
		}
		if run.Status != DomainCheckStatusRunning {
			if run.Status != DomainCheckStatusSuccess {
				t.Fatalf("domain check run finished with %s: %s", run.Status, run.ErrorMessage)
			}
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("domain check run did not finish")
}
