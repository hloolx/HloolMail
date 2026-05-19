package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"gptmail/internal/auth"
	"gptmail/internal/config"
	appdb "gptmail/internal/db"
	appdomain "gptmail/internal/domain"
	"gptmail/internal/models"

	"github.com/gin-gonic/gin"
)

const sessionCookieName = "gptmail_session"

func (h *Handler) installStatus(c *gin.Context) {
	installed := h.isInstalled()
	if installed && currentUser(c) == nil {
		ok(c, gin.H{"installed": true})
		return
	}

	var apiUsageToday, registeredUsers, hostedDomains int64
	h.DB.Model(&models.APIUsageLog{}).Where("created_at >= ?", startOfDay(time.Now())).Count(&apiUsageToday)
	h.DB.Model(&models.User{}).Count(&registeredUsers)
	h.DB.Model(&models.Domain{}).Count(&hostedDomains)
	configLocked := h.installRuntimeConfigLocked()

	ok(c, gin.H{
		"installed":            installed,
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
			"env_path":        h.Config.EnvPath,
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
			fail(c, http.StatusBadRequest, friendlyDatabaseSetupError("connect", err, targetCfg.DatabaseURL))
			return
		}
		if err := appdb.AutoMigrate(db); err != nil {
			fail(c, http.StatusBadRequest, friendlyDatabaseSetupError("migrate", err, targetCfg.DatabaseURL))
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
	envContent := buildEnvFileContent(input)
	envWritten := true
	envError := ""
	if err := writeEnvFile(h.Config.EnvPath, envContent); err != nil {
		envWritten = false
		envError = err.Error()
	}
	if !restartRequired {
		h.Config = targetCfg
		h.Sessions = auth.NewSessionService(targetCfg.SessionSecret, h.DB)
	}
	ok(c, gin.H{
		"installed":          true,
		"restart_required":   restartRequired,
		"env_written":        envWritten,
		"env_error":          envError,
		"env_path":           h.Config.EnvPath,
		"env_content":        envContent,
		"deployment_kind":    deploymentKind(),
		"config_lock_reason": configLockReason(h.installRuntimeConfigLocked()),
	})
}

func (h *Handler) installDNSCheck(c *gin.Context) {
	var input installDNSCheckInput
	if err := c.ShouldBindJSON(&input); err != nil {
		fail(c, http.StatusBadRequest, "invalid json")
		return
	}
	input.applyDefaults(h.Config)
	if err := input.validate(); err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	if input.DevMode && strings.HasSuffix(input.Domain, ".test") {
		ok(c, gin.H{
			"verified":      true,
			"domain":        input.Domain,
			"mail_hostname": input.MailHostname,
			"expected_mx":   input.ExpectedMX,
			"message":       "开发模式已允许 .test 域名跳过外部 DNS 检测",
		})
		return
	}

	checkCtx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()

	addressCheck := checkInstallHostAddress(checkCtx, input.MailHostname, input.ServerIP)
	mxCheck, err := runInstallMXCheck(checkCtx, h.DNSChecker, input.Domain, input.ExpectedMX)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	var wildcardCheck *appdomain.CheckResult
	if input.CheckWildcard {
		result, err := runInstallMXCheck(checkCtx, h.DNSChecker, "probe-install."+input.Domain, input.ExpectedMX)
		if err != nil {
			fail(c, http.StatusBadRequest, err.Error())
			return
		}
		wildcardCheck = &result
	}

	verified := addressCheck.Verified && mxCheck.MXVerified && (!input.CheckWildcard || (wildcardCheck != nil && wildcardCheck.MXVerified))
	message := "DNS 记录还未完全生效"
	if verified {
		message = "DNS 检测通过"
	}
	ok(c, gin.H{
		"verified":       verified,
		"domain":         input.Domain,
		"mail_hostname":  input.MailHostname,
		"expected_mx":    input.ExpectedMX,
		"address_check":  addressCheck,
		"mx_check":       mxCheck,
		"wildcard_check": wildcardCheck,
		"message":        message,
	})
}

func (h *Handler) login(c *gin.Context) {
	if !h.isInstalled() {
		fail(c, http.StatusPreconditionRequired, "install required")
		return
	}
	var input struct {
		Email          string `json:"email"`
		Password       string `json:"password"`
		TurnstileToken string `json:"turnstile_token"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		fail(c, http.StatusBadRequest, "invalid json")
		return
	}
	if err := h.verifyTurnstileIfEnabled(input.TurnstileToken); err != nil {
		fail(c, http.StatusBadRequest, err.Error())
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
		Email          string `json:"email"`
		Password       string `json:"password"`
		TurnstileToken string `json:"turnstile_token"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		fail(c, http.StatusBadRequest, "invalid json")
		return
	}
	if err := h.verifyTurnstileIfEnabled(input.TurnstileToken); err != nil {
		fail(c, http.StatusBadRequest, err.Error())
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

func (h *Handler) loginSettings(c *gin.Context) {
	installed := h.isInstalled()
	response := gin.H{
		"installed": installed,
	}
	if !installed {
		ok(c, response)
		return
	}
	settings, err := appdb.EnsureLoginSettings(h.DB)
	if err != nil {
		ok(c, response)
		return
	}
	response["turnstile_enabled"] = settings.TurnstileEnabled
	response["turnstile_site_key"] = settings.TurnstileSiteKey
	response["passkey_enabled"] = settings.PasskeyEnabled

	providers := make([]oauthProviderDTO, 0, len(oauthProviderMetas()))
	for _, meta := range oauthProviderMetas() {
		cfg, ok, err := h.effectiveOAuthConfig(meta.Provider)
		if err != nil || !ok || !cfg.Enabled || !oauthConfigConfigured(cfg) {
			continue
		}
		providers = append(providers, h.oauthProviderDTO(meta, cfg, false))
	}
	response["oauth_providers"] = providers

	ok(c, response)
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
	DatabaseHost     string `json:"database_host"`
	DatabasePort     string `json:"database_port"`
	DatabaseName     string `json:"database_name"`
	DatabaseUser     string `json:"database_user"`
	DatabasePassword string `json:"database_password"`
	DatabaseSSLMode  string `json:"database_sslmode"`
	FrontendDist     string `json:"frontend_dist"`
	AdminEmail       string `json:"admin_email"`
	AdminPassword    string `json:"admin_password"`
	InboxTokenSecret string `json:"inbox_token_secret"`
	SessionSecret    string `json:"session_secret"`
	DevMode          bool   `json:"dev_mode"`
}

type installDNSCheckInput struct {
	Domain        string `json:"domain"`
	MailHostname  string `json:"mail_hostname"`
	ExpectedMX    string `json:"expected_mx"`
	ServerIP      string `json:"server_ip"`
	CheckWildcard bool   `json:"check_wildcard"`
	DevMode       bool   `json:"dev_mode"`
}

type installAddressCheck struct {
	Host       string   `json:"host"`
	ExpectedIP string   `json:"expected_ip"`
	Verified   bool     `json:"verified"`
	Addresses  []string `json:"addresses"`
	Error      string   `json:"error,omitempty"`
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
	if err := i.populateDatabaseURLFromParts(); err != nil {
		return err
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

func (i *installInput) populateDatabaseURLFromParts() error {
	driver := strings.ToLower(strings.TrimSpace(i.DatabaseDriver))
	if driver != "postgres" && driver != "postgresql" {
		return nil
	}
	if strings.TrimSpace(i.DatabaseURL) != "" {
		return nil
	}
	host := strings.TrimSpace(i.DatabaseHost)
	name := strings.TrimSpace(i.DatabaseName)
	user := strings.TrimSpace(i.DatabaseUser)
	if host == "" && name == "" && user == "" && strings.TrimSpace(i.DatabasePassword) == "" {
		return nil
	}
	if host == "" || name == "" || user == "" {
		return fmt.Errorf("database host, name and user are required for PostgreSQL")
	}
	u := url.URL{
		Scheme: "postgres",
		Host:   host,
		Path:   "/" + strings.TrimPrefix(name, "/"),
	}
	if port := strings.TrimSpace(i.DatabasePort); port != "" {
		u.Host = net.JoinHostPort(host, port)
	}
	u.User = url.UserPassword(user, i.DatabasePassword)
	query := u.Query()
	sslMode := strings.TrimSpace(i.DatabaseSSLMode)
	if sslMode == "" {
		sslMode = "disable"
	}
	query.Set("sslmode", sslMode)
	u.RawQuery = query.Encode()
	i.DatabaseURL = u.String()
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
	if strings.Contains(i.DatabaseURL, "***") {
		return fmt.Errorf("database credentials are masked; enter the database password or keep the existing runtime config")
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

func (i *installDNSCheckInput) applyDefaults(cfg config.Config) {
	i.Domain = appdomain.NormalizeDomain(i.Domain)
	i.MailHostname = appdomain.NormalizeDomain(firstInstallValue(i.MailHostname, cfg.MailHostname))
	i.ExpectedMX = appdomain.NormalizeDomain(firstInstallValue(i.ExpectedMX, i.MailHostname, cfg.ExpectedMX))
	i.ServerIP = strings.TrimSpace(i.ServerIP)
	if i.Domain == "" {
		i.Domain = rootDomainGuess(i.MailHostname)
	}
}

func (i installDNSCheckInput) validate() error {
	if i.Domain == "" || !strings.Contains(i.Domain, ".") {
		return fmt.Errorf("domain is required for DNS verification")
	}
	if i.MailHostname == "" || !strings.Contains(i.MailHostname, ".") {
		return fmt.Errorf("receiving hostname is required for DNS verification")
	}
	if i.ExpectedMX == "" || !strings.Contains(i.ExpectedMX, ".") {
		return fmt.Errorf("MX target is required for DNS verification")
	}
	if strings.TrimSpace(i.ServerIP) == "" && !(i.DevMode && strings.HasSuffix(i.Domain, ".test")) {
		return fmt.Errorf("server ip is required for DNS A/AAAA verification")
	}
	return nil
}

func firstInstallValue(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func rootDomainGuess(host string) string {
	parts := strings.Split(appdomain.NormalizeDomain(host), ".")
	if len(parts) < 2 {
		return ""
	}
	return strings.Join(parts[len(parts)-2:], ".")
}

func checkInstallHostAddress(ctx context.Context, host, expectedIP string) installAddressCheck {
	check := installAddressCheck{
		Host:       host,
		ExpectedIP: expectedIP,
	}
	expected := net.ParseIP(strings.Trim(expectedIP, "[]"))
	records, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		check.Error = err.Error()
		return check
	}
	for _, record := range records {
		ip := record.IP.String()
		check.Addresses = append(check.Addresses, ip)
		if expected != nil && record.IP.Equal(expected) {
			check.Verified = true
		}
	}
	return check
}

func runInstallMXCheck(ctx context.Context, checker appdomain.DNSChecker, host, expectedMX string) (appdomain.CheckResult, error) {
	runner := checker.ProbeRunner
	if runner == nil {
		runner = appdomain.MiekgDNSProbeRunner{}
	}
	options := appdomain.DefaultCheckOptions()
	options.StrictMX = checker.Config.MXStrict
	return runner.CheckMX(ctx, host, expectedMX, options)
}

func buildEnvFileContent(input installInput) string {
	return strings.Join([]string{
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
}

func writeEnvFile(path string, content string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil && filepath.Dir(path) != "." {
		return err
	}
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

func friendlyDatabaseSetupError(stage string, err error, databaseURL string) string {
	if err == nil {
		return ""
	}
	raw := err.Error()
	lower := strings.ToLower(raw)
	prefix := "数据库连接失败"
	if stage == "migrate" {
		prefix = "数据库迁移失败"
	}
	if strings.Contains(lower, "permission denied for schema public") || strings.Contains(lower, "sqlstate 42501") {
		return prefix + "：当前数据库账号没有 PostgreSQL public schema 的建表/改表权限。请用数据库管理员密码在服务器执行下面的一键授权命令，然后回到安装页重试：\n" +
			postgresSchemaGrantCommand(databaseURL) +
			"\n如果提示 psql: command not found，先执行 find / -name psql -type f 2>/dev/null | head 查找 psql 路径；宝塔常见路径是 /www/server/pgsql/bin/psql。原始错误：" + raw
	}
	if stage == "migrate" {
		return prefix + "：程序无法自动创建或更新数据表，请检查数据库账号权限、schema 权限和连接串。原始错误：" + raw
	}
	return prefix + "：请检查数据库主机、端口、库名、账号、密码和 SSL 模式。原始错误：" + raw
}

func postgresSchemaGrantCommand(databaseURL string) string {
	dbName, dbUser := postgresDatabaseAndUser(databaseURL)
	if dbName == "" {
		dbName = "你的数据库名"
	}
	if dbUser == "" {
		dbUser = "你的数据库账号"
	}
	sql := fmt.Sprintf(
		"ALTER DATABASE %s OWNER TO %s; ALTER SCHEMA public OWNER TO %s; GRANT USAGE, CREATE ON SCHEMA public TO %s;",
		quotePostgresIdentifier(dbName),
		quotePostgresIdentifier(dbUser),
		quotePostgresIdentifier(dbUser),
		quotePostgresIdentifier(dbUser),
	)
	return "/www/server/pgsql/bin/psql -U postgres -d " + shellQuote(dbName) + " -c " + shellQuote(sql)
}

func postgresDatabaseAndUser(databaseURL string) (string, string) {
	parsed, err := url.Parse(databaseURL)
	if err != nil {
		return "", ""
	}
	if parsed.Scheme != "postgres" && parsed.Scheme != "postgresql" {
		return "", ""
	}
	return strings.TrimPrefix(parsed.Path, "/"), parsed.User.Username()
}

func quotePostgresIdentifier(value string) string {
	return `"` + strings.ReplaceAll(value, `"`, `""`) + `"`
}

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", `'\''`) + "'"
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

func (h *Handler) loginSettingsOrNil() *models.LoginSettings {
	settings, err := appdb.EnsureLoginSettings(h.DB)
	if err != nil {
		return nil
	}
	return settings
}

func (h *Handler) verifyTurnstileIfEnabled(token string) error {
	settings := h.loginSettingsOrNil()
	if settings == nil || !settings.TurnstileEnabled {
		return nil
	}
	token = strings.TrimSpace(token)
	if token == "" {
		return fmt.Errorf("turnstile verification required")
	}
	if err := verifyTurnstileToken(token, settings.TurnstileSecretKey); err != nil {
		return fmt.Errorf("turnstile verification failed: %w", err)
	}
	return nil
}

func verifyTurnstileToken(token, secretKey string) error {
	body := map[string]string{
		"secret":   secretKey,
		"response": token,
	}
	payload, _ := json.Marshal(body)
	req, err := http.NewRequest("POST", "https://challenges.cloudflare.com/turnstile/v0/siteverify", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	resp, err := oauthHTTPClient.Do(req.WithContext(ctx))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	var result struct {
		Success    bool     `json:"success"`
		ErrorCodes []string `json:"error-codes"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return err
	}
	if !result.Success {
		return fmt.Errorf("%s", strings.Join(result.ErrorCodes, ", "))
	}
	return nil
}
