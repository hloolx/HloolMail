package auth

import (
	"errors"
	"testing"
	"time"

	"gptmail/internal/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func TestAPIKeyHashVerifyAndQuota(t *testing.T) {
	hash, err := HashSecret("secret")
	if err != nil {
		t.Fatal(err)
	}
	if !VerifySecret(hash, "secret") {
		t.Fatal("expected secret to verify")
	}
	if VerifySecret(hash, "wrong") {
		t.Fatal("wrong secret verified")
	}

	db := authTestDB(t)
	service := APIKeyService{DB: db}
	key, plain, err := service.Create("ci", 1, 1)
	if err != nil {
		t.Fatal(err)
	}
	if key.KeyPrefix[:14] != "key-hloolmail-" || plain[:14] != "key-hloolmail-" {
		t.Fatalf("unexpected api key format: plain=%q prefix=%q", plain, key.KeyPrefix)
	}
	if plain == "" || key.KeyHash == plain {
		t.Fatal("plain key was not generated or hash leaked")
	}
	if key.KeyValue != plain {
		t.Fatal("plain key should be stored for exact lookup and authorized copy actions")
	}
	authenticated, err := service.Authenticate(plain)
	if err != nil {
		t.Fatal(err)
	}
	if authenticated.OwnerID != key.OwnerID || authenticated.ID != key.ID {
		t.Fatal("expected authentication to return the stored api key")
	}
	if err := service.Consume(authenticated); err != nil {
		t.Fatal(err)
	}
	if err := service.Consume(authenticated); !errors.Is(err, ErrAPIQuota) {
		t.Fatalf("expected quota error, got %v", err)
	}
}

func TestAPIKeyQuotaFailureReasons(t *testing.T) {
	db := authTestDB(t)
	service := APIKeyService{DB: db}

	dailyKey, dailyPlain, err := service.Create("daily", 1, 0)
	if err != nil {
		t.Fatal(err)
	}
	dailyAuthenticated, err := service.Authenticate(dailyPlain)
	if err != nil {
		t.Fatal(err)
	}
	if err := service.Consume(dailyAuthenticated); err != nil {
		t.Fatal(err)
	}
	if err := service.Consume(dailyAuthenticated); !errors.Is(err, ErrAPIDailyQuota) || !errors.Is(err, ErrAPIQuota) {
		t.Fatalf("expected daily quota error wrapping generic quota, got %v", err)
	}
	if dailyKey.TotalLimit != 0 {
		t.Fatalf("unexpected total limit: %d", dailyKey.TotalLimit)
	}

	totalKey, totalPlain, err := service.Create("total", 0, 1)
	if err != nil {
		t.Fatal(err)
	}
	totalAuthenticated, err := service.Authenticate(totalPlain)
	if err != nil {
		t.Fatal(err)
	}
	if err := service.Consume(totalAuthenticated); err != nil {
		t.Fatal(err)
	}
	if err := service.Consume(totalAuthenticated); !errors.Is(err, ErrAPITotalQuota) || !errors.Is(err, ErrAPIQuota) {
		t.Fatalf("expected total quota error wrapping generic quota, got %v", err)
	}
	if totalKey.DailyLimit != 0 {
		t.Fatalf("unexpected daily limit: %d", totalKey.DailyLimit)
	}

	bothKey, bothPlain, err := service.Create("both", 1, 1)
	if err != nil {
		t.Fatal(err)
	}
	bothAuthenticated, err := service.Authenticate(bothPlain)
	if err != nil {
		t.Fatal(err)
	}
	if err := service.Consume(bothAuthenticated); err != nil {
		t.Fatal(err)
	}
	if err := service.Consume(bothAuthenticated); !errors.Is(err, ErrAPITotalQuota) {
		t.Fatalf("expected total quota to take precedence when both limits are exhausted for key %d, got %v", bothKey.ID, err)
	}
}

func TestAPIKeyUnlimitedAndExpiry(t *testing.T) {
	db := authTestDB(t)
	service := APIKeyService{DB: db}
	expired := time.Now().Add(-time.Minute)
	_, expiredPlain, err := service.CreateFor(nil, "expired", 0, 0, &expired)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Authenticate(expiredPlain); !errors.Is(err, ErrAPIKeyExpired) {
		t.Fatalf("expected expired error, got %v", err)
	}

	future := time.Now().Add(time.Hour)
	key, plain, err := service.CreateFor(nil, "unlimited", 0, 0, &future)
	if err != nil {
		t.Fatal(err)
	}
	authenticated, err := service.Authenticate(plain)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		if err := service.Consume(authenticated); err != nil {
			t.Fatalf("unlimited key consume %d: %v", i, err)
		}
	}
	if key.DailyLimit != 0 || key.TotalLimit != 0 {
		t.Fatalf("expected unlimited limits to remain zero: daily=%d total=%d", key.DailyLimit, key.TotalLimit)
	}
}

func TestUsageForReportsUnlimitedQuotaClearly(t *testing.T) {
	usage := UsageFor(&models.APIKey{
		DailyLimit: 0,
		TotalLimit: 0,
		UsedToday:  3,
		TotalUsed:  42,
	})
	if usage["remaining_today"] != "unlimited" || usage["remaining_total"] != "unlimited" {
		t.Fatalf("expected unlimited remaining values, got %#v", usage)
	}
	if usage["daily_unlimited"] != "true" || usage["total_unlimited"] != "true" {
		t.Fatalf("expected explicit unlimited flags, got %#v", usage)
	}

	limited := UsageFor(&models.APIKey{
		DailyLimit: 10,
		TotalLimit: 20,
		UsedToday:  4,
		TotalUsed:  25,
	})
	if limited["remaining_today"] != "6" || limited["remaining_total"] != "0" {
		t.Fatalf("expected clamped numeric remaining values, got %#v", limited)
	}
	if limited["daily_unlimited"] != "false" || limited["total_unlimited"] != "false" {
		t.Fatalf("expected limited flags, got %#v", limited)
	}
}

func TestAPIKeyAuthenticateUsesStoredFullKey(t *testing.T) {
	db := authTestDB(t)
	service := APIKeyService{DB: db}
	key, plain, err := service.Create("stored", 10, 0)
	if err != nil {
		t.Fatal(err)
	}
	key.KeyPrefix = "legacy-prefix-that-does-not-match"
	key.KeyHash = ""
	if err := db.Save(key).Error; err != nil {
		t.Fatal(err)
	}

	authenticated, err := service.Authenticate(plain)
	if err != nil {
		t.Fatalf("expected stored full key lookup to authenticate: %v", err)
	}
	if authenticated.ID != key.ID {
		t.Fatal("expected stored full key lookup to return the key row")
	}
}

func TestAPIKeyAuthenticateFallsBackToLegacyHash(t *testing.T) {
	db := authTestDB(t)
	service := APIKeyService{DB: db}
	key, plain, err := service.Create("legacy", 10, 0)
	if err != nil {
		t.Fatal(err)
	}
	key.KeyValue = ""
	if err := db.Save(key).Error; err != nil {
		t.Fatal(err)
	}
	authenticated, err := service.Authenticate(plain)
	if err != nil {
		t.Fatalf("expected legacy hash fallback to authenticate: %v", err)
	}
	if authenticated.ID != key.ID {
		t.Fatal("expected legacy fallback to return the original key")
	}
}

func authTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.APIKey{}); err != nil {
		t.Fatal(err)
	}
	return db
}
