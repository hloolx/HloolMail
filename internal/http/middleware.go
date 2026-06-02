package httpapi

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"gptmail/internal/auth"
	"gptmail/internal/config"
	"gptmail/internal/models"

	"github.com/gin-gonic/gin"
	"golang.org/x/time/rate"
	"gorm.io/gorm"
)

const userContext = "user"
const apiKeyUserContext = "api_key_user"
const noIndexRobotsTag = "noindex, nofollow, noarchive"

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
		// These paths are intentionally outside API-key automation. Ignore any
		// X-API-Key header so public docs/share reads and Web Console session
		// routes do not consume API-key quota or create APIUsageLog rows.
		if isPublicDocsPath(c.Request.URL.Path) || isPublicSharedPath(c.Request.URL.Path) || isYYDSCompatibilityPath(c.Request.URL.Path) || isSessionOnlyWebPath(c.Request.URL.Path) || isSessionOnlyManagementPath(c.Request.URL.Path) {
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
		if !h.authenticateAPIKeyRequest(c, plain) {
			c.Abort()
			return
		}
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

func isYYDSCompatibilityPath(path string) bool {
	return path == "/yyds/v1" || strings.HasPrefix(path, "/yyds/v1/")
}

func isSessionOnlyStreamPath(path string) bool {
	// SSE is browser-console realtime only. Automation should use Webhooks.
	switch path {
	case "/api/inbox-stream", "/api/notification-stream", "/api/announcement-stream":
		return true
	default:
		return false
	}
}

func isSessionOnlyNotificationPath(path string) bool {
	return path == "/api/notifications" || strings.HasPrefix(path, "/api/notifications/")
}

func isSessionOnlyWebPath(path string) bool {
	return isSessionOnlyStreamPath(path) ||
		isSessionOnlyNotificationPath(path) ||
		isSessionOnlyAnnouncementPath(path) ||
		isSessionOnlyStatsPath(path) ||
		isSessionOnlyDomainPath(path) ||
		isSessionOnlyVersionCheckPath(path)
}

func isSessionOnlyAnnouncementPath(path string) bool {
	return path == "/api/announcements" || strings.HasPrefix(path, "/api/announcements/")
}

func isSessionOnlyStatsPath(path string) bool {
	return path == "/api/stats/timeseries"
}

func isSessionOnlyDomainPath(path string) bool {
	if path == "/api/domains/available" {
		return false
	}
	return path == "/api/domains" || strings.HasPrefix(path, "/api/domains/")
}

func isSessionOnlyVersionCheckPath(path string) bool {
	return path == "/api/version/check"
}

func isSessionOnlyManagementPath(path string) bool {
	for _, prefix := range []string{
		"/api/webhooks",
		"/api/share-links",
		"/api/api-keys",
		"/api/admin",
		// Legacy user-management paths no longer route, but stale clients should
		// not burn API-key quota before receiving 404.
		"/api/users",
		"/api/user/",
		"/api/auth",
		"/api/oauth",
	} {
		if strings.HasPrefix(path, prefix) {
			return true
		}
	}
	return false
}

func (h *Handler) allowAPIKeyAuthAttempt(c *gin.Context) bool {
	limiter := h.ensureRateLimiter()
	route := rateLimitRoute(c)
	ip := c.ClientIP()
	if !limiter.allow("api-key-auth:global:"+route, rate.Limit(50), 200) {
		return false
	}
	return limiter.allow("api-key-auth:ip:"+ip+":"+route, rate.Limit(5), 20)
}

func (h *Handler) logAPIKeyAuthFailure(c *gin.Context, plain string, err error) {
	log.Printf(
		"api key auth failed: fingerprint=%s ip=%s path=%s reason=%s",
		apiKeyAttemptFingerprint(plain),
		c.ClientIP(),
		c.Request.URL.Path,
		err.Error(),
	)
}

func (h *Handler) authenticateAPIKeyRequest(c *gin.Context, plain string) bool {
	if !h.allowAPIKeyAuthAttempt(c) {
		fail(c, http.StatusTooManyRequests, "rate limit exceeded")
		return false
	}
	key, err := h.APIKeys.Authenticate(plain)
	if err != nil {
		h.logAPIKeyAuthFailure(c, plain, err)
		status := http.StatusUnauthorized
		if errors.Is(err, auth.ErrAPIKeyDisabled) || errors.Is(err, auth.ErrAPIKeyExpired) {
			status = http.StatusForbidden
		}
		fail(c, status, err.Error())
		return false
	}
	if key.OwnerID != nil {
		var owner models.User
		if err := h.DB.First(&owner, "id = ? AND enabled = ?", *key.OwnerID, true).Error; err != nil {
			fail(c, http.StatusForbidden, "api key owner disabled or not found")
			return false
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
		return false
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
	return true
}

func apiKeyAttemptFingerprint(plain string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(plain)))
	return hex.EncodeToString(sum[:])[:16]
}

func (h *Handler) securityHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-Frame-Options", "DENY")
		c.Header("X-XSS-Protection", "0")
		c.Header("Referrer-Policy", "strict-origin-when-cross-origin")
		c.Header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		c.Header("Content-Security-Policy", "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src 'self' https://challenges.cloudflare.com; style-src 'self'; img-src 'self' https: data: blob:; connect-src 'self'")
		if h.shouldNoIndexRequest(c.Request.URL) {
			c.Header("X-Robots-Tag", noIndexRobotsTag)
		}
		c.Next()
	}
}

