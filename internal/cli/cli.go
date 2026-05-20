package cli

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"gptmail/internal/apispec"
	"gptmail/internal/version"
)

const (
	ExitOK          = 0
	ExitConfig      = 2
	ExitAuth        = 3
	ExitNotFound    = 4
	ExitQuota       = 6
	ExitNetwork     = 7
	ExitServer      = 8
	ExitWaitTimeout = 9
	ExitDangerous   = 10
)

type ExitError struct {
	Code       int
	Message    string
	StatusCode int
	Raw        []byte
}

func (e *ExitError) Error() string {
	return e.Message
}

type Runner struct {
	Stdin      io.Reader
	Stdout     io.Writer
	Stderr     io.Writer
	Env        []string
	HTTPClient *http.Client
	ConfigPath string
	Sleep      func(context.Context, time.Duration) error
}

func OSRunner() Runner {
	return Runner{
		Stdin:  os.Stdin,
		Stdout: os.Stdout,
		Stderr: os.Stderr,
		Env:    os.Environ(),
	}
}

func Execute(ctx context.Context, args []string, runner Runner) int {
	if runner.Stdout == nil {
		runner.Stdout = io.Discard
	}
	if runner.Stderr == nil {
		runner.Stderr = io.Discard
	}
	if runner.Stdin == nil {
		runner.Stdin = strings.NewReader("")
	}
	code, err := runner.run(ctx, args)
	if err == nil {
		return code
	}
	exitErr, ok := err.(*ExitError)
	if !ok {
		exitErr = &ExitError{Code: ExitConfig, Message: err.Error()}
	}
	mode := outputModeForError(args, runner)
	writeError(runner.Stderr, mode, exitErr)
	return exitErr.Code
}

func outputModeForError(args []string, runner Runner) string {
	mode := "human"
	_, flags, parseErr := parseGlobalFlags(args)
	if parseErr == nil && flags.OutputSet {
		mode = flags.Output
	}
	if cfg, cfgErr := runner.resolvedConfig(flags); cfgErr == nil {
		mode = cfg.Output
	}
	return mode
}

func (r Runner) run(ctx context.Context, args []string) (int, error) {
	cleanArgs, overrides, err := parseGlobalFlags(args)
	if err != nil {
		return ExitConfig, &ExitError{Code: ExitConfig, Message: err.Error()}
	}
	cfg, err := r.resolvedConfig(overrides)
	if err != nil {
		return ExitConfig, &ExitError{Code: ExitConfig, Message: err.Error()}
	}
	if overrides.Help || len(cleanArgs) == 0 {
		return ExitOK, writeUsage(r.Stdout)
	}
	client := APIClient{
		BaseURL:    cfg.BaseURL,
		APIKey:     cfg.APIKey,
		HTTPClient: r.HTTPClient,
		Timeout:    cfg.Timeout,
	}
	switch cleanArgs[0] {
	case "version":
		return ExitOK, r.runVersion(cfg)
	case "config":
		return r.runConfig(cfg, overrides, cleanArgs[1:])
	case "health":
		return r.runSimpleGet(ctx, cfg, client, "health", "/api/health", printHealth)
	case "openapi":
		return r.runOpenAPI(cfg, cleanArgs[1:])
	case "domains":
		return r.runDomains(ctx, cfg, client, cleanArgs[1:])
	case "mailbox":
		return r.runMailbox(ctx, cfg, client, cleanArgs[1:])
	case "mail":
		return r.runMail(ctx, cfg, client, cleanArgs[1:])
	case "stats":
		return r.runSimpleGet(ctx, cfg, client, "stats", "/api/stats", printMapHuman)
	default:
		return ExitConfig, &ExitError{Code: ExitConfig, Message: "unknown command: " + cleanArgs[0]}
	}
}

func (r Runner) resolvedConfig(flags globalOverrides) (ResolvedConfig, error) {
	path := r.ConfigPath
	if strings.TrimSpace(path) == "" {
		var err error
		path, err = defaultConfigPath()
		if err != nil {
			return ResolvedConfig{}, err
		}
	}
	file, err := loadConfigFile(path)
	if err != nil {
		return ResolvedConfig{}, err
	}
	return resolveConfig(path, file, envMap(r.Env), flags)
}

