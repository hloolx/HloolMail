package httpapi

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"gptmail/internal/auth"
	"gptmail/internal/config"
	appdb "gptmail/internal/db"
	"gptmail/internal/models"

	"github.com/gin-gonic/gin"
)

const sessionCookieName = "gptmail_session"

func (h *Handler) installStatus(c *gin.Context) {
	var apiUsageToday, registeredUsers, hostedDomains int64
	h.DB.Model(&models.APIUsageLog{}).Where("created_at >= ?", startOfDay(time.Now())).Count(&apiUsageToday)
	h.DB.Model(&models.User{}).Count(&registeredUsers)
	h.DB.Model(&models.Domain{}).Count(&hostedDomains)
	configLocked := h.installRuntimeConfigLocked()

	ok(c, gin.H{
		"installed":            h.isInstalled(),
		"site_api_calls_today": apiUsageToday,
		"registered_users":     registeredUsers,
		"hosted_domains":       hostedDomains,
		"config": gin.H{
			"http_addr":       h.Config.HTTPAddr,
			"smtp_addr":       h.Config.SMTPAddr,
			"public_base_url": h.Config.PublicBaseURL,
			"mail_hostname":   h.Config.MailHostname,
			"expected_mx":     h.Config.ExpectedMX,
			"database_driver": h.Config.DatabaseDriver,
			"database_url":    maskDSN(h.Config.DatabaseURL),
		},
		"deployment": gin.H{
			"kind":               deploymentKind(),
			"container":          isContainerRuntime(),
			"config_locked":      configLocked,
			"config_lock_reason": configLockReason(configLocked),
		},
	})
}

func (h *Handler) install(c *gin.Context) {
	if h.isInstalled() {
		fail(c, http.StatusConflict, "already installed")
		return
	}
	var input installInput
	if err := c.ShouldBindJSON(&input); err != nil {
		fail(c, http.StatusBadRequest, "invalid json")
		return
	}
	if err := input.applyDefaults(h.Config); err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	input.preserveMaskedDatabaseURL(h.Config)
	if h.installRuntimeConfigLocked() {
		input.preserveRuntimeConfig(h.Config)
	}
	if err := input.validate(); err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	targetCfg := h.Config
	input.applyToConfig(&targetCfg)

	targetDB := h.DB
	restartRequired := targetCfg.DatabaseDriver != h.Config.DatabaseDriver || targetCfg.DatabaseURL != h.Config.DatabaseURL
	if restartRequired {
		db, err := appdb.Open(targetCfg)
		if err != nil {
			fail(c, http.StatusBadRequest, "database connection failed: "+err.Error())
			return
		}
		if err := appdb.AutoMigrate(db); err != nil {
			fail(c, http.StatusBadRequest, "database migration failed: "+err.Error())
			return
		}
		targetDB = db
	}

	hash, err := auth.HashSecret(input.AdminPassword)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	var existing int64
	targetDB.Model(&models.User{}).Where("role = ? AND enabled = ?", models.UserRoleAdmin, true).Count(&existing)
	if existing == 0 {
		admin := models.User{
			Email:      strings.ToLower(strings.TrimSpace(input.AdminEmail)),
			Role:       models.UserRoleAdmin,
			Enabled:    true,
			DailyLimit: 0,
			TotalLimit: 0,
		}
		admin.PasswordHash = hash
		if err := targetDB.Create(&admin).Error; err != nil {
			fail(c, http.StatusBadRequest, err.Error())
			return
		}
	}
	if err := writeEnvFile(h.Config.EnvPath, input); err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	if !restartRequired {
		h.Config = targetCfg
		h.Sessions = auth.NewSessionService(targetCfg.SessionSecret, h.DB)
	}
	ok(c, gin.H{"installed": true, "restart_required": restartRequired})
}

func (h *Handler) login(c *gin.Context) {
	if !h.isInstalled() {
		fail(c, http.StatusPreconditionRequired, "install required")
		return
	}
	var input struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		fail(c, http.StatusBadRequest, "invalid json")
		return
	}
	var user models.User
	if err := h.DB.Where("email = ? AND enabled = ?", strings.ToLower(strings.TrimSpace(input.Email)), true).First(&user).Error; err != nil {
		fail(c, http.StatusUnauthorized, "invalid email or password")
		return
	}
	if !auth.VerifySecret(user.PasswordHash, input.Password) {
		fail(c, http.StatusUnauthorized, "invalid email or password")
		return
	}
	token, err := h.Sessions.Create(user.ID, user.Role, 7*24*time.Hour)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	setSessionCookie(c, token, 7*24*time.Hour)
	ok(c, user)
}

