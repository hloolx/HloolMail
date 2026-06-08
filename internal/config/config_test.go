package config

import (
	"os"
	"testing"
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