func (r Runner) runVersion(cfg ResolvedConfig) error {
	data := map[string]string{
		"version":    version.Version,
		"commit":     version.Commit,
		"build_time": version.BuildTime,
	}
	return writeLocalResult(r.Stdout, cfg, "version", data, nil, version.Version, func(w io.Writer) error {
		_, err := fmt.Fprintf(w, "hloolmail %s (commit %s, built %s)\n", version.Version, version.Commit, version.BuildTime)
		return err
	})
}

func (r Runner) runConfig(cfg ResolvedConfig, overrides globalOverrides, args []string) (int, error) {
	if len(args) == 0 {
		return ExitConfig, &ExitError{Code: ExitConfig, Message: "config subcommand is required"}
	}
	switch args[0] {
	case "path":
		return ExitOK, writeLocalResult(r.Stdout, cfg, "config path", map[string]string{"path": cfg.ConfigPath}, []byte(cfg.ConfigPath), cfg.ConfigPath, func(w io.Writer) error {
			_, err := fmt.Fprintln(w, cfg.ConfigPath)
			return err
		})
	case "get":
		key := ""
		if len(args) > 1 {
			key = normalizeConfigKey(args[1])
		}
		data, quiet, err := configData(cfg, key)
		if err != nil {
			return ExitConfig, &ExitError{Code: ExitConfig, Message: err.Error()}
		}
		return ExitOK, writeLocalResult(r.Stdout, cfg, "config get", data, nil, quiet, func(w io.Writer) error {
			return printConfigHuman(w, data)
		})
	case "set":
		if len(args) != 3 {
			return ExitConfig, &ExitError{Code: ExitConfig, Message: "usage: hloolmail config set KEY VALUE"}
		}
		if err := setProfileValue(cfg.ConfigPath, envMap(r.Env), overrides, args[1], args[2]); err != nil {
			return ExitConfig, &ExitError{Code: ExitConfig, Message: err.Error()}
		}
		data := map[string]string{"profile": cfg.Profile, "key": normalizeConfigKey(args[1])}
		return ExitOK, writeLocalResult(r.Stdout, cfg, "config set", data, nil, "", func(w io.Writer) error {
			_, err := fmt.Fprintf(w, "set %s for profile %s\n", normalizeConfigKey(args[1]), cfg.Profile)
			return err
		})
	case "use":
		if len(args) != 2 {
			return ExitConfig, &ExitError{Code: ExitConfig, Message: "usage: hloolmail config use PROFILE"}
		}
		if err := useProfile(cfg.ConfigPath, args[1]); err != nil {
			return ExitConfig, &ExitError{Code: ExitConfig, Message: err.Error()}
		}
		data := map[string]string{"profile": strings.TrimSpace(args[1])}
		return ExitOK, writeLocalResult(r.Stdout, cfg, "config use", data, nil, strings.TrimSpace(args[1]), func(w io.Writer) error {
			_, err := fmt.Fprintf(w, "using profile %s\n", strings.TrimSpace(args[1]))
			return err
		})
	default:
		return ExitConfig, &ExitError{Code: ExitConfig, Message: "unknown config subcommand: " + args[0]}
	}
}

func (r Runner) runOpenAPI(cfg ResolvedConfig, args []string) (int, error) {
	if len(args) != 1 {
		return ExitConfig, &ExitError{Code: ExitConfig, Message: "usage: hloolmail openapi json|yaml|markdown|skill"}
	}
	specCfg := apispec.Config{
		BaseURL:    cfg.BaseURL,
		ExpectedMX: "mail.example.com",
		Version:    version.Version,
	}
	var data []byte
	var err error
	switch args[0] {
	case "json":
		data, err = apispec.JSON(specCfg)
	case "yaml":
		data, err = apispec.YAML(specCfg)
	case "markdown":
		data = []byte(apispec.Markdown(specCfg))
	case "skill":
		data = []byte(apispec.SkillMarkdown(specCfg))
	default:
		return ExitConfig, &ExitError{Code: ExitConfig, Message: "unknown openapi format: " + args[0]}
	}
	if err != nil {
		return ExitServer, &ExitError{Code: ExitServer, Message: err.Error()}
	}
	return ExitOK, writeLocalResult(r.Stdout, cfg, "openapi "+args[0], map[string]string{"content": string(data)}, data, string(data), func(w io.Writer) error {
		_, err := w.Write(appendNewline(data))
		return err
	})
}