func (h *Handler) register(c *gin.Context) {
	if !h.isInstalled() {
		fail(c, http.StatusPreconditionRequired, "install required")
		return
	}
	var input struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		fail(c, http.StatusBadRequest, "invalid json")
		return
	}
	email := strings.ToLower(strings.TrimSpace(input.Email))
	if !strings.Contains(email, "@") || len(input.Password) < 8 {
		fail(c, http.StatusBadRequest, "valid email and 8+ character password required")
		return
	}
	var existing int64
	if err := h.DB.Model(&models.User{}).Where("email = ?", email).Count(&existing).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	if existing > 0 {
		fail(c, http.StatusConflict, "email already registered")
		return
	}
	hash, err := auth.HashSecret(input.Password)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	user := models.User{
		Email:        email,
		PasswordHash: hash,
		Role:         models.UserRoleUser,
		Enabled:      true,
		DailyLimit:   1000,
		TotalLimit:   0,
	}
	if err := h.DB.Create(&user).Error; err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	token, err := h.Sessions.Create(user.ID, user.Role, 7*24*time.Hour)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	setSessionCookie(c, token, 7*24*time.Hour)
	ok(c, user)
}

func (h *Handler) logout(c *gin.Context) {
	if cookie, err := c.Cookie(sessionCookieName); err == nil && cookie != "" {
		_ = h.Sessions.Revoke(cookie)
	}
	setSessionCookie(c, "", -time.Hour)
	ok(c, gin.H{"logged_out": true})
}

func (h *Handler) me(c *gin.Context) {
	if !h.isInstalled() {
		ok(c, gin.H{"installed": false, "user": nil})
		return
	}
	user := currentUser(c)
	if user == nil {
		fail(c, http.StatusUnauthorized, "login required")
		return
	}
	ok(c, gin.H{"installed": true, "user": user})
}

func (h *Handler) isInstalled() bool {
	var count int64
	if err := h.DB.Model(&models.User{}).Where("role = ? AND enabled = ?", models.UserRoleAdmin, true).Count(&count).Error; err != nil {
		return false
	}
	return count > 0
}

func setSessionCookie(c *gin.Context, value string, ttl time.Duration) {
	maxAge := int(ttl.Seconds())
	if ttl < 0 {
		maxAge = -1
	}
	isSecure := c.Request.TLS != nil || strings.EqualFold(c.GetHeader("X-Forwarded-Proto"), "https")
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(sessionCookieName, value, maxAge, "/", "", isSecure, true)
}

type installInput struct {
	HTTPAddr         string `json:"http_addr"`
	SMTPAddr         string `json:"smtp_addr"`
	PublicBaseURL    string `json:"public_base_url"`
	MailHostname     string `json:"mail_hostname"`
	ExpectedMX       string `json:"expected_mx"`
	DatabaseDriver   string `json:"database_driver"`
	DatabaseURL      string `json:"database_url"`
	FrontendDist     string `json:"frontend_dist"`
	AdminEmail       string `json:"admin_email"`
	AdminPassword    string `json:"admin_password"`
	InboxTokenSecret string `json:"inbox_token_secret"`
	SessionSecret    string `json:"session_secret"`
	DevMode          bool   `json:"dev_mode"`
}

func (i *installInput) applyDefaults(cfg config.Config) error {
	if i.HTTPAddr == "" {
		i.HTTPAddr = cfg.HTTPAddr
	}
	if i.SMTPAddr == "" {
		i.SMTPAddr = cfg.SMTPAddr
	}
	if i.PublicBaseURL == "" {
		i.PublicBaseURL = cfg.PublicBaseURL
	}
	if i.MailHostname == "" {
		i.MailHostname = cfg.MailHostname
	}
	if i.ExpectedMX == "" {
		i.ExpectedMX = cfg.ExpectedMX
	}
	if i.DatabaseDriver == "" {
		i.DatabaseDriver = cfg.DatabaseDriver
	}
	if i.DatabaseURL == "" {
		i.DatabaseURL = cfg.DatabaseURL
	}
	if i.FrontendDist == "" {
		i.FrontendDist = cfg.FrontendDist
	}
	if config.IsInsecureSecret(i.InboxTokenSecret) {
		secret, err := randomInstallSecret()
		if err != nil {
			return err
		}
		i.InboxTokenSecret = secret
	}
	if config.IsInsecureSecret(i.SessionSecret) {
		secret, err := randomInstallSecret()
		if err != nil {
			return err
		}
		i.SessionSecret = secret
	}
	return nil
}

func (i installInput) validate() error {
	if !strings.Contains(i.AdminEmail, "@") {
		return fmt.Errorf("admin email required")
	}
	if len(i.AdminPassword) < 8 {
		return fmt.Errorf("admin password must be at least 8 characters")
	}
	if strings.TrimSpace(i.DatabaseURL) == "" {
		return fmt.Errorf("database url required")
	}
	if strings.TrimSpace(i.PublicBaseURL) == "" || strings.TrimSpace(i.MailHostname) == "" || strings.TrimSpace(i.ExpectedMX) == "" {
		return fmt.Errorf("public base url, mail hostname and expected mx are required")
	}
	return nil
}

