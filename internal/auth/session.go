package auth

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"gptmail/internal/models"

	"github.com/golang-jwt/jwt/v5"
	"gorm.io/gorm"
)

var ErrSessionInvalid = errors.New("session invalid")

const (
	sessionSecretBytes  = 32
	sessionTokenIDBytes = 32
	sessionIssuer       = "gptmail"
	sessionClockSkew    = 30 * time.Second
)

type SessionService struct {
	Secret []byte
	Store  SessionTokenStore
}

type SessionTokenStore interface {
	Register(jti string, userID uint, expiresAt time.Time) error
	Accept(jti string, userID uint, now time.Time) error
	Revoke(jti string) error
}

type SessionClaims struct {
	UserID uint   `json:"uid"`
	Role   string `json:"role"`
	jwt.RegisteredClaims
}

func NewSessionService(secret string, dbs ...*gorm.DB) SessionService {
	secret = strings.TrimSpace(secret)
	if secret == "" || isKnownInsecureSessionSecret(secret) {
		generated, err := GenerateSessionSecret()
		if err != nil {
			generated = fmt.Sprintf("ephemeral-session-secret-%d", time.Now().UnixNano())
		}
		secret = generated
	}
	var store SessionTokenStore = newMemorySessionTokenStore()
	if len(dbs) > 0 && dbs[0] != nil {
		store = dbSessionTokenStore{DB: dbs[0]}
	}
	return SessionService{Secret: []byte("session:" + secret), Store: store}
}

func GenerateSessionSecret() (string, error) {
	random := make([]byte, sessionSecretBytes)
	if _, err := rand.Read(random); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(random), nil
}

func isKnownInsecureSessionSecret(secret string) bool {
	switch strings.TrimSpace(secret) {
	case "change-this-in-production", "change-this-too", "replace-with-a-long-random-secret", "replace-with-another-long-random-secret":
		return true
	default:
		return false
	}
}

func (s SessionService) Create(userID uint, role string, ttl time.Duration) (string, error) {
	if userID == 0 || ttl <= 0 {
		return "", ErrSessionInvalid
	}
	now := time.Now().UTC()
	expiresAt := now.Add(ttl)
	jti, err := generateSessionTokenID()
	if err != nil {
		return "", err
	}
	claims := SessionClaims{
		UserID: userID,
		Role:   role,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    sessionIssuer,
			Subject:   strconv.FormatUint(uint64(userID), 10),
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			NotBefore: jwt.NewNumericDate(now),
			IssuedAt:  jwt.NewNumericDate(now),
			ID:        jti,
		},
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(s.Secret)
	if err != nil {
		return "", err
	}
	if err := s.sessionStore().Register(jti, userID, expiresAt); err != nil {
		return "", err
	}
	return token, nil
}

func (s SessionService) Verify(token string) (SessionClaims, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return SessionClaims{}, ErrSessionInvalid
	}
	var claims SessionClaims
	parsed, err := jwt.ParseWithClaims(
		token,
		&claims,
		func(token *jwt.Token) (interface{}, error) {
			return s.Secret, nil
		},
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithIssuer(sessionIssuer),
		jwt.WithExpirationRequired(),
		jwt.WithIssuedAt(),
		jwt.WithLeeway(sessionClockSkew),
	)
	if err != nil || parsed == nil || !parsed.Valid {
		return SessionClaims{}, ErrSessionInvalid
	}
	if !claims.hasRequiredRegisteredClaims() {
		return SessionClaims{}, ErrSessionInvalid
	}
	subjectUserID, err := strconv.ParseUint(claims.Subject, 10, 64)
	if err != nil || uint(subjectUserID) != claims.UserID {
		return SessionClaims{}, ErrSessionInvalid
	}
	if claims.UserID == 0 {
		return SessionClaims{}, ErrSessionInvalid
	}
	if err := s.sessionStore().Accept(claims.ID, claims.UserID, time.Now().UTC()); err != nil {
		return SessionClaims{}, ErrSessionInvalid
	}
	return claims, nil
}