func (r Runner) runDomains(ctx context.Context, cfg ResolvedConfig, client APIClient, args []string) (int, error) {
	if len(args) != 1 || args[0] != "list" {
		return ExitConfig, &ExitError{Code: ExitConfig, Message: "usage: hloolmail domains list"}
	}
	resp, err := client.Do(ctx, http.MethodGet, "/api/domains/available", nil, nil)
	if err != nil {
		return exitFromError(err)
	}
	return ExitOK, writeAPIResult(r.Stdout, cfg, "domains list", resp, "", printDomains)
}

func (r Runner) runMailbox(ctx context.Context, cfg ResolvedConfig, client APIClient, args []string) (int, error) {
	if len(args) == 0 {
		return ExitConfig, &ExitError{Code: ExitConfig, Message: "mailbox subcommand is required"}
	}
	switch args[0] {
	case "create":
		fs := newFlagSet("mailbox create")
		prefix := fs.String("prefix", "", "mailbox local-part prefix")
		domain := fs.String("domain", "", "mailbox domain")
		rest, err := parseInterspersed(fs, args[1:])
		if err != nil {
			return ExitConfig, &ExitError{Code: ExitConfig, Message: err.Error()}
		}
		if len(rest) > 0 {
			return ExitConfig, &ExitError{Code: ExitConfig, Message: "mailbox create does not accept positional arguments"}
		}
		body := map[string]string{}
		if strings.TrimSpace(*prefix) != "" {
			body["prefix"] = strings.TrimSpace(*prefix)
		}
		if strings.TrimSpace(*domain) != "" {
			body["domain"] = strings.TrimSpace(*domain)
		}
		resp, err := client.Do(ctx, http.MethodPost, "/api/generate-email", nil, body)
		if err != nil {
			return exitFromError(err)
		}
		quiet := extractString(resp.dataRaw(), "email")
		return ExitOK, writeAPIResult(r.Stdout, cfg, "mailbox create", resp, quiet, printMailboxCreate)
	case "list":
		fs := newFlagSet("mailbox list")
		page := fs.Int("page", 0, "page")
		perPage := fs.Int("per-page", 0, "per page")
		q := fs.String("q", "", "search")
		rest, err := parseInterspersed(fs, args[1:])
		if err != nil {
			return ExitConfig, &ExitError{Code: ExitConfig, Message: err.Error()}
		}
		if len(rest) > 0 {
			return ExitConfig, &ExitError{Code: ExitConfig, Message: "mailbox list does not accept positional arguments"}
		}
		query := url.Values{}
		addInt(query, "page", *page)
		addInt(query, "per_page", *perPage)
		addString(query, "q", *q)
		resp, err := client.Do(ctx, http.MethodGet, "/api/mailboxes", query, nil)
		if err != nil {
			return exitFromError(err)
		}
		return ExitOK, writeAPIResult(r.Stdout, cfg, "mailbox list", resp, "", printMailboxList)
	case "delete":
		fs := newFlagSet("mailbox delete")
		yes := fs.Bool("yes", false, "confirm deletion")
		rest, err := parseInterspersed(fs, args[1:])
		if err != nil {
			return ExitConfig, &ExitError{Code: ExitConfig, Message: err.Error()}
		}
		if len(rest) != 1 {
			return ExitConfig, &ExitError{Code: ExitConfig, Message: "usage: hloolmail mailbox delete ID --yes"}
		}
		if !*yes {
			return ExitDangerous, &ExitError{Code: ExitDangerous, Message: "dangerous operation requires --yes"}
		}
		resp, err := client.Do(ctx, http.MethodDelete, "/api/mailboxes/"+url.PathEscape(rest[0]), nil, nil)
		if err != nil {
			return exitFromError(err)
		}
		return ExitOK, writeAPIResult(r.Stdout, cfg, "mailbox delete", resp, "", printMapHuman)
	default:
		return ExitConfig, &ExitError{Code: ExitConfig, Message: "unknown mailbox subcommand: " + args[0]}
	}
}

