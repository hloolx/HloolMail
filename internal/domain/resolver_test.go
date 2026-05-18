package domain

import (
	"errors"
	"testing"

	"gptmail/internal/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func TestResolveDomainExactAndWildcard(t *testing.T) {
	db := domainTestDB(t)
	resolver := Resolver{DB: db}
	domains := []models.Domain{
		{Domain: "example.test", Mode: models.DomainModePublic, Active: true, MXVerified: true, WildcardEnabled: true},
		{Domain: "disabled.test", Mode: models.DomainModePublic, Active: false, MXVerified: true, WildcardEnabled: true},
	}
	if err := db.Create(&domains).Error; err != nil {
		t.Fatal(err)
	}

	exact, err := resolver.ResolveDomain("User@Example.Test")
	if err != nil {
		t.Fatalf("exact resolve failed: %v", err)
	}
	if exact.Domain != "example.test" {
		t.Fatalf("exact resolved to %q", exact.Domain)
	}

	wildcard, err := resolver.ResolveDomain("user@alpha.beta.example.test")
	if err != nil {
		t.Fatalf("wildcard resolve failed: %v", err)
	}
	if wildcard.Domain != "example.test" {
		t.Fatalf("wildcard resolved to %q", wildcard.Domain)
	}

	if _, err := resolver.ResolveDomain("user@disabled.test"); !errors.Is(err, ErrDomainNotFound) {
		t.Fatalf("disabled domain error = %v", err)
	}
}

func TestResolveDomainWildcardStopsAtPublicSuffix(t *testing.T) {
	db := domainTestDB(t)
	resolver := Resolver{DB: db}
	domains := []models.Domain{
		{Domain: "co.uk", Mode: models.DomainModePublic, Active: true, MXVerified: true, WildcardEnabled: true},
		{Domain: "example.co.uk", Mode: models.DomainModePublic, Active: true, MXVerified: true, WildcardEnabled: true},
	}
	if err := db.Create(&domains).Error; err != nil {
		t.Fatal(err)
	}

	wildcard, err := resolver.ResolveDomain("user@alpha.beta.example.co.uk")
	if err != nil {
		t.Fatalf("wildcard resolve failed: %v", err)
	}
	if wildcard.Domain != "example.co.uk" {
		t.Fatalf("wildcard resolved to %q", wildcard.Domain)
	}

	if _, err := resolver.ResolveDomain("user@alpha.co.uk"); !errors.Is(err, ErrDomainNotFound) {
		t.Fatalf("public suffix wildcard error = %v", err)
	}
}

func TestNormalizeRecipient(t *testing.T) {
	parts, err := NormalizeRecipient("Display <Demo@Example.Test>")
	if err != nil {
		t.Fatal(err)
	}
	if parts.Recipient != "demo@example.test" || parts.Local != "demo" || parts.Host != "example.test" {
		t.Fatalf("unexpected parts: %#v", parts)
	}
}

func TestNormalizeDomainWildcardInput(t *testing.T) {
	if got := NormalizeDomain("*.Example.Test."); got != "example.test" {
		t.Fatalf("NormalizeDomain wildcard = %q", got)
	}
	if got := NormalizeDomain("*Example.Test"); got != "example.test" {
		t.Fatalf("NormalizeDomain star prefix = %q", got)
	}
}

func domainTestDB(t *testing.T) *gorm.DB {
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
	if err := db.AutoMigrate(&models.Domain{}); err != nil {
		t.Fatal(err)
	}
	return db
}
