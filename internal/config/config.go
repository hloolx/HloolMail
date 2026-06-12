package config

import (
	"bufio"
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

const InsecureDefaultSecret = "change-this-in-production"
const minProductionSecretLength = 16

const (
	DefaultSQLiteDatabaseURL       = "storage/hlool-mail.db"
	LegacySQLiteDatabaseURL        = "storage/gptmail.db"
	DefaultDockerSQLiteDatabaseURL = "/app/storage/hlool-mail.db"
	LegacyDockerSQLiteDatabaseURL  = "/app/storage/gptmail.db"
)

const (
	PublicIndexingNone    = "none"
	PublicIndexingLanding = "landing"
	PublicIndexingDocs    = "docs"
)

type Config struct {
	HTTPAddr                           string
	SMTPAddr                           string
	PublicBaseURL                      string
	PublicIndexing                     string
	MailHostname                       string
	ExpectedMX                         string
	MXStrict                           bool
	DatabaseDriver                     string
	DatabaseURL                        string
	DBMaxOpenConns                     int
	DBMaxIdleConns                     int
	MaxMessageBytes                    int64
	MaxAttachmentBytes                 int64
	MessageRetention                   time.Duration
	AdminToken                         string
	AllowLegacyAdminToken              bool
	DevMode                            bool
	AllowedOrigin                      string
	InboxTokenSecret                   string
	SessionSecret                      string
	FrontendDist                       string
	EnvPath                            string
	APIKeyDefaultDailyCap              int64
	AllowAPIKeyQueryParam              bool
	AuditLogRetentionDays              int
	AuditActivityRetentionDays         int
	WebhooksEnabled                    bool
	MetricsEnabled                     bool
	DisablePendingDomainDataProtection bool
	GitHubOAuth                        OAuthProviderConfig
	LinuxDoOAuth                       OAuthProviderConfig
}

type OAuthProviderConfig struct {
	ClientID     string
	ClientSecret string
	RedirectURL  string
	Enabled      bool
}

func Load() Config {
	loadEnvFiles(".env", "config.env")
	if envPath := strings.TrimSpace(os.Getenv("CONFIG_ENV_PATH")); envPath != "" && envPath != ".env" && envPath != "config.env" {
		loadEnvFiles(envPath)
	}
	retentionHours := getInt("MESSAGE_RETENTION_HOURS", 24)
	maxMessageBytes := getInt64("MAX_MESSAGE_BYTES", 10*1024*1024)
	gitHubOAuth := loadOAuthProviderConfig("GITHUB")
	linuxDoOAuth := loadOAuthProviderConfig("LINUXDO")
	return Config{
		HTTPAddr:                           getEnv("HTTP_ADDR", ":3000"),
		SMTPAddr:                           getEnv("SMTP_ADDR", ":2525"),
		PublicBaseURL:                      getEnv("PUBLIC_BASE_URL", "http://localhost:3000"),
		PublicIndexing:                     NormalizePublicIndexing(getEnv("PUBLIC_INDEXING", PublicIndexingLanding)),
		MailHostname:                       getEnv("MAIL_HOSTNAME", "mail.example.com"),
		ExpectedMX:                         strings.TrimSuffix(strings.ToLower(getEnv("EXPECTED_MX", "mail.example.com")), "."),
		MXStrict:                           getBool("MX_STRICT", false),
		DatabaseDriver:                     strings.ToLower(getEnv("DATABASE_DRIVER", "sqlite")),
		DatabaseURL:                        getEnv("DATABASE_URL", DefaultSQLiteDatabaseURL),
		DBMaxOpenConns:                     getInt("DB_MAX_OPEN_CONNS", 25),
		DBMaxIdleConns:                     getInt("DB_MAX_IDLE_CONNS", 5),
		MaxMessageBytes:                    maxMessageBytes,
		MaxAttachmentBytes:                 getInt64("MAX_ATTACHMENT_BYTES", maxMessageBytes),
		MessageRetention:                   time.Duration(retentionHours) * time.Hour,
		AdminToken:                         getEnv("ADMIN_TOKEN", ""),
		AllowLegacyAdminToken:              getBool("ALLOW_LEGACY_ADMIN_TOKEN", false),
		DevMode:                            getBool("DEV_MODE", false),
		AllowedOrigin:                      getEnv("ALLOWED_ORIGIN", ""),
		InboxTokenSecret:                   getEnv("INBOX_TOKEN_SECRET", InsecureDefaultSecret),
		SessionSecret:                      getEnv("SESSION_SECRET", ""),
		FrontendDist:                       getEnv("FRONTEND_DIST", "web/dist"),
		EnvPath:                            getEnv("CONFIG_ENV_PATH", ".env"),
		APIKeyDefaultDailyCap:              getInt64("API_KEY_DEFAULT_DAILY_LIMIT", 200000),
		AllowAPIKeyQueryParam:              getBool("ALLOW_API_KEY_QUERY_PARAM", false),
		AuditLogRetentionDays:              getInt("AUDIT_LOG_RETENTION_DAYS", 180),
		AuditActivityRetentionDays:         getInt("AUDIT_ACTIVITY_RETENTION_DAYS", 30),
		WebhooksEnabled:                    getBool("WEBHOOKS_ENABLED", true),
		MetricsEnabled:                     getBool("METRICS_ENABLED", false),
		DisablePendingDomainDataProtection: getBool("DISABLE_PENDING_DOMAIN_DATA_PROTECTION", false),
		GitHubOAuth:                        gitHubOAuth,
		LinuxDoOAuth:                       linuxDoOAuth,
	}
}

func (c Config) Validate() []error {
	var errs []error
	if err := validateListenAddr("HTTP_ADDR", c.HTTPAddr); err != nil {
		errs = append(errs, err)
	}
	if err := validateListenAddr("SMTP_ADDR", c.SMTPAddr); err != nil {
		errs = append(errs, err)
	}
	if err := validateAbsoluteURL("PUBLIC_BASE_URL", c.PublicBaseURL); err != nil {
		errs = append(errs, err)
	}
	if strings.TrimSpace(c.AllowedOrigin) != "" {
		if err := validateAbsoluteURL("ALLOWED_ORIGIN", c.AllowedOrigin); err != nil {
			errs = append(errs, err)
		}
	}
	driver := strings.ToLower(strings.TrimSpace(c.DatabaseDriver))
	if strings.HasPrefix(strings.TrimSpace(c.DatabaseURL), "postgres://") || strings.HasPrefix(strings.TrimSpace(c.DatabaseURL), "postgresql://") {
		driver = "postgres"
	}
	switch driver {
	case "sqlite", "sqlite3", "postgres", "postgresql", "":
	default:
		errs = append(errs, fmt.Errorf("DATABASE_DRIVER unsupported: %q", c.DatabaseDriver))
	}
	if strings.TrimSpace(c.DatabaseURL) == "" {
		errs = append(errs, fmt.Errorf("DATABASE_URL must not be empty"))
	}
	if c.DBMaxOpenConns < 1 {
		errs = append(errs, fmt.Errorf("DB_MAX_OPEN_CONNS must be at least 1"))
	}
	if c.DBMaxIdleConns < 0 {
		errs = append(errs, fmt.Errorf("DB_MAX_IDLE_CONNS must not be negative"))
	}
	if isPostgresDriver(driver) && c.DBMaxIdleConns > c.DBMaxOpenConns {
		errs = append(errs, fmt.Errorf("DB_MAX_IDLE_CONNS must be less than or equal to DB_MAX_OPEN_CONNS"))
	}
	if c.MaxMessageBytes <= 0 {
		errs = append(errs, fmt.Errorf("MAX_MESSAGE_BYTES must be greater than 0"))
	}
	if c.MaxAttachmentBytes < 0 {
		errs = append(errs, fmt.Errorf("MAX_ATTACHMENT_BYTES must not be negative"))
	}
	if c.MaxAttachmentBytes > c.MaxMessageBytes {
		errs = append(errs, fmt.Errorf("MAX_ATTACHMENT_BYTES must be less than or equal to MAX_MESSAGE_BYTES"))
	}
	if c.MessageRetention <= 0 {
		errs = append(errs, fmt.Errorf("MESSAGE_RETENTION_HOURS must be greater than 0"))
	}
	if c.APIKeyDefaultDailyCap < 0 {
		errs = append(errs, fmt.Errorf("API_KEY_DEFAULT_DAILY_LIMIT must not be negative"))
	}
	if c.AuditLogRetentionDays <= 0 {
		errs = append(errs, fmt.Errorf("AUDIT_LOG_RETENTION_DAYS must be greater than 0"))
	}
	if c.AuditActivityRetentionDays <= 0 {
		errs = append(errs, fmt.Errorf("AUDIT_ACTIVITY_RETENTION_DAYS must be greater than 0"))
	}
	return errs
}

func isPostgresDriver(driver string) bool {
	switch strings.ToLower(strings.TrimSpace(driver)) {
	case "postgres", "postgresql":
		return true
	default:
		return false
	}
}

func validateListenAddr(name, value string) error {
	value = strings.TrimSpace(value)
	if value == "" {
		return fmt.Errorf("%s must not be empty", name)
	}
	if _, port, err := net.SplitHostPort(value); err == nil {
		if _, err := strconv.Atoi(port); err != nil {
			return fmt.Errorf("%s has invalid port %q", name, port)
		}
		return nil
	}
	if _, err := strconv.Atoi(value); err == nil {
		return fmt.Errorf("%s must include a host separator, for example :%s", name, value)
	}
	return fmt.Errorf("%s must be a valid host:port listen address", name)
}

func validateAbsoluteURL(name, value string) error {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return fmt.Errorf("%s must be an absolute URL", name)
	}
	switch strings.ToLower(parsed.Scheme) {
	case "http", "https":
		return nil
	default:
		return fmt.Errorf("%s must use http or https scheme", name)
	}
}