func (r Runner) runMail(ctx context.Context, cfg ResolvedConfig, client APIClient, args []string) (int, error) {
	if len(args) == 0 {
		return ExitConfig, &ExitError{Code: ExitConfig, Message: "mail subcommand is required"}
	}
	switch args[0] {
	case "next":
		fs := newFlagSet("mail next")
		waitText := fs.String("wait", "0s", "wait duration")
		intervalText := fs.String("interval", "3s", "poll interval")
		codePattern := fs.String("code-regex", "", "verification code regex")
		rest, err := parseInterspersed(fs, args[1:])
		if err != nil {
			return ExitConfig, &ExitError{Code: ExitConfig, Message: err.Error()}
		}
		if len(rest) != 1 {
			return ExitConfig, &ExitError{Code: ExitConfig, Message: `usage: hloolmail mail next EMAIL --wait 120s --interval 3s --code-regex "\d{6}"`}
		}
		wait, err := time.ParseDuration(*waitText)
		if err != nil || wait < 0 {
			return ExitConfig, &ExitError{Code: ExitConfig, Message: "invalid wait duration"}
		}
		interval, err := time.ParseDuration(*intervalText)
		if err != nil || interval <= 0 {
			return ExitConfig, &ExitError{Code: ExitConfig, Message: "invalid interval duration"}
		}
		result, err := WaitForNextEmail(ctx, client, rest[0], wait, interval, *codePattern, r.Sleep)
		if err != nil {
			return exitFromError(err)
		}
		quiet := result.Code
		return ExitOK, writeAPIResult(r.Stdout, cfg, "mail next", result.Response, quiet, func(w io.Writer, raw json.RawMessage) error {
			return printMailNext(w, raw, result.Code, result.Attempts)
		})
	case "list":
		fs := newFlagSet("mail list")
		limit := fs.Int("limit", 50, "limit")
		page := fs.Int("page", 0, "page")
		perPage := fs.Int("per-page", 0, "per page")
		rest, err := parseInterspersed(fs, args[1:])
		if err != nil {
			return ExitConfig, &ExitError{Code: ExitConfig, Message: err.Error()}
		}
		if len(rest) != 1 {
			return ExitConfig, &ExitError{Code: ExitConfig, Message: "usage: hloolmail mail list EMAIL"}
		}
		query := url.Values{"email": []string{rest[0]}}
		if *page > 0 || *perPage > 0 {
			addInt(query, "page", *page)
			addInt(query, "per_page", *perPage)
		} else {
			addInt(query, "limit", *limit)
		}
		resp, err := client.Do(ctx, http.MethodGet, "/api/emails", query, nil)
		if err != nil {
			return exitFromError(err)
		}
		return ExitOK, writeAPIResult(r.Stdout, cfg, "mail list", resp, "", printMailList)
	case "read":
		return r.runMailIDCommand(ctx, cfg, client, args[1:], "mail read", http.MethodGet, "/api/email/%s", false, printMailRead)
	case "mark-read":
		return r.runMailIDCommand(ctx, cfg, client, args[1:], "mail mark-read", http.MethodPatch, "/api/email/%s/read", false, printMapHuman)
	case "delete":
		return r.runMailIDCommand(ctx, cfg, client, args[1:], "mail delete", http.MethodDelete, "/api/email/%s", true, printMapHuman)
	case "clear":
		fs := newFlagSet("mail clear")
		yes := fs.Bool("yes", false, "confirm clear")
		rest, err := parseInterspersed(fs, args[1:])
		if err != nil {
			return ExitConfig, &ExitError{Code: ExitConfig, Message: err.Error()}
		}
		if len(rest) != 1 {
			return ExitConfig, &ExitError{Code: ExitConfig, Message: "usage: hloolmail mail clear EMAIL --yes"}
		}
		if !*yes {
			return ExitDangerous, &ExitError{Code: ExitDangerous, Message: "dangerous operation requires --yes"}
		}
		query := url.Values{"email": []string{rest[0]}}
		resp, err := client.Do(ctx, http.MethodDelete, "/api/emails/clear", query, nil)
		if err != nil {
			return exitFromError(err)
		}
		return ExitOK, writeAPIResult(r.Stdout, cfg, "mail clear", resp, "", printMapHuman)
	default:
		return ExitConfig, &ExitError{Code: ExitConfig, Message: "unknown mail subcommand: " + args[0]}
	}
}

