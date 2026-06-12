package config

import (
	"os"
	"strings"
	"testing"
	"time"
)

func TestLoadDoesNotFallbackSessionSecretToInboxSecret(t *testing.T) {
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	temp := t.TempDir()
	if err := os.Chdir(temp); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(wd); err != nil {
			t.Fatalf("restore working directory: %v", err)
		}
	})
	t.Setenv("INBOX_TOKEN_SECRET", "inbox-secret")
	t.Setenv("SESSION_SECRET", "")

	cfg := Load()
	if cfg.SessionSecret != "" {
		t.Fatalf("session secret = %q, want empty when SESSION_SECRET is unset", cfg.SessionSecret)
	}
}

func TestLoadReadsConfiguredEnvPath(t *testing.T) {
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	temp := t.TempDir()
	if err := os.Chdir(temp); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(wd); err != nil {
			t.Fatalf("restore working directory: %v", err)
		}
	})

	envPath := temp + "/generated.env"
	if err := os.WriteFile(envPath, []byte("SESSION_SECRET=generated-session\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("CONFIG_ENV_PATH", envPath)
	t.Setenv("SESSION_SECRET", "")

	cfg := Load()
	if cfg.SessionSecret != "generated-session" {
		t.Fatalf("session secret = %q, want generated-session", cfg.SessionSecret)
	}
}

func TestLoadDisablesAPIKeyQueryParamByDefault(t *testing.T) {
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	temp := t.TempDir()
	if err := os.Chdir(temp); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(wd); err != nil {
			t.Fatalf("restore working directory: %v", err)
		}
	})
	t.Setenv("ALLOW_API_KEY_QUERY_PARAM", "")

	cfg := Load()
	if cfg.AllowAPIKeyQueryParam {
		t.Fatal("expected API key query parameter support to be disabled by default")
	}
}

func TestLoadDisablesLegacyAdminTokenByDefault(t *testing.T) {
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	temp := t.TempDir()
	if err := os.Chdir(temp); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(wd); err != nil {
			t.Fatalf("restore working directory: %v", err)
		}
	})
	t.Setenv("ADMIN_TOKEN", "legacy-token")
	t.Setenv("ALLOW_LEGACY_ADMIN_TOKEN", "")

	cfg := Load()
	if cfg.AdminToken != "legacy-token" {
		t.Fatalf("admin token = %q, want configured token", cfg.AdminToken)
	}
	if cfg.AllowLegacyAdminToken {
		t.Fatal("expected legacy admin token support to be disabled by default")
	}
}

func TestLoadCanEnableLegacyAdminToken(t *testing.T) {
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	temp := t.TempDir()
	if err := os.Chdir(temp); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(wd); err != nil {
			t.Fatalf("restore working directory: %v", err)
		}
	})
	t.Setenv("ALLOW_LEGACY_ADMIN_TOKEN", "true")

	cfg := Load()
	if !cfg.AllowLegacyAdminToken {
		t.Fatal("expected ALLOW_LEGACY_ADMIN_TOKEN=true to enable legacy admin token support")
	}
}

func TestLoadDefaultsSQLiteDatabaseURLToHloolMail(t *testing.T) {
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	temp := t.TempDir()
	if err := os.Chdir(temp); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(wd); err != nil {
			t.Fatalf("restore working directory: %v", err)
		}
	})
	t.Setenv("DATABASE_URL", "")

	cfg := Load()
	if cfg.DatabaseURL != DefaultSQLiteDatabaseURL {
		t.Fatalf("database url = %q, want %q", cfg.DatabaseURL, DefaultSQLiteDatabaseURL)
	}
}

func TestLoadReadsDatabasePoolLimits(t *testing.T) {
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	temp := t.TempDir()
	if err := os.Chdir(temp); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(wd); err != nil {
			t.Fatalf("restore working directory: %v", err)
		}
	})
	t.Setenv("DB_MAX_OPEN_CONNS", "31")
	t.Setenv("DB_MAX_IDLE_CONNS", "7")

	cfg := Load()
	if cfg.DBMaxOpenConns != 31 {
		t.Fatalf("DBMaxOpenConns = %d, want 31", cfg.DBMaxOpenConns)
	}
	if cfg.DBMaxIdleConns != 7 {
		t.Fatalf("DBMaxIdleConns = %d, want 7", cfg.DBMaxIdleConns)
	}
}

func TestLoadCanEnableAPIKeyQueryParam(t *testing.T) {
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	temp := t.TempDir()
	if err := os.Chdir(temp); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(wd); err != nil {
			t.Fatalf("restore working directory: %v", err)
		}
	})
	t.Setenv("ALLOW_API_KEY_QUERY_PARAM", "true")

	cfg := Load()
	if !cfg.AllowAPIKeyQueryParam {
		t.Fatal("expected ALLOW_API_KEY_QUERY_PARAM=true to enable query parameter support")
	}
}

