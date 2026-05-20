package httpapi

import (
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"gptmail/internal/auth"
	"gptmail/internal/models"

	"github.com/gin-gonic/gin"
	"golang.org/x/time/rate"
	"gorm.io/gorm"
)

const userContext = "user"
const apiKeyUserContext = "api_key_user"

func (h *Handler) loadSession() gin.HandlerFunc {
	return func(c *gin.Context) {
		cookie, err := c.Cookie("gptmail_session")
		if err != nil || cookie == "" {
			c.Next()
			return
		}
		claims, err := h.Sessions.Verify(cookie)
		if err != nil {
			log.Println("session verify failed:", err)
			c.SetCookie("gptmail_session", "", -1, "/", "", false, true)
			c.Next()
			return
		}
		var user models.User
		if err := h.DB.First(&user, "id = ? AND enabled = ?", claims.UserID, true).Error; err == nil {
			c.Set(userContext, &user)
		} else {
			c.SetCookie("gptmail_session", "", -1, "/", "", false, true)
		}
		c.Next()
	}
}

func (h *Handler) optionalAPIKey() gin.HandlerFunc {
	return func(c *gin.Context) {
		if isPublicDocsPath(c.Request.URL.Path) || isPublicSharedPath(c.Request.URL.Path) || isSessionOnlyStreamPath(c.Request.URL.Path) || isSessionOnlyManagementPath(c.Request.URL.Path) {
			c.Next()
			return
		}
		plain := strings.TrimSpace(c.GetHeader("X-API-Key"))
		if plain == "" && h.Config.AllowAPIKeyQueryParam {
			plain = strings.TrimSpace(c.Query("api_key"))
			if plain != "" {
				c.Header("X-API-Key-Warning", "query-string-detected")
			}
		}
		if plain == "" {
			c.Next()
			return
		}
		key, err := h.APIKeys.Authenticate(plain)
		if err != nil {
			status := http.StatusUnauthorized
			if errors.Is(err, auth.ErrAPIKeyDisabled) || errors.Is(err, auth.ErrAPIKeyExpired) {
				status = http.StatusForbidden
			}
			fail(c, status, err.Error())
			c.Abort()
			return
		}
		if key.OwnerID != nil {
			var owner models.User
			if err := h.DB.First(&owner, "id = ? AND enabled = ?", *key.OwnerID, true).Error; err != nil {
				fail(c, http.StatusForbidden, "api key owner disabled or not found")
				c.Abort()
				return
			}
			c.Set(apiKeyUserContext, &owner)
		}
		if err := h.APIKeys.Consume(key); err != nil {
			status := http.StatusTooManyRequests
			if errors.Is(err, auth.ErrAPIKeyDisabled) || errors.Is(err, auth.ErrAPIKeyExpired) {
				status = http.StatusForbidden
			} else if errors.Is(err, auth.ErrAPIKeyMissing) || errors.Is(err, auth.ErrAPIKeyInvalid) {
				status = http.StatusUnauthorized
			}
			fail(c, status, err.Error())
			c.Abort()
			return
		}
		var ownerID *uint
		if key.OwnerID != nil {
			ownerID = key.OwnerID
		}
		h.DB.Create(&models.APIUsageLog{
			APIKeyID:  &key.ID,
			UserID:    ownerID,
			Path:      c.Request.URL.Path,
			Method:    c.Request.Method,
			IP:        c.ClientIP(),
			UserAgent: c.Request.UserAgent(),
		})
		c.Set(apiKeyContext, key)
		c.Next()
	}
}

func isPublicDocsPath(path string) bool {
	switch path {
	case "/api/docs.md", "/api/skill.md", "/api/openapi.json", "/api/openapi.yaml":
		return true
	default:
		return false
	}
}

func isPublicSharedPath(path string) bool {
	return strings.HasPrefix(path, "/api/shared/")
}

func isSessionOnlyStreamPath(path string) bool {
	switch path {
	case "/api/inbox-stream", "/api/notification-stream", "/api/announcement-stream":
		return true
	default:
		return false
	}
}

func isSessionOnlyManagementPath(path string) bool {
	return strings.HasPrefix(path, "/api/webhooks") || strings.HasPrefix(path, "/api/share-links")
}

func (h *Handler) securityHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-Frame-Options", "DENY")
		c.Header("X-XSS-Protection", "0")
		c.Header("Referrer-Policy", "strict-origin-when-cross-origin")
		c.Header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		c.Header("Content-Security-Policy", "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src 'self' https://challenges.cloudflare.com; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'")
		c.Next()
	}
}

func (h *Handler) cors() gin.HandlerFunc {
	return func(c *gin.Context) {
		if h.Config.AllowedOrigin != "" {
			c.Header("Access-Control-Allow-Origin", h.Config.AllowedOrigin)
			c.Header("Access-Control-Allow-Credentials", "true")
			c.Header("Vary", "Origin")
			c.Header("Access-Control-Allow-Headers", "Content-Type, X-API-Key, X-Admin-Token")
			c.Header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
			if c.Request.Method == http.MethodOptions {
				c.AbortWithStatus(http.StatusNoContent)
				return
			}
		}
		c.Next()
	}
}