func (i installInput) applyToConfig(cfg *config.Config) {
	cfg.HTTPAddr = i.HTTPAddr
	cfg.SMTPAddr = i.SMTPAddr
	cfg.PublicBaseURL = i.PublicBaseURL
	cfg.MailHostname = i.MailHostname
	cfg.ExpectedMX = strings.TrimSuffix(strings.ToLower(i.ExpectedMX), ".")
	cfg.DatabaseDriver = strings.ToLower(i.DatabaseDriver)
	cfg.DatabaseURL = i.DatabaseURL
	cfg.FrontendDist = i.FrontendDist
	cfg.InboxTokenSecret = i.InboxTokenSecret
	cfg.SessionSecret = i.SessionSecret
	cfg.DevMode = i.DevMode
}

func (i *installInput) preserveRuntimeConfig(cfg config.Config) {
	i.HTTPAddr = cfg.HTTPAddr
	i.SMTPAddr = cfg.SMTPAddr
	i.PublicBaseURL = cfg.PublicBaseURL
	i.MailHostname = cfg.MailHostname
	i.ExpectedMX = cfg.ExpectedMX
	i.DatabaseDriver = cfg.DatabaseDriver
	i.DatabaseURL = cfg.DatabaseURL
	i.FrontendDist = cfg.FrontendDist
	i.DevMode = cfg.DevMode
}

func (i *installInput) preserveMaskedDatabaseURL(cfg config.Config) {
	masked := maskDSN(cfg.DatabaseURL)
	if masked != "" && masked != cfg.DatabaseURL && i.DatabaseURL == masked {
		i.DatabaseURL = cfg.DatabaseURL
	}
}

func writeEnvFile(path string, input installInput) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil && filepath.Dir(path) != "." {
		return err
	}
	content := strings.Join([]string{
		"HTTP_ADDR=" + quoteEnv(input.HTTPAddr),
		"SMTP_ADDR=" + quoteEnv(input.SMTPAddr),
		"PUBLIC_BASE_URL=" + quoteEnv(input.PublicBaseURL),
		"MAIL_HOSTNAME=" + quoteEnv(input.MailHostname),
		"EXPECTED_MX=" + quoteEnv(input.ExpectedMX),
		"DATABASE_DRIVER=" + quoteEnv(strings.ToLower(input.DatabaseDriver)),
		"DATABASE_URL=" + quoteEnv(input.DatabaseURL),
		"FRONTEND_DIST=" + quoteEnv(input.FrontendDist),
		"DEV_MODE=" + quoteEnv(fmt.Sprintf("%t", input.DevMode)),
		"INBOX_TOKEN_SECRET=" + quoteEnv(input.InboxTokenSecret),
		"SESSION_SECRET=" + quoteEnv(input.SessionSecret),
		"",
	}, "\n")
	return os.WriteFile(path, []byte(content), 0o600)
}

func quoteEnv(value string) string {
	value = strings.ReplaceAll(value, `\`, `\\`)
	value = strings.ReplaceAll(value, `"`, `\"`)
	return `"` + value + `"`
}

func maskDSN(value string) string {
	if value == "" {
		return ""
	}
	if strings.Contains(value, "@") {
		prefix, suffix, _ := strings.Cut(value, "@")
		if strings.Contains(prefix, ":") {
			return "postgres://***:***@" + suffix
		}
	}
	// Mask file path for SQLite - show only the filename
	if !strings.Contains(value, "://") && !strings.Contains(value, "@") {
		return filepath.Base(value)
	}
	return value
}

func randomInstallSecret() (string, error) {
	secret, err := auth.GenerateSessionSecret()
	if err != nil {
		return "", fmt.Errorf("generate install secret: %w", err)
	}
	return secret, nil
}

func (h *Handler) installRuntimeConfigLocked() bool {
	if value := strings.TrimSpace(os.Getenv("HLOOLMAIL_CONFIG_LOCKED")); value != "" {
		return envFlagEnabled(value)
	}
	return isContainerRuntime()
}

func configLockReason(locked bool) string {
	if !locked {
		return ""
	}
	return "container_environment"
}

func deploymentKind() string {
	if value := strings.TrimSpace(os.Getenv("HLOOLMAIL_DEPLOYMENT")); value != "" {
		return strings.ToLower(value)
	}
	if isContainerRuntime() {
		return "container"
	}
	return "native"
}

func isContainerRuntime() bool {
	if value := strings.TrimSpace(os.Getenv("HLOOLMAIL_DEPLOYMENT")); strings.EqualFold(value, "docker") || strings.EqualFold(value, "container") {
		return true
	}
	if value := strings.TrimSpace(os.Getenv("HLOOLMAIL_CONTAINER")); envFlagEnabled(value) {
		return true
	}
	if _, err := os.Stat("/.dockerenv"); err == nil {
		return true
	}
	for _, path := range []string{"/proc/1/cgroup", "/proc/self/cgroup"} {
		content, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		text := strings.ToLower(string(content))
		if strings.Contains(text, "docker") || strings.Contains(text, "kubepods") || strings.Contains(text, "containerd") {
			return true
		}
	}
	return false
}

func envFlagEnabled(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "yes", "on", "docker", "container":
		return true
	default:
		return false
	}
}