func (h *Handler) shouldNoIndexRequest(requestURL *url.URL) bool {
	if requestURL != nil && hasSensitiveIndexingQuery(requestURL.Query()) {
		return true
	}
	pathValue := ""
	if requestURL != nil {
		pathValue = requestURL.Path
	}
	return shouldNoIndexPath(pathValue, h.publicIndexingMode())
}

func (h *Handler) publicIndexingMode() string {
	if h == nil {
		return config.PublicIndexingLanding
	}
	return config.NormalizePublicIndexing(h.Config.PublicIndexing)
}

func hasSensitiveIndexingQuery(values url.Values) bool {
	if values == nil {
		return false
	}
	for key := range values {
		switch strings.ToLower(strings.TrimSpace(key)) {
		case "key", "api_key":
			return true
		}
	}
	return false
}

func shouldNoIndexPath(pathValue, publicIndexing string) bool {
	pathValue = canonicalIndexingPath(pathValue)
	if isCrawlerResourcePath(pathValue) {
		return false
	}
	switch config.NormalizePublicIndexing(publicIndexing) {
	case config.PublicIndexingNone:
		return true
	case config.PublicIndexingDocs:
		return !isDocsIndexingPath(pathValue)
	default:
		return pathValue != "/"
	}
}

func canonicalIndexingPath(pathValue string) string {
	pathValue = strings.ToLower(strings.TrimSpace(pathValue))
	pathValue = strings.TrimRight(pathValue, "/")
	if pathValue == "" {
		return "/"
	}
	return pathValue
}

func isCrawlerResourcePath(pathValue string) bool {
	switch pathValue {
	case "/robots.txt", "/sitemap.xml", "/brand-logo.svg", "/favicon.ico", "/assets":
		return true
	default:
		return strings.HasPrefix(pathValue, "/assets/")
	}
}