func TestLoadCanDisableWebhooks(t *testing.T) {
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	temp := t.TempDir()
	if err := os.Chdir(temp); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(wd); err != nil {
			t.Fatalf("restore working directory: %v", err)
		}
	})
	t.Setenv("WEBHOOKS_ENABLED", "false")

	cfg := Load()
	if cfg.WebhooksEnabled {
		t.Fatal("expected WEBHOOKS_ENABLED=false to disable webhook delivery")
	}
}

func TestLoadDefaultsPublicIndexingToLanding(t *testing.T) {
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	temp := t.TempDir()
	if err := os.Chdir(temp); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(wd); err != nil {
			t.Fatalf("restore working directory: %v", err)
		}
	})
	t.Setenv("PUBLIC_INDEXING", "")

	cfg := Load()
	if cfg.PublicIndexing != PublicIndexingLanding {
		t.Fatalf("public indexing = %q, want %q", cfg.PublicIndexing, PublicIndexingLanding)
	}
}

func TestLoadNormalizesPublicIndexingEnv(t *testing.T) {
	for _, tc := range []struct {
		name  string
		value string
		want  string
	}{
		{name: "none", value: "none", want: PublicIndexingNone},
		{name: "docs", value: " docs ", want: PublicIndexingDocs},
		{name: "landing", value: "landing", want: PublicIndexingLanding},
		{name: "invalid", value: "true", want: PublicIndexingLanding},
	} {
		t.Run(tc.name, func(t *testing.T) {
			wd, err := os.Getwd()
			if err != nil {
				t.Fatal(err)
			}
			temp := t.TempDir()
			if err := os.Chdir(temp); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				if err := os.Chdir(wd); err != nil {
					t.Fatalf("restore working directory: %v", err)
				}
			})
			t.Setenv("PUBLIC_INDEXING", tc.value)

			cfg := Load()
			if cfg.PublicIndexing != tc.want {
				t.Fatalf("public indexing = %q, want %q", cfg.PublicIndexing, tc.want)
			}
		})
	}
}

func TestLoadEnablesWebhooksByDefault(t *testing.T) {
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	temp := t.TempDir()
	if err := os.Chdir(temp); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(wd); err != nil {
			t.Fatalf("restore working directory: %v", err)
		}
	})
	t.Setenv("WEBHOOKS_ENABLED", "")

	cfg := Load()
	if !cfg.WebhooksEnabled {
		t.Fatal("expected webhook delivery to be enabled by default")
	}
}

func TestLoadDisablesMetricsByDefaultAndCanEnable(t *testing.T) {
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	temp := t.TempDir()
	if err := os.Chdir(temp); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(wd); err != nil {
			t.Fatalf("restore working directory: %v", err)
		}
	})

	t.Setenv("METRICS_ENABLED", "")
	cfg := Load()
	if cfg.MetricsEnabled {
		t.Fatal("expected metrics endpoint to be disabled by default")
	}

	t.Setenv("METRICS_ENABLED", "true")
	cfg = Load()
	if !cfg.MetricsEnabled {
		t.Fatal("expected METRICS_ENABLED=true to enable metrics endpoint")
	}
}

func TestLoadReadsOAuthProviderEnv(t *testing.T) {
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	temp := t.TempDir()
	if err := os.Chdir(temp); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(wd); err != nil {
			t.Fatalf("restore working directory: %v", err)
		}
	})
	t.Setenv("GITHUB_OAUTH_CLIENT_ID", "github-client")
	t.Setenv("GITHUB_OAUTH_CLIENT_SECRET", "github-secret")
	t.Setenv("GITHUB_OAUTH_REDIRECT_URL", "https://example.com/api/oauth/github/callback")
	t.Setenv("LINUXDO_OAUTH_CLIENT_ID", "linuxdo-client")
	t.Setenv("LINUXDO_OAUTH_CLIENT_SECRET", "linuxdo-secret")
	t.Setenv("LINUXDO_OAUTH_ENABLED", "false")

	cfg := Load()
	if cfg.GitHubOAuth.ClientID != "github-client" || cfg.GitHubOAuth.ClientSecret != "github-secret" || !cfg.GitHubOAuth.Enabled {
		t.Fatalf("unexpected github oauth config: %+v", cfg.GitHubOAuth)
	}
	if cfg.GitHubOAuth.RedirectURL != "https://example.com/api/oauth/github/callback" {
		t.Fatalf("github redirect = %q", cfg.GitHubOAuth.RedirectURL)
	}
	if cfg.LinuxDoOAuth.ClientID != "linuxdo-client" || cfg.LinuxDoOAuth.ClientSecret != "linuxdo-secret" || cfg.LinuxDoOAuth.Enabled {
		t.Fatalf("unexpected linux.do oauth config: %+v", cfg.LinuxDoOAuth)
	}
}

func TestValidateSessionSecretRejectsWeakProductionSecretAfterInstall(t *testing.T) {
	for _, secret := range []string{"", InsecureDefaultSecret, "change-this-too", "replace-with-another-long-random-secret"} {
		cfg := Config{DevMode: false, SessionSecret: secret, InboxTokenSecret: "random-inbox-secret"}
		if err := cfg.ValidateSessionSecret(true); err == nil {
			t.Fatalf("expected production validation to reject %q", secret)
		}
	}

	cfg := Config{DevMode: false, SessionSecret: "random-production-secret", InboxTokenSecret: "random-inbox-secret"}
	if err := cfg.ValidateSessionSecret(true); err != nil {
		t.Fatalf("expected production validation to accept configured secret: %v", err)
	}
}