func (h *Handler) perAPIRateLimit(limit rate.Limit, burst int) gin.HandlerFunc {
	return func(c *gin.Context) {
		identifier := h.rateLimitSubject(c)
		if identifier == "" {
			c.Next()
			return
		}
		if !h.ensureRateLimiter().allow("api:"+identifier+":"+rateLimitRoute(c), limit, burst) {
			fail(c, http.StatusTooManyRequests, "rate limit exceeded")
			c.Abort()
			return
		}
		c.Next()
	}
}

func (h *Handler) perIPRateLimit(limit rate.Limit, burst int) gin.HandlerFunc {
	return func(c *gin.Context) {
		identifier := "ip:" + c.ClientIP()
		if !h.ensureRateLimiter().allow(identifier+":"+rateLimitRoute(c), limit, burst) {
			fail(c, http.StatusTooManyRequests, "rate limit exceeded")
			c.Abort()
			return
		}
		c.Next()
	}
}

func (h *Handler) ensureRateLimiter() *rateLimiter {
	h.rateLimiterOnce.Do(func() {
		if h.RateLimiter == nil {
			h.RateLimiter = NewRateLimiter()
		}
	})
	return h.RateLimiter
}

func (h *Handler) rateLimitSubject(c *gin.Context) string {
	if key := currentAPIKey(c); key != nil {
		return fmt.Sprintf("key:%d", key.ID)
	}
	if user := currentUser(c); user != nil {
		return fmt.Sprintf("user:%d", user.ID)
	}
	return "ip:" + c.ClientIP()
}

func rateLimitRoute(c *gin.Context) string {
	if path := c.FullPath(); path != "" {
		return c.Request.Method + ":" + path
	}
	return c.Request.Method + ":" + c.Request.URL.Path
}

func (h *Handler) requireAdmin(c *gin.Context) bool {
	if user := currentUser(c); user != nil && user.Role == models.UserRoleAdmin {
		return true
	}
	if h.Config.AdminToken != "" && c.GetHeader("X-Admin-Token") == h.Config.AdminToken {
		return true
	}
	fail(c, http.StatusForbidden, "admin token required")
	return false
}

func (h *Handler) requireLogin(c *gin.Context) (*models.User, bool) {
	user := currentUser(c)
	if user == nil {
		fail(c, http.StatusUnauthorized, "login required")
		return nil, false
	}
	return user, true
}

func currentUser(c *gin.Context) *models.User {
	value, exists := c.Get(userContext)
	if !exists {
		return nil
	}
	user, _ := value.(*models.User)
	return user
}

func (h *Handler) consumeUserQuota(c *gin.Context) bool {
	user := currentUser(c)
	if user == nil || user.Role == models.UserRoleAdmin {
		return true
	}
	now := time.Now()
	result := h.DB.Model(&models.User{}).
		Where("id = ? AND enabled = ?", user.ID, true).
		Where("(total_limit = 0 OR total_used < total_limit)").
		Updates(map[string]interface{}{
			"used_today":   gorm.Expr("CASE WHEN last_used_at IS NULL OR DATE(last_used_at) != DATE(?) THEN 1 ELSE used_today + 1 END", now),
			"total_used":   gorm.Expr("total_used + 1"),
			"last_used_at": now,
		})
	if result.Error != nil {
		fail(c, http.StatusInternalServerError, result.Error.Error())
		return false
	}
	if result.RowsAffected == 0 {
		var fresh models.User
		if err := h.DB.First(&fresh, "id = ?", user.ID).Error; err == nil {
			if fresh.TotalLimit > 0 && fresh.TotalUsed >= fresh.TotalLimit {
				fail(c, http.StatusTooManyRequests, "user total quota exceeded")
				return false
			}
		}
		fail(c, http.StatusTooManyRequests, "user quota exceeded")
		return false
	}
	if err := h.DB.First(user, "id = ?", user.ID).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return false
	}
	go func() {
		defer func() { recover() }()
		h.DB.Create(&models.APIUsageLog{
			UserID:    &user.ID,
			Path:      c.Request.URL.Path,
			Method:    c.Request.Method,
			IP:        c.ClientIP(),
			UserAgent: c.Request.UserAgent(),
		})
	}()
	return true
}

func currentAPIKey(c *gin.Context) *models.APIKey {
	value, exists := c.Get(apiKeyContext)
	if !exists {
		return nil
	}
	key, _ := value.(*models.APIKey)
	return key
}

func currentAPIKeyUser(c *gin.Context) *models.User {
	value, exists := c.Get(apiKeyUserContext)
	if !exists {
		return nil
	}
	user, _ := value.(*models.User)
	return user
}