func isDocsIndexingPath(pathValue string) bool {
	if pathValue == "/" {
		return true
	}
	switch pathValue {
	case "/api/health", "/api/version", "/api/docs.md", "/api/openapi.json", "/api/openapi.yaml", "/api/skill.md":
		return true
	default:
		return false
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

func (h *Handler) requireSameOriginSessionWrite() gin.HandlerFunc {
	return func(c *gin.Context) {
		if isYYDSCompatibilityPath(c.Request.URL.Path) {
			c.Next()
			return
		}
		if !isUnsafeMethod(c.Request.Method) || currentUser(c) == nil || currentAPIKey(c) != nil || h.isAdminTokenRequest(c) {
			c.Next()
			return
		}
		if h.requestHasSameOrigin(c) {
			c.Next()
			return
		}
		fail(c, http.StatusForbidden, "same-origin request required")
		c.Abort()
	}
}

func isUnsafeMethod(method string) bool {
	switch method {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return true
	default:
		return false
	}
}

func (h *Handler) requestHasSameOrigin(c *gin.Context) bool {
	if origin := strings.TrimSpace(c.GetHeader("Origin")); origin != "" {
		return h.sameOriginAllowed(c, origin)
	}
	if referer := strings.TrimSpace(c.GetHeader("Referer")); referer != "" {
		return h.sameOriginAllowed(c, referer)
	}
	return strings.EqualFold(strings.TrimSpace(c.GetHeader("Sec-Fetch-Site")), "same-origin")
}

func (h *Handler) sameOriginAllowed(c *gin.Context, raw string) bool {
	candidate, err := url.Parse(raw)
	if err != nil || candidate.Scheme == "" || candidate.Host == "" {
		return false
	}
	if base := strings.TrimSpace(h.Config.PublicBaseURL); base != "" {
		if publicURL, err := url.Parse(base); err == nil && publicURL.Scheme != "" && publicURL.Host != "" && sameOrigin(candidate, publicURL) {
			return true
		}
	}
	return sameRequestOrigin(candidate, requestOrigin(c))
}

func sameOrigin(a, b *url.URL) bool {
	return strings.EqualFold(a.Scheme, b.Scheme) && strings.EqualFold(a.Host, b.Host)
}

func sameRequestOrigin(candidate *url.URL, requestURL *url.URL) bool {
	return requestURL != nil && sameOrigin(candidate, requestURL)
}

func requestOrigin(c *gin.Context) *url.URL {
	scheme := "http"
	if c.Request.TLS != nil || strings.EqualFold(c.GetHeader("X-Forwarded-Proto"), "https") {
		scheme = "https"
	}
	host := strings.TrimSpace(c.Request.Host)
	if host == "" {
		return nil
	}
	return &url.URL{Scheme: scheme, Host: host}
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
	if h.isAdminTokenRequest(c) {
		return true
	}
	fail(c, http.StatusForbidden, "admin token required")
	return false
}

func (h *Handler) isAdminTokenRequest(c *gin.Context) bool {
	if h.Config.AdminToken == "" {
		return false
	}
	return constantTimeStringEqual(c.GetHeader("X-Admin-Token"), h.Config.AdminToken)
}

func constantTimeStringEqual(a, b string) bool {
	aHash := sha256.Sum256([]byte(a))
	bHash := sha256.Sum256([]byte(b))
	return subtle.ConstantTimeCompare(aHash[:], bHash[:]) == 1 && len(a) == len(b)
}

func (h *Handler) requireSameOriginSessionRead(c *gin.Context) bool {
	if h.requestHasSameOrigin(c) {
		return true
	}
	fail(c, http.StatusForbidden, "same-origin request required")
	return false
}

func (h *Handler) requireAdminSession(c *gin.Context) (*models.User, bool) {
	user := currentUser(c)
	if user != nil && user.Role == models.UserRoleAdmin {
		return user, true
	}
	fail(c, http.StatusForbidden, "admin login required")
	return nil, false
}

func (h *Handler) requireAdminSessionMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if _, ok := h.requireAdminSession(c); !ok {
			c.Abort()
			return
		}
		c.Next()
	}
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
	userID := user.ID
	path := c.Request.URL.Path
	method := c.Request.Method
	ip := c.ClientIP()
	userAgent := c.Request.UserAgent()
	go func() {
		defer func() {
			if recovered := recover(); recovered != nil {
				log.Printf("api usage log panic: user_id=%d path=%s method=%s panic=%v", userID, path, method, recovered)
			}
		}()
		if err := h.DB.Create(&models.APIUsageLog{
			UserID:    &userID,
			Path:      path,
			Method:    method,
			IP:        ip,
			UserAgent: userAgent,
		}).Error; err != nil {
			log.Printf("api usage log failed: user_id=%d path=%s method=%s error=%v", userID, path, method, err)
		}
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