func (r Runner) runMailIDCommand(ctx context.Context, cfg ResolvedConfig, client APIClient, args []string, command, method, pathFormat string, dangerous bool, human humanPrinter) (int, error) {
	fs := newFlagSet(command)
	yes := fs.Bool("yes", false, "confirm dangerous operation")
	rest, err := parseInterspersed(fs, args)
	if err != nil {
		return ExitConfig, &ExitError{Code: ExitConfig, Message: err.Error()}
	}
	if len(rest) != 1 {
		return ExitConfig, &ExitError{Code: ExitConfig, Message: "usage: hloolmail " + command + " ID"}
	}
	if dangerous && !*yes {
		return ExitDangerous, &ExitError{Code: ExitDangerous, Message: "dangerous operation requires --yes"}
	}
	resp, err := client.Do(ctx, method, fmt.Sprintf(pathFormat, url.PathEscape(rest[0])), nil, nil)
	if err != nil {
		return exitFromError(err)
	}
	return ExitOK, writeAPIResult(r.Stdout, cfg, command, resp, "", human)
}

func (r Runner) runSimpleGet(ctx context.Context, cfg ResolvedConfig, client APIClient, command, path string, human humanPrinter) (int, error) {
	resp, err := client.Do(ctx, http.MethodGet, path, nil, nil)
	if err != nil {
		return exitFromError(err)
	}
	return ExitOK, writeAPIResult(r.Stdout, cfg, command, resp, "", human)
}

func parseGlobalFlags(args []string) ([]string, globalOverrides, error) {
	var flags globalOverrides
	clean := make([]string, 0, len(args))
	for i := 0; i < len(args); i++ {
		arg := args[i]
		name, value, hasValue := splitFlag(arg)
		switch name {
		case "--base-url":
			value, i, hasValue = flagValue(args, i, value, hasValue)
			if !hasValue {
				return nil, flags, fmt.Errorf("--base-url requires a value")
			}
			flags.BaseURL, flags.BaseURLSet = value, true
		case "--api-key":
			value, i, hasValue = flagValue(args, i, value, hasValue)
			if !hasValue {
				return nil, flags, fmt.Errorf("--api-key requires a value")
			}
			flags.APIKey, flags.APIKeySet = value, true
		case "--profile":
			value, i, hasValue = flagValue(args, i, value, hasValue)
			if !hasValue {
				return nil, flags, fmt.Errorf("--profile requires a value")
			}
			flags.Profile, flags.ProfileSet = value, true
		case "--output":
			value, i, hasValue = flagValue(args, i, value, hasValue)
			if !hasValue {
				return nil, flags, fmt.Errorf("--output requires a value")
			}
			flags.Output, flags.OutputSet = value, true
		case "--timeout":
			value, i, hasValue = flagValue(args, i, value, hasValue)
			if !hasValue {
				return nil, flags, fmt.Errorf("--timeout requires a value")
			}
			flags.Timeout, flags.TimeoutSet = value, true
		case "--json":
			flags.Output, flags.OutputSet = "json", true
		case "--raw":
			flags.Output, flags.OutputSet = "raw", true
		case "--quiet":
			flags.Output, flags.OutputSet = "quiet", true
		case "-h", "--help":
			flags.Help = true
		default:
			clean = append(clean, arg)
		}
	}
	return clean, flags, nil
}

func splitFlag(arg string) (name, value string, hasValue bool) {
	if !strings.HasPrefix(arg, "-") {
		return arg, "", false
	}
	if before, after, ok := strings.Cut(arg, "="); ok {
		return before, after, true
	}
	return arg, "", false
}

func flagValue(args []string, index int, current string, hasCurrent bool) (string, int, bool) {
	if hasCurrent {
		return current, index, true
	}
	if index+1 >= len(args) {
		return "", index, false
	}
	return args[index+1], index + 1, true
}

func newFlagSet(name string) *flag.FlagSet {
	fs := flag.NewFlagSet(name, flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	return fs
}

func parseInterspersed(fs *flag.FlagSet, args []string) ([]string, error) {
	flagArgs := []string{}
	positionals := []string{}
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if !strings.HasPrefix(arg, "-") || arg == "-" {
			positionals = append(positionals, arg)
			continue
		}
		name, _, hasValue := splitFlag(arg)
		flagName := strings.TrimLeft(name, "-")
		known := fs.Lookup(flagName)
		if known == nil {
			return nil, fmt.Errorf("unknown flag %s", name)
		}
		flagArgs = append(flagArgs, arg)
		if hasValue || isBoolFlag(known) {
			continue
		}
		if i+1 >= len(args) {
			return nil, fmt.Errorf("%s requires a value", name)
		}
		i++
		flagArgs = append(flagArgs, args[i])
	}
	if err := fs.Parse(flagArgs); err != nil {
		return nil, err
	}
	return positionals, nil
}

