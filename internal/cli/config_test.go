package cli

import (
	"path/filepath"
	"testing"
	"time"
)

func TestResolveConfigPriority(t *testing.T) {
	file := ConfigFile{
		CurrentProfile: "default",
		Profiles: map[string]Profile{
			"default": {
				BaseURL: "https://profile.example",
				APIKey:  "profile-key",
				Output:  "raw",
				Timeout: "5s",
			},
			"work": {
				BaseURL: "https://work.example",
				APIKey:  "work-key",
				Output:  "human",
				Timeout: "7s",
			},
		},
	}
	env := map[string]string{
		"HLOOLMAIL_PROFILE":  "work",
		"HLOOLMAIL_BASE_URL": "https://env.example",
		"HLOOLMAIL_API_KEY":  "env-key",
		"HLOOLMAIL_OUTPUT":   "json",
		"HLOOLMAIL_TIMEOUT":  "9s",
	}
	flags := globalOverrides{
		BaseURL:    "https://flag.example",
		BaseURLSet: true,
		APIKey:     "flag-key",
		APIKeySet:  true,
		Output:     "quiet",
		OutputSet:  true,
		Timeout:    "11s",
		TimeoutSet: true,
	}

	cfg, err := resolveConfig("config.json", file, env, flags)
	if err != nil {
		t.Fatalf("resolveConfig returned error: %v", err)
	}
	if cfg.Profile != "work" {
		t.Fatalf("profile = %q, want work", cfg.Profile)
	}
	if cfg.BaseURL != "https://flag.example" {
		t.Fatalf("base URL = %q", cfg.BaseURL)
	}
	if cfg.APIKey != "flag-key" {
		t.Fatalf("api key = %q", cfg.APIKey)
	}
	if cfg.Output != "quiet" {
		t.Fatalf("output = %q", cfg.Output)
	}
	if cfg.Timeout != 11*time.Second {
		t.Fatalf("timeout = %s", cfg.Timeout)
	}
}

func TestResolveConfigUsesEnvSelectedProfile(t *testing.T) {
	file := ConfigFile{
		CurrentProfile: "default",
		Profiles: map[string]Profile{
			"default": {BaseURL: "https://default.example"},
			"work":    {BaseURL: "https://work.example", APIKey: "work-key"},
		},
	}

	cfg, err := resolveConfig("config.json", file, map[string]string{"HLOOLMAIL_PROFILE": "work"}, globalOverrides{})
	if err != nil {
		t.Fatalf("resolveConfig returned error: %v", err)
	}
	if cfg.Profile != "work" || cfg.BaseURL != "https://work.example" || cfg.APIKey != "work-key" {
		t.Fatalf("resolved config = %+v", cfg)
	}
}

func TestConfigPathAndReadWrite(t *testing.T) {
	path := defaultConfigPathFromDir(t.TempDir())
	if filepath.Base(filepath.Dir(path)) != "hloolmail" || filepath.Base(path) != "config.json" {
		t.Fatalf("unexpected default config path: %s", path)
	}

	if err := useProfile(path, "work"); err != nil {
		t.Fatalf("useProfile returned error: %v", err)
	}
	flags := globalOverrides{Profile: "work", ProfileSet: true}
	if err := setProfileValue(path, nil, flags, "base-url", "https://api.example"); err != nil {
		t.Fatalf("set base-url returned error: %v", err)
	}
	if err := setProfileValue(path, nil, flags, "timeout", "12s"); err != nil {
		t.Fatalf("set timeout returned error: %v", err)
	}

	file, err := loadConfigFile(path)
	if err != nil {
		t.Fatalf("loadConfigFile returned error: %v", err)
	}
	if file.CurrentProfile != "work" {
		t.Fatalf("current profile = %q", file.CurrentProfile)
	}
	profile := file.Profiles["work"]
	if profile.BaseURL != "https://api.example" || profile.Timeout != "12s" {
		t.Fatalf("profile = %+v", profile)
	}
	if err := setProfileValue(path, nil, flags, "timeout", "nope"); err == nil {
		t.Fatal("expected invalid timeout to fail")
	}
}
