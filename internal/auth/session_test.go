package auth

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestNewSessionServiceDoesNotUseKnownDefault(t *testing.T) {
	service := NewSessionService("")
	if string(service.Secret) == "session:change-this-in-production" {
		t.Fatal("blank session secret used the known default")
	}

	defaultService := NewSessionService("change-this-in-production")
	if string(defaultService.Secret) == "session:change-this-in-production" {
		t.Fatal("known default session secret was accepted")
	}
}

func TestNewSessionServiceUsesConfiguredSecret(t *testing.T) {
	service := NewSessionService("configured-secret")
	if got, want := string(service.Secret), "session:configured-secret"; got != want {
		t.Fatalf("session secret = %q, want %q", got, want)
	}
}

func TestSessionServiceIssuesAndVerifiesStandardJWT(t *testing.T) {
	service := NewSessionService("configured-secret")
	token, err := service.Create(42, "admin", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(token, ".") != 2 {
		t.Fatalf("expected compact JWT with three segments, got %q", token)
	}

	var parsedClaims SessionClaims
	parsed, err := jwt.ParseWithClaims(
		token,
		&parsedClaims,
		func(token *jwt.Token) (interface{}, error) {
			return service.Secret, nil
		},
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithIssuer(sessionIssuer),
		jwt.WithExpirationRequired(),
		jwt.WithIssuedAt(),
		jwt.WithLeeway(sessionClockSkew),
	)
	if err != nil || parsed == nil || !parsed.Valid {
		t.Fatalf("jwt parse failed: %v", err)
	}
	if parsedClaims.UserID != 42 || parsedClaims.Role != "admin" {
		t.Fatalf("unexpected custom claims: %#v", parsedClaims)
	}
	if parsedClaims.ID == "" || parsedClaims.IssuedAt == nil || parsedClaims.NotBefore == nil || parsedClaims.ExpiresAt == nil {
		t.Fatalf("missing registered claims: %#v", parsedClaims.RegisteredClaims)
	}

	verified, err := service.Verify(token)
	if err != nil {
		t.Fatal(err)
	}
	if verified.ID != parsedClaims.ID || verified.UserID != 42 || verified.Role != "admin" {
		t.Fatalf("verified claims mismatch: %#v", verified)
	}
}

func TestSessionServiceRejectsRevokedJWT(t *testing.T) {
	service := NewSessionService("configured-secret")
	token, err := service.Create(7, "user", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Verify(token); err != nil {
		t.Fatalf("expected fresh token to verify: %v", err)
	}
	if err := service.Revoke(token); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Verify(token); !errors.Is(err, ErrSessionInvalid) {
		t.Fatalf("expected revoked token to be invalid, got %v", err)
	}
}

func TestSessionServiceRejectsUnregisteredJTIReplay(t *testing.T) {
	issuer := NewSessionService("configured-secret")
	token, err := issuer.Create(7, "user", time.Hour)
	if err != nil {
		t.Fatal(err)
	}

	verifier := NewSessionService("configured-secret")
	if _, err := verifier.Verify(token); !errors.Is(err, ErrSessionInvalid) {
		t.Fatalf("expected token with unregistered jti to be invalid, got %v", err)
	}
}

func TestSessionServiceHonorsExpirationLeeway(t *testing.T) {
	service := NewSessionService("configured-secret")
	now := time.Now().UTC()
	claims := SessionClaims{
		UserID: 7,
		Role:   "user",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    sessionIssuer,
			Subject:   "7",
			ExpiresAt: jwt.NewNumericDate(now.Add(-sessionClockSkew / 2)),
			NotBefore: jwt.NewNumericDate(now.Add(-time.Minute)),
			IssuedAt:  jwt.NewNumericDate(now.Add(-time.Minute)),
			ID:        "skew-token",
		},
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(service.Secret)
	if err != nil {
		t.Fatal(err)
	}
	if err := service.Store.Register(claims.ID, claims.UserID, claims.ExpiresAt.Time); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Verify(token); err != nil {
		t.Fatalf("expected token inside clock skew window to verify: %v", err)
	}
}