func (s SessionService) Revoke(token string) error {
	token = strings.TrimSpace(token)
	if token == "" {
		return ErrSessionInvalid
	}
	var claims SessionClaims
	if _, _, err := jwt.NewParser().ParseUnverified(token, &claims); err != nil || claims.ID == "" {
		return ErrSessionInvalid
	}
	return s.sessionStore().Revoke(claims.ID)
}

func (s SessionService) sessionStore() SessionTokenStore {
	if s.Store != nil {
		return s.Store
	}
	return invalidSessionTokenStore{}
}

func (c SessionClaims) hasRequiredRegisteredClaims() bool {
	return c.ExpiresAt != nil && c.NotBefore != nil && c.IssuedAt != nil && c.ID != ""
}

func generateSessionTokenID() (string, error) {
	random := make([]byte, sessionTokenIDBytes)
	if _, err := rand.Read(random); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(random), nil
}

type invalidSessionTokenStore struct{}

func (invalidSessionTokenStore) Register(string, uint, time.Time) error {
	return ErrSessionInvalid
}

func (invalidSessionTokenStore) Accept(string, uint, time.Time) error {
	return ErrSessionInvalid
}

func (invalidSessionTokenStore) Revoke(string) error {
	return ErrSessionInvalid
}

type memorySessionTokenStore struct {
	mu     sync.Mutex
	tokens map[string]memorySessionToken
}

type memorySessionToken struct {
	userID    uint
	expiresAt time.Time
}

func newMemorySessionTokenStore() *memorySessionTokenStore {
	return &memorySessionTokenStore{tokens: make(map[string]memorySessionToken)}
}

func (s *memorySessionTokenStore) Register(jti string, userID uint, expiresAt time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.prune(time.Now().UTC())
	s.tokens[jti] = memorySessionToken{userID: userID, expiresAt: expiresAt.UTC()}
	return nil
}

func (s *memorySessionTokenStore) Accept(jti string, userID uint, now time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.prune(now)
	token, ok := s.tokens[jti]
	if !ok || token.userID != userID || now.After(token.expiresAt.Add(sessionClockSkew)) {
		return ErrSessionInvalid
	}
	return nil
}

func (s *memorySessionTokenStore) Revoke(jti string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.tokens[jti]; !ok {
		return ErrSessionInvalid
	}
	delete(s.tokens, jti)
	return nil
}

func (s *memorySessionTokenStore) prune(now time.Time) {
	for jti, token := range s.tokens {
		if now.After(token.expiresAt.Add(sessionClockSkew)) {
			delete(s.tokens, jti)
		}
	}
}

type dbSessionTokenStore struct {
	DB *gorm.DB
}

func (s dbSessionTokenStore) Register(jti string, userID uint, expiresAt time.Time) error {
	if s.DB == nil {
		return ErrSessionInvalid
	}
	now := time.Now().UTC()
	if err := s.DB.Where("expires_at < ?", now.Add(-sessionClockSkew)).Delete(&models.SessionToken{}).Error; err != nil {
		return err
	}
	return s.DB.Create(&models.SessionToken{
		JTI:        jti,
		UserID:     userID,
		ExpiresAt:  expiresAt.UTC(),
		LastSeenAt: &now,
	}).Error
}

func (s dbSessionTokenStore) Accept(jti string, userID uint, now time.Time) error {
	if s.DB == nil {
		return ErrSessionInvalid
	}
	result := s.DB.Model(&models.SessionToken{}).
		Where("jti = ? AND user_id = ? AND revoked_at IS NULL", jti, userID).
		Where("expires_at > ?", now.Add(-sessionClockSkew)).
		Update("last_seen_at", now.UTC())
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrSessionInvalid
	}
	return nil
}

func (s dbSessionTokenStore) Revoke(jti string) error {
	if s.DB == nil {
		return ErrSessionInvalid
	}
	now := time.Now().UTC()
	result := s.DB.Model(&models.SessionToken{}).
		Where("jti = ? AND revoked_at IS NULL", jti).
		Update("revoked_at", now)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrSessionInvalid
	}
	return nil
}

func ParseUintID(value string) (uint, error) {
	parsed, err := strconv.ParseUint(strings.TrimSpace(value), 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid id")
	}
	return uint(parsed), nil
}
