package cli

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	defaultBaseURL = "http://localhost:3000"
	defaultOutput  = "human"
	defaultProfile = "default"
)

var defaultTimeout = 30 * time.Second

type Profile struct {
	BaseURL string `json:"base_url,omitempty"`
	APIKey  string `json:"api_key,omitempty"`
	Output  string `json:"output,omitempty"`
	Timeout string `json:"timeout,omitempty"`
}

type ConfigFile struct {
	CurrentProfile string             `json:"current_profile,omitempty"`
	Profiles       map[string]Profile `json:"profiles,omitempty"`
}

type ResolvedConfig struct {
	BaseURL    string
	APIKey     string
	Profile    string
	Output     string
	Timeout    time.Duration
	ConfigPath string
}

type globalOverrides struct {
	BaseURL    string
	BaseURLSet bool
	APIKey     string
	APIKeySet  bool
	Profile    string
	ProfileSet bool
	Output     string
	OutputSet  bool
	Timeout    string
	TimeoutSet bool
	Help       bool
}

func defaultConfigPath() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return defaultConfigPathFromDir(dir), nil
}

func defaultConfigPathFromDir(dir string) string {
	return filepath.Join(dir, "hloolmail", "config.json")
}

func loadConfigFile(path string) (ConfigFile, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return normalizedConfigFile(ConfigFile{}), nil
		}
		return ConfigFile{}, err
	}
	if len(strings.TrimSpace(string(data))) == 0 {
		return normalizedConfigFile(ConfigFile{}), nil
	}
	var file ConfigFile
	if err := json.Unmarshal(data, &file); err != nil {
		return ConfigFile{}, err
	}
	return normalizedConfigFile(file), nil
}

func saveConfigFile(path string, file ConfigFile) error {
	file = normalizedConfigFile(file)
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	return os.WriteFile(path, data, 0o600)
}

func normalizedConfigFile(file ConfigFile) ConfigFile {
	if strings.TrimSpace(file.CurrentProfile) == "" {
		file.CurrentProfile = defaultProfile
	}
	if file.Profiles == nil {
		file.Profiles = map[string]Profile{}
	}
	if _, ok := file.Profiles[file.CurrentProfile]; !ok {
		file.Profiles[file.CurrentProfile] = Profile{}
	}
	return file
}

func resolveConfig(path string, file ConfigFile, env map[string]string, flags globalOverrides) (ResolvedConfig, error) {
	file = normalizedConfigFile(file)
	profileName := strings.TrimSpace(file.CurrentProfile)
	if profileName == "" {
		profileName = defaultProfile
	}
	if value := strings.TrimSpace(env["HLOOLMAIL_PROFILE"]); value != "" {
		profileName = value
	}
	if flags.ProfileSet {
		profileName = strings.TrimSpace(flags.Profile)
	}
	if profileName == "" {
		return ResolvedConfig{}, fmt.Errorf("profile cannot be empty")
	}

	resolved := ResolvedConfig{
		BaseURL:    defaultBaseURL,
		Output:     defaultOutput,
		Timeout:    defaultTimeout,
		Profile:    profileName,
		ConfigPath: path,
	}
	if profile, ok := file.Profiles[profileName]; ok {
		if err := applyProfile(&resolved, profile); err != nil {
			return ResolvedConfig{}, err
		}
	}
	if value := strings.TrimSpace(env["HLOOLMAIL_BASE_URL"]); value != "" {
		resolved.BaseURL = value
	}
	if value := strings.TrimSpace(env["HLOOLMAIL_API_KEY"]); value != "" {
		resolved.APIKey = value
	}
	if value := strings.TrimSpace(env["HLOOLMAIL_OUTPUT"]); value != "" {
		resolved.Output = value
	}
	if value := strings.TrimSpace(env["HLOOLMAIL_TIMEOUT"]); value != "" {
		timeout, err := parseTimeout(value)
		if err != nil {
			return ResolvedConfig{}, err
		}
		resolved.Timeout = timeout
	}
	if flags.BaseURLSet {
		resolved.BaseURL = strings.TrimSpace(flags.BaseURL)
	}
	if flags.APIKeySet {
		resolved.APIKey = strings.TrimSpace(flags.APIKey)
	}
	if flags.OutputSet {
		resolved.Output = strings.TrimSpace(flags.Output)
	}
	if flags.TimeoutSet {
		timeout, err := parseTimeout(flags.Timeout)
		if err != nil {
			return ResolvedConfig{}, err
		}
		resolved.Timeout = timeout
	}
	if strings.TrimSpace(resolved.BaseURL) == "" {
		return ResolvedConfig{}, fmt.Errorf("base_url cannot be empty")
	}
	if err := validateOutput(resolved.Output); err != nil {
		return ResolvedConfig{}, err
	}
	return resolved, nil
}