func isBoolFlag(f *flag.Flag) bool {
	type boolFlag interface {
		IsBoolFlag() bool
	}
	value, ok := f.Value.(boolFlag)
	return ok && value.IsBoolFlag()
}

func addString(values url.Values, key, value string) {
	if strings.TrimSpace(value) != "" {
		values.Set(key, strings.TrimSpace(value))
	}
}

func addInt(values url.Values, key string, value int) {
	if value > 0 {
		values.Set(key, strconv.Itoa(value))
	}
}

func configData(cfg ResolvedConfig, key string) (any, string, error) {
	data := map[string]any{
		"profile":     cfg.Profile,
		"base_url":    cfg.BaseURL,
		"api_key":     cfg.APIKey,
		"output":      cfg.Output,
		"timeout":     cfg.Timeout.String(),
		"config_path": cfg.ConfigPath,
	}
	if key == "" {
		return data, "", nil
	}
	value, ok := data[key]
	if !ok {
		return nil, "", fmt.Errorf("unknown config key %q", key)
	}
	return map[string]any{key: value}, fmt.Sprint(value), nil
}

func printConfigHuman(w io.Writer, data any) error {
	values, ok := data.(map[string]any)
	if !ok {
		return writeJSON(w, data)
	}
	return printMap(w, values)
}

func printHealth(w io.Writer, raw json.RawMessage) error {
	var data map[string]any
	if err := json.Unmarshal(raw, &data); err != nil {
		return writeIndentedJSON(w, raw)
	}
	status, _ := data["status"].(string)
	when, _ := data["time"].(string)
	if status == "" {
		status = "ok"
	}
	if when != "" {
		_, err := fmt.Fprintf(w, "%s %s\n", status, when)
		return err
	}
	_, err := fmt.Fprintln(w, status)
	return err
}

func printDomains(w io.Writer, raw json.RawMessage) error {
	var data struct {
		Domains       []string `json:"domains"`
		PublicDomains []struct {
			Domain string `json:"domain"`
		} `json:"public_domains"`
		PrivateDomains []struct {
			Domain string `json:"domain"`
		} `json:"private_domains"`
	}
	if err := json.Unmarshal(raw, &data); err != nil {
		return writeIndentedJSON(w, raw)
	}
	if len(data.PublicDomains) > 0 {
		if _, err := fmt.Fprintln(w, "public:"); err != nil {
			return err
		}
		for _, item := range data.PublicDomains {
			if _, err := fmt.Fprintln(w, item.Domain); err != nil {
				return err
			}
		}
	}
	if len(data.PrivateDomains) > 0 {
		if _, err := fmt.Fprintln(w, "private:"); err != nil {
			return err
		}
		for _, item := range data.PrivateDomains {
			if _, err := fmt.Fprintln(w, item.Domain); err != nil {
				return err
			}
		}
	}
	if len(data.PublicDomains) == 0 && len(data.PrivateDomains) == 0 {
		for _, domain := range data.Domains {
			if _, err := fmt.Fprintln(w, domain); err != nil {
				return err
			}
		}
	}
	return nil
}

func printMailboxCreate(w io.Writer, raw json.RawMessage) error {
	email := extractString(raw, "email")
	if email == "" {
		return writeIndentedJSON(w, raw)
	}
	_, err := fmt.Fprintln(w, email)
	return err
}

func printMailboxList(w io.Writer, raw json.RawMessage) error {
	return printEmailItems(w, raw, "email")
}

func printMailList(w io.Writer, raw json.RawMessage) error {
	return printEmailItems(w, raw, "id")
}

func printEmailItems(w io.Writer, raw json.RawMessage, firstField string) error {
	var data any
	if err := json.Unmarshal(raw, &data); err != nil {
		return writeIndentedJSON(w, raw)
	}
	items := listItems(data)
	if len(items) == 0 {
		_, err := fmt.Fprintln(w, "no items")
		return err
	}
	for _, item := range items {
		first := fmt.Sprint(item[firstField])
		if first == "<nil>" {
			first = ""
		}
		subject := fmt.Sprint(item["subject"])
		if subject == "<nil>" {
			subject = ""
		}
		if subject != "" {
			if _, err := fmt.Fprintf(w, "%s\t%s\n", first, subject); err != nil {
				return err
			}
			continue
		}
		if _, err := fmt.Fprintln(w, first); err != nil {
			return err
		}
	}
	return nil
}