func NormalizePublicIndexing(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case PublicIndexingNone:
		return PublicIndexingNone
	case PublicIndexingDocs:
		return PublicIndexingDocs
	default:
		return PublicIndexingLanding
	}
}

func loadOAuthProviderConfig(prefix string) OAuthProviderConfig {
	clientID := getEnv(prefix+"_OAUTH_CLIENT_ID", "")
	clientSecret := getEnv(prefix+"_OAUTH_CLIENT_SECRET", "")
	return OAuthProviderConfig{
		ClientID:     clientID,
		ClientSecret: clientSecret,
		RedirectURL:  getEnv(prefix+"_OAUTH_REDIRECT_URL", ""),
		Enabled:      getBool(prefix+"_OAUTH_ENABLED", clientID != "" && clientSecret != ""),
	}
}

func (c Config) ValidateSessionSecret(installed bool) error {
	if c.DevMode || !installed {
		return nil
	}
	if IsInsecureSecret(c.SessionSecret) {
		return fmt.Errorf("SESSION_SECRET must be set to a unique random value before starting production; run install or set SESSION_SECRET")
	}
	if IsInsecureSecret(c.InboxTokenSecret) {
		return fmt.Errorf("INBOX_TOKEN_SECRET must be set to a unique random value before starting production; run install or set INBOX_TOKEN_SECRET")
	}
	if c.SessionSecret == c.InboxTokenSecret {
		return fmt.Errorf("SESSION_SECRET must differ from INBOX_TOKEN_SECRET; each service needs its own secret")
	}
	return nil
}