func applyProfile(resolved *ResolvedConfig, profile Profile) error {
	if value := strings.TrimSpace(profile.BaseURL); value != "" {
		resolved.BaseURL = value
	}
	if value := strings.TrimSpace(profile.APIKey); value != "" {
		resolved.APIKey = value
	}
	if value := strings.TrimSpace(profile.Output); value != "" {
		resolved.Output = value
	}
	if value := strings.TrimSpace(profile.Timeout); value != "" {
		timeout, err := parseTimeout(value)
		if err != nil {
			return err
		}
		resolved.Timeout = timeout
	}
	return nil
}

func selectedProfileName(file ConfigFile, env map[string]string, flags globalOverrides) (string, error) {
	file = normalizedConfigFile(file)
	name := strings.TrimSpace(file.CurrentProfile)
	if value := strings.TrimSpace(env["HLOOLMAIL_PROFILE"]); value != "" {
		name = value
	}
	if flags.ProfileSet {
		name = strings.TrimSpace(flags.Profile)
	}
	if name == "" {
		return "", fmt.Errorf("profile cannot be empty")
	}
	return name, nil
}

func setProfileValue(path string, env map[string]string, flags globalOverrides, key, value string) error {
	file, err := loadConfigFile(path)
	if err != nil {
		return err
	}
	profileName, err := selectedProfileName(file, env, flags)
	if err != nil {
		return err
	}
	key = normalizeConfigKey(key)
	if err := validateConfigValue(key, value); err != nil {
		return err
	}
	if file.Profiles == nil {
		file.Profiles = map[string]Profile{}
	}
	profile := file.Profiles[profileName]
	switch key {
	case "base_url":
		profile.BaseURL = strings.TrimSpace(value)
	case "api_key":
		profile.APIKey = strings.TrimSpace(value)
	case "output":
		profile.Output = strings.TrimSpace(value)
	case "timeout":
		profile.Timeout = strings.TrimSpace(value)
	default:
		return fmt.Errorf("unknown config key %q", key)
	}
	file.Profiles[profileName] = profile
	if strings.TrimSpace(file.CurrentProfile) == "" {
		file.CurrentProfile = profileName
	}
	return saveConfigFile(path, file)
}

func useProfile(path, profileName string) error {
	profileName = strings.TrimSpace(profileName)
	if profileName == "" {
		return fmt.Errorf("profile cannot be empty")
	}
	file, err := loadConfigFile(path)
	if err != nil {
		return err
	}
	if file.Profiles == nil {
		file.Profiles = map[string]Profile{}
	}
	if _, ok := file.Profiles[profileName]; !ok {
		file.Profiles[profileName] = Profile{}
	}
	file.CurrentProfile = profileName
	return saveConfigFile(path, file)
}

func validateConfigValue(key, value string) error {
	switch normalizeConfigKey(key) {
	case "base_url":
		if strings.TrimSpace(value) == "" {
			return fmt.Errorf("base_url cannot be empty")
		}
	case "api_key":
	case "output":
		return validateOutput(value)
	case "timeout":
		_, err := parseTimeout(value)
		return err
	default:
		return fmt.Errorf("unknown config key %q", key)
	}
	return nil
}

func normalizeConfigKey(key string) string {
	key = strings.TrimSpace(strings.ToLower(key))
	return strings.ReplaceAll(key, "-", "_")
}

func validateOutput(output string) error {
	switch strings.TrimSpace(strings.ToLower(output)) {
	case "human", "json", "raw", "quiet":
		return nil
	default:
		return fmt.Errorf("output must be one of human, json, raw, quiet")
	}
}

func parseTimeout(value string) (time.Duration, error) {
	timeout, err := time.ParseDuration(strings.TrimSpace(value))
	if err != nil {
		return 0, fmt.Errorf("invalid timeout %q", value)
	}
	if timeout <= 0 {
		return 0, fmt.Errorf("timeout must be greater than zero")
	}
	return timeout, nil
}

func envMap(values []string) map[string]string {
	out := map[string]string{}
	for _, item := range values {
		key, value, ok := strings.Cut(item, "=")
		if !ok {
			continue
		}
		out[key] = value
	}
	return out
}
