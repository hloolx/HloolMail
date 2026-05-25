package auth

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"gptmail/internal/models"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

var (
	ErrAPIKeyMissing  = errors.New("api key missing")
	ErrAPIKeyInvalid  = errors.New("api key invalid")
	ErrAPIKeyDisabled = errors.New("api key disabled")
	ErrAPIKeyExpired  = errors.New("api key expired")
	ErrAPIQuota       = errors.New("api key quota exceeded")
	ErrAPIDailyQuota  = apiQuotaError("api key daily quota exceeded")
	ErrAPITotalQuota  = apiQuotaError("api key total quota exceeded")
)

const apiKeyPrefixLength = 24
const defaultHashCost = 12

var hashCost atomic.Int32

func init() {
	hashCost.Store(defaultHashCost)
}

type apiQuotaError string

func (e apiQuotaError) Error() string {
	return string(e)
}

func (e apiQuotaError) Is(target error) bool {
	return target == ErrAPIQuota
}

type APIKeyService struct {
	DB *gorm.DB
}

func GenerateAPIKey() (plain string, prefix string, err error) {
	random := make([]byte, 32)
	if _, err := rand.Read(random); err != nil {
		return "", "", err
	}
	plain = "key-hloolmail-" + base64.RawURLEncoding.EncodeToString(random)
	prefix = plain
	if len(prefix) > apiKeyPrefixLength {
		prefix = prefix[:apiKeyPrefixLength]
	}
	return plain, prefix, nil
}

func HashSecret(secret string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(secret), int(hashCost.Load()))
	return string(hash), err
}

func VerifySecret(hash, secret string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(secret)) == nil
}

func SetHashCostForTesting(cost int) func() {
	previous := hashCost.Swap(int32(cost))
	return func() {
		hashCost.Store(previous)
	}
}

func (s APIKeyService) Create(name string, dailyLimit, totalLimit int64) (*models.APIKey, string, error) {
	return s.CreateFor(nil, name, dailyLimit, totalLimit, nil)
}

func (s APIKeyService) CreateFor(ownerID *uint, name string, dailyLimit, totalLimit int64, expiresAt *time.Time) (*models.APIKey, string, error) {
	plain, prefix, err := GenerateAPIKey()
	if err != nil {
		return nil, "", err
	}
	hash, err := HashSecret(plain)
	if err != nil {
		return nil, "", err
	}
	key := &models.APIKey{
		OwnerID:    ownerID,
		Name:       strings.TrimSpace(name),
		KeyPrefix:  prefix,
		KeyHash:    hash,
		KeyValue:   plain,
		Enabled:    true,
		DailyLimit: dailyLimit,
		TotalLimit: totalLimit,
		ExpiresAt:  expiresAt,
	}
	if key.Name == "" {
		key.Name = "default"
	}
	if err := s.DB.Create(key).Error; err != nil {
		return nil, "", err
	}
	return key, plain, nil
}

func (s APIKeyService) Authenticate(plain string) (*models.APIKey, error) {
	plain = strings.TrimSpace(plain)
	if plain == "" {
		return nil, ErrAPIKeyMissing
	}
	var stored models.APIKey
	err := s.DB.Where("key_value = ?", plain).First(&stored).Error
	if err == nil {
		return validateAPIKey(stored)
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	prefix := plain
	if len(prefix) > apiKeyPrefixLength {
		prefix = prefix[:apiKeyPrefixLength]
	}
	var candidates []models.APIKey
	if err := s.DB.Where("key_prefix = ?", prefix).Find(&candidates).Error; err != nil {
		return nil, err
	}
	for _, candidate := range candidates {
		if VerifySecret(candidate.KeyHash, plain) {
			return validateAPIKey(candidate)
		}
	}
	return nil, ErrAPIKeyInvalid
}

func validateAPIKey(candidate models.APIKey) (*models.APIKey, error) {
	if !candidate.Enabled {
		return nil, ErrAPIKeyDisabled
	}
	if candidate.ExpiresAt != nil && !candidate.ExpiresAt.After(time.Now()) {
		return nil, ErrAPIKeyExpired
	}
	key := candidate
	return &key, nil
}

func (s APIKeyService) Consume(key *models.APIKey) error {
	if key == nil {
		return ErrAPIKeyMissing
	}
	now := time.Now()
	result := s.DB.Model(&models.APIKey{}).
		Where("id = ? AND enabled = ?", key.ID, true).
		Where("(daily_limit = 0 OR last_used_at IS NULL OR DATE(last_used_at) != DATE(?) OR used_today < daily_limit)", now).
		Where("(total_limit = 0 OR total_used < total_limit)").
		Where("(expires_at IS NULL OR expires_at > ?)", now).
		Updates(map[string]interface{}{
			"used_today":   gorm.Expr("CASE WHEN last_used_at IS NULL OR DATE(last_used_at) != DATE(?) THEN 1 ELSE used_today + 1 END", now),
			"total_used":   gorm.Expr("total_used + 1"),
			"last_used_at": now,
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return s.consumeFailure(key.ID, now)
	}
	return s.DB.First(key, key.ID).Error
}

func (s APIKeyService) consumeFailure(keyID uint, now time.Time) error {
	var fresh models.APIKey
	if err := s.DB.First(&fresh, keyID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrAPIKeyInvalid
		}
		return err
	}
	if !fresh.Enabled {
		return ErrAPIKeyDisabled
	}
	if fresh.ExpiresAt != nil && !fresh.ExpiresAt.After(now) {
		return ErrAPIKeyExpired
	}
	if fresh.TotalLimit > 0 && fresh.TotalUsed >= fresh.TotalLimit {
		return ErrAPITotalQuota
	}
	if fresh.DailyLimit > 0 && fresh.UsedToday >= fresh.DailyLimit && fresh.LastUsedAt != nil && SameLocalDay(*fresh.LastUsedAt, now) {
		return ErrAPIDailyQuota
	}
	return ErrAPIQuota
}

func UsageFor(key *models.APIKey) map[string]string {
	if key == nil {
		return nil
	}
	remainingToday, dailyUnlimited := remainingQuota(key.DailyLimit, key.UsedToday)
	remainingTotal, totalUnlimited := remainingQuota(key.TotalLimit, key.TotalUsed)
	return map[string]string{
		"daily_limit":     strconv.FormatInt(key.DailyLimit, 10),
		"used_today":      strconv.FormatInt(key.UsedToday, 10),
		"remaining_today": remainingToday,
		"daily_unlimited": strconv.FormatBool(dailyUnlimited),
		"total_limit":     strconv.FormatInt(key.TotalLimit, 10),
		"total_usage":     strconv.FormatInt(key.TotalUsed, 10),
		"remaining_total": remainingTotal,
		"total_unlimited": strconv.FormatBool(totalUnlimited),
	}
}

func remainingQuota(limit, used int64) (string, bool) {
	if limit <= 0 {
		return "unlimited", true
	}
	remaining := limit - used
	if remaining < 0 {
		remaining = 0
	}
	return strconv.FormatInt(remaining, 10), false
}

func SameLocalDay(a, b time.Time) bool {
	ay, am, ad := a.Local().Date()
	by, bm, bd := b.Local().Date()
	return ay == by && am == bm && ad == bd
}