func IsInsecureSecret(secret string) bool {
	trimmed := strings.TrimSpace(secret)
	if len(trimmed) < minProductionSecretLength {
		return true
	}
	switch trimmed {
	case "", InsecureDefaultSecret, "change-this-too", "replace-with-a-long-random-secret", "replace-with-another-long-random-secret":
		return true
	default:
		return false
	}
}

func loadEnvFiles(paths ...string) {
	for _, path := range paths {
		file, err := os.Open(path)
		if err != nil {
			continue
		}
		scanner := bufio.NewScanner(file)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line == "" || strings.HasPrefix(line, "#") || !strings.Contains(line, "=") {
				continue
			}
			key, value, _ := strings.Cut(line, "=")
			key = strings.TrimSpace(key)
			value = strings.Trim(strings.TrimSpace(value), `"'`)
			if key != "" && os.Getenv(key) == "" {
				_ = os.Setenv(key, value)
			}
		}
		_ = file.Close()
	}
}

func getEnv(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func getBool(key string, fallback bool) bool {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func getInt(key string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		slog.Warn("invalid integer configuration, using fallback", "key", key, "value", value, "fallback", fallback, "error", err)
		return fallback
	}
	return parsed
}

func getInt64(key string, fallback int64) int64 {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		slog.Warn("invalid integer configuration, using fallback", "key", key, "value", value, "fallback", fallback, "error", err)
		return fallback
	}
	return parsed
}
