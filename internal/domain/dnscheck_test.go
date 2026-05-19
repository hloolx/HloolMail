package domain

import (
	"context"
	"errors"
	"testing"
	"time"

	"gptmail/internal/config"
	"gptmail/internal/models"
)

func TestNewVerificationTokenReturnsErrorOnRandomFailure(t *testing.T) {
	originalReader := verificationRandReader
	verificationRandReader = failingReader{}
	t.Cleanup(func() {
		verificationRandReader = originalReader
	})

	token, err := NewVerificationToken()
	if err == nil {
		t.Fatal("expected random failure to be returned")
	}
	if !errors.Is(err, ErrVerificationToken) {
		t.Fatalf("expected verification token error, got %v", err)
	}
	if token != "" {
		t.Fatalf("expected no fallback token, got %q", token)
	}
}

func TestCheckDoesNotOverwriteConcurrentDomainUpdate(t *testing.T) {
	db := domainTestDB(t)
	ownerID := uint(1)
	d := models.Domain{
		Domain:            "race.test",
		Mode:              models.DomainModePrivate,
		OwnerID:           &ownerID,
		Active:            true,
		VerificationToken: "probe-token",
	}
	if err := db.Create(&d).Error; err != nil {
		t.Fatal(err)
	}

	runner := blockingProbeRunner{
		started: make(chan struct{}),
		release: make(chan struct{}),
		result: CheckResult{
			MXVerified: true,
			DNSStatus:  DNSStatusVerified,
			MXRecords:  []string{"mail.example.com"},
		},
	}
	checker := DNSChecker{
		DB:          db,
		Config:      config.Config{ExpectedMX: "mail.example.com"},
		ProbeRunner: runner,
	}

	errCh := make(chan error, 1)
	go func() {
		_, err := checker.Check(context.Background(), d.Domain)
		errCh <- err
	}()

	<-runner.started
	if err := db.Model(&models.Domain{}).Where("id = ?", d.ID).Update("mode", models.DomainModePublic).Error; err != nil {
		t.Fatal(err)
	}
	close(runner.release)
	if err := <-errCh; err != nil {
		t.Fatal(err)
	}

	var reloaded models.Domain
	if err := db.First(&reloaded, d.ID).Error; err != nil {
		t.Fatal(err)
	}
	if reloaded.Mode != models.DomainModePublic {
		t.Fatalf("concurrent mode update was overwritten: %q", reloaded.Mode)
	}
	if !reloaded.MXVerified {
		t.Fatal("expected MX check fields to be persisted")
	}
	if reloaded.LastMXCheckAt == nil {
		t.Fatal("expected last MX check time to be persisted")
	}
}

func TestCheckRecoverySetsFirstVerifiedAndClearsPendingDelete(t *testing.T) {
	db := domainTestDB(t)
	pendingDeleteAt := time.Now().Add(time.Hour)
	d := models.Domain{
		Domain:            "recover.test",
		Mode:              models.DomainModePrivate,
		Active:            true,
		VerificationToken: "probe-token",
		PendingDeleteAt:   &pendingDeleteAt,
	}
	if err := db.Create(&d).Error; err != nil {
		t.Fatal(err)
	}
	checker := DNSChecker{
		DB:     db,
		Config: config.Config{ExpectedMX: "mail.example.com"},
		ProbeRunner: staticProbeRunner{result: CheckResult{
			MXVerified: true,
			DNSStatus:  DNSStatusVerified,
			MXRecords:  []string{"mail.example.com"},
		}},
	}

	if _, err := checker.Check(context.Background(), d.Domain); err != nil {
		t.Fatal(err)
	}

	var updated models.Domain
	if err := db.First(&updated, d.ID).Error; err != nil {
		t.Fatal(err)
	}
	if updated.FirstVerifiedAt == nil {
		t.Fatal("expected first_verified_at to be set")
	}
	if updated.PendingDeleteAt != nil {
		t.Fatalf("expected pending_delete_at to be cleared, got %v", updated.PendingDeleteAt)
	}
	if !updated.MXVerified || updated.LastHealthStatus != "healthy" {
		t.Fatalf("expected healthy verified domain, got mx=%v status=%q", updated.MXVerified, updated.LastHealthStatus)
	}
}

type failingReader struct{}

func (failingReader) Read([]byte) (int, error) {
	return 0, errors.New("random failed")
}

type blockingProbeRunner struct {
	started chan struct{}
	release chan struct{}
	result  CheckResult
	err     error
}

func (r blockingProbeRunner) CheckMX(ctx context.Context, host string, expectedMX string, options CheckOptions) (CheckResult, error) {
	close(r.started)
	select {
	case <-ctx.Done():
		return CheckResult{}, ctx.Err()
	case <-r.release:
		return r.result, r.err
	}
}

type staticProbeRunner struct {
	result CheckResult
	err    error
}

func (r staticProbeRunner) CheckMX(context.Context, string, string, CheckOptions) (CheckResult, error) {
	return r.result, r.err
}