func TestValidateSessionSecretRejectsWeakInboxTokenSecretAfterInstall(t *testing.T) {
	for _, secret := range []string{"", InsecureDefaultSecret, "short"} {
		cfg := Config{DevMode: false, SessionSecret: "random-production-secret", InboxTokenSecret: secret}
		if err := cfg.ValidateSessionSecret(true); err == nil {
			t.Fatalf("expected production validation to reject inbox token secret %q", secret)
		}
	}

	cfg := Config{DevMode: false, SessionSecret: "same-production-secret", InboxTokenSecret: "same-production-secret"}
	if err := cfg.ValidateSessionSecret(true); err == nil {
		t.Fatal("expected production validation to reject shared session and inbox token secrets")
	}
}

func TestIsInsecureSecretRejectsShortSecrets(t *testing.T) {
	if !IsInsecureSecret("a") {
		t.Fatal("expected a one-character secret to be insecure")
	}
	if IsInsecureSecret("long-enough-secret") {
		t.Fatal("expected a long custom secret to be accepted")
	}
}

func TestValidateSessionSecretAllowsInstallAndDevMode(t *testing.T) {
	productionBeforeInstall := Config{DevMode: false, SessionSecret: ""}
	if err := productionBeforeInstall.ValidateSessionSecret(false); err != nil {
		t.Fatalf("expected pre-install production to be allowed: %v", err)
	}

	devInstalled := Config{DevMode: true, SessionSecret: InsecureDefaultSecret}
	if err := devInstalled.ValidateSessionSecret(true); err != nil {
		t.Fatalf("expected dev mode to be allowed: %v", err)
	}
}

func TestValidateAcceptsLoadedDefaults(t *testing.T) {
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	temp := t.TempDir()
	if err := os.Chdir(temp); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(wd); err != nil {
			t.Fatalf("restore working directory: %v", err)
		}
	})

	cfg := Load()
	if errs := cfg.Validate(); len(errs) != 0 {
		t.Fatalf("Validate() returned errors for defaults: %v", errs)
	}
}

func TestValidateReportsConfigurationErrors(t *testing.T) {
	cfg := Config{
		HTTPAddr:                   "3000",
		SMTPAddr:                   ":smtp",
		PublicBaseURL:              "localhost:3000",
		AllowedOrigin:              "ftp://example.com",
		DatabaseDriver:             "oracle",
		DatabaseURL:                "",
		DBMaxOpenConns:             0,
		DBMaxIdleConns:             -1,
		MaxMessageBytes:            0,
		MaxAttachmentBytes:         1,
		MessageRetention:           -time.Hour,
		APIKeyDefaultDailyCap:      -1,
		AuditLogRetentionDays:      0,
		AuditActivityRetentionDays: -1,
	}

	errs := cfg.Validate()
	joined := make([]string, 0, len(errs))
	for _, err := range errs {
		joined = append(joined, err.Error())
	}
	got := strings.Join(joined, "\n")
	for _, want := range []string{
		"HTTP_ADDR",
		"SMTP_ADDR",
		"PUBLIC_BASE_URL",
		"ALLOWED_ORIGIN",
		"DATABASE_DRIVER",
		"DATABASE_URL",
		"DB_MAX_OPEN_CONNS",
		"DB_MAX_IDLE_CONNS",
		"MAX_MESSAGE_BYTES",
		"MAX_ATTACHMENT_BYTES",
		"MESSAGE_RETENTION_HOURS",
		"API_KEY_DEFAULT_DAILY_LIMIT",
		"AUDIT_LOG_RETENTION_DAYS",
		"AUDIT_ACTIVITY_RETENTION_DAYS",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("Validate() errors missing %s in:\n%s", want, got)
		}
	}
}

func TestValidatePostgresPoolRejectsIdleAboveOpen(t *testing.T) {
	cfg := Config{
		HTTPAddr:                   ":3000",
		SMTPAddr:                   ":2525",
		PublicBaseURL:              "http://localhost:3000",
		DatabaseDriver:             "postgres",
		DatabaseURL:                "postgres://user:pass@localhost:5432/hloolmail?sslmode=disable",
		DBMaxOpenConns:             2,
		DBMaxIdleConns:             3,
		MaxMessageBytes:            1024,
		MaxAttachmentBytes:         1024,
		MessageRetention:           time.Hour,
		APIKeyDefaultDailyCap:      1,
		AuditLogRetentionDays:      1,
		AuditActivityRetentionDays: 1,
	}
	errs := cfg.Validate()
	if len(errs) != 1 || !strings.Contains(errs[0].Error(), "DB_MAX_IDLE_CONNS") {
		t.Fatalf("Validate() errors = %v, want DB_MAX_IDLE_CONNS error", errs)
	}
}