func printMailNext(w io.Writer, raw json.RawMessage, code string, attempts int) error {
	var data NextEmailData
	if err := json.Unmarshal(raw, &data); err != nil {
		return writeIndentedJSON(w, raw)
	}
	if !data.HasEmail {
		_, err := fmt.Fprintf(w, "no unread email after %d attempt(s)\n", attempts)
		return err
	}
	if code != "" {
		if _, err := fmt.Fprintf(w, "code: %s\n", code); err != nil {
			return err
		}
	}
	subject, _ := data.Message["subject"].(string)
	from, _ := data.Message["from_address"].(string)
	id, _ := data.Message["id"].(string)
	if subject != "" {
		if _, err := fmt.Fprintf(w, "subject: %s\n", subject); err != nil {
			return err
		}
	}
	if from != "" {
		if _, err := fmt.Fprintf(w, "from: %s\n", from); err != nil {
			return err
		}
	}
	if id != "" {
		if _, err := fmt.Fprintf(w, "id: %s\n", id); err != nil {
			return err
		}
	}
	return nil
}

func printMailRead(w io.Writer, raw json.RawMessage) error {
	var data map[string]any
	if err := json.Unmarshal(raw, &data); err != nil {
		return writeIndentedJSON(w, raw)
	}
	for _, key := range []string{"subject", "from_address", "recipient", "text_content"} {
		value, _ := data[key].(string)
		if value == "" {
			continue
		}
		if _, err := fmt.Fprintf(w, "%s: %s\n", key, value); err != nil {
			return err
		}
	}
	return nil
}

func printMapHuman(w io.Writer, raw json.RawMessage) error {
	var data map[string]any
	if err := json.Unmarshal(raw, &data); err != nil {
		return writeIndentedJSON(w, raw)
	}
	return printMap(w, data)
}

func extractString(raw json.RawMessage, key string) string {
	var data map[string]any
	if err := json.Unmarshal(raw, &data); err != nil {
		return ""
	}
	value, _ := data[key].(string)
	return value
}

func listItems(data any) []map[string]any {
	if items, ok := data.([]any); ok {
		return mapsFromAny(items)
	}
	object, ok := data.(map[string]any)
	if !ok {
		return nil
	}
	if items, ok := object["items"].([]any); ok {
		return mapsFromAny(items)
	}
	return nil
}

func mapsFromAny(items []any) []map[string]any {
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		if object, ok := item.(map[string]any); ok {
			out = append(out, object)
		}
	}
	return out
}

func mapHTTPStatusToExitCode(status int, message string) int {
	lowerMessage := strings.ToLower(message)
	switch {
	case status == http.StatusTooManyRequests:
		return ExitQuota
	case strings.Contains(lowerMessage, "quota") || strings.Contains(lowerMessage, "rate limit"):
		return ExitQuota
	case status == http.StatusUnauthorized || status == http.StatusForbidden:
		return ExitAuth
	case status == http.StatusNotFound:
		return ExitNotFound
	case status == http.StatusRequestTimeout:
		return ExitNetwork
	case status >= 500:
		return ExitServer
	case status >= 400:
		return ExitConfig
	default:
		return ExitConfig
	}
}

func exitFromError(err error) (int, error) {
	if exitErr, ok := err.(*ExitError); ok {
		return exitErr.Code, exitErr
	}
	return ExitConfig, &ExitError{Code: ExitConfig, Message: err.Error()}
}

func writeUsage(w io.Writer) error {
	_, err := fmt.Fprintln(w, `Usage:
  hloolmail                 Start server
  hloolmail serve           Start server
  hloolmail version
  hloolmail config path|get|set|use
  hloolmail health
  hloolmail openapi json|yaml|markdown|skill
  hloolmail domains list
  hloolmail mailbox create|list|delete
  hloolmail mail next|list|read|mark-read|delete|clear
  hloolmail stats

Global flags:
  --base-url URL --api-key KEY --profile NAME --output human|json|raw|quiet
  --json --raw --quiet --timeout 30s`)
	return err
}
