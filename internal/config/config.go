package config

import (
	"bufio"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

const InsecureDefaultSecret = "change-this-in-production"
const minProductionSecretLength = 16

type Config struct {
	HTTPAddr                           string
	SMTPAddr                           string
	PublicBaseURL                      string
	MailHostname                       string
	ExpectedMX                         string
	MXStrict                           bool
	DatabaseDriver                     string
	DatabaseURL                        string
	MaxMessageBytes                    int64
	MaxAttachmentBytes                 int64
	MessageRetention                   time.Duration
	AdminToken                         string
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
		MailHostname:                       getEnv("MAIL_HOSTNAME", "mail.example.com"),
		ExpectedMX:                         strings.TrimSuffix(strings.ToLower(getEnv("EXPECTED_MX", "mail.example.com")), "."),
		MXStrict:                           getBool("MX_STRICT", false),
		DatabaseDriver:                     strings.ToLower(getEnv("DATABASE_DRIVER", "sqlite")),
		DatabaseURL:                        getEnv("DATABASE_URL", "storage/hlool-mail.db"),
		MaxMessageBytes:                    maxMessageBytes,
		MaxAttachmentBytes:                 getInt64("MAX_ATTACHMENT_BYTES", maxMessageBytes),
		MessageRetention:                   time.Duration(retentionHours) * time.Hour,
		AdminToken:                         getEnv("ADMIN_TOKEN", ""),
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
		DisablePendingDomainDataProtection: getBool("DISABLE_PENDING_DOMAIN_DATA_PROTECTION", false),
		GitHubOAuth:                        gitHubOAuth,
		LinuxDoOAuth:                       linuxDoOAuth,
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
		return fallback
	}
	return parsed
}
