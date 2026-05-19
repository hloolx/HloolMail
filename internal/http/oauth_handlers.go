package httpapi

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"gptmail/internal/auth"
	"gptmail/internal/config"
	"gptmail/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const (
	oauthProviderGitHub  = "github"
	oauthProviderLinuxDo = "linuxdo"
	oauthStateTTL        = 10 * time.Minute
)

var oauthHTTPClient = &http.Client{Timeout: 10 * time.Second}

type OAuthUserInfo struct {
	ProviderUID string
	Email       string
	Name        string
	AvatarURL   string
}

type oauthToken struct {
	AccessToken  string
	RefreshToken string
	Expiry       *time.Time
	IDToken      string
}

type oauthProviderMeta struct {
	Provider string
	Name     string
}

type oauthProviderDTO struct {
	Provider     string `json:"provider"`
	Name         string `json:"name"`
	Enabled      bool   `json:"enabled"`
	Configured   bool   `json:"configured"`
	AuthURL      string `json:"auth_url"`
	ClientID     string `json:"client_id,omitempty"`
	ClientSecret string `json:"client_secret,omitempty"`
	RedirectURL  string `json:"redirect_url,omitempty"`
}

type oauthStateCookie struct {
	Provider  string `json:"provider"`
	State     string `json:"state"`
	Redirect  string `json:"redirect"`
	Mode      string `json:"mode"`
	UserID    uint   `json:"uid,omitempty"`
	ExpiresAt int64  `json:"exp"`
}

const oauthModeLogin = "login"
const oauthModeBind = "bind"

type oauthHTTPError struct {
	Status int
	Body   string
}

func (e oauthHTTPError) Error() string {
	return fmt.Sprintf("oauth provider returned HTTP %d", e.Status)
}

func oauthProviderMetas() []oauthProviderMeta {
	return []oauthProviderMeta{
		{Provider: oauthProviderGitHub, Name: "GitHub"},
		{Provider: oauthProviderLinuxDo, Name: "Linux.do"},
	}
}

func knownOAuthProvider(provider string) (oauthProviderMeta, bool) {
	provider = strings.ToLower(strings.TrimSpace(provider))
	for _, meta := range oauthProviderMetas() {
		if meta.Provider == provider {
			return meta, true
		}
	}
	return oauthProviderMeta{}, false
}

func (h *Handler) listOAuthProviders(c *gin.Context) {
	providers := make([]oauthProviderDTO, 0, len(oauthProviderMetas()))
	for _, meta := range oauthProviderMetas() {
		cfg, ok, err := h.effectiveOAuthConfig(meta.Provider)
		if err != nil {
			fail(c, http.StatusInternalServerError, err.Error())
			return
		}
		if !ok || !cfg.Enabled || !oauthConfigConfigured(cfg) {
			continue
		}
		providers = append(providers, h.oauthProviderDTO(meta, cfg, false))
	}
	ok(c, providers)
}

func (h *Handler) adminListOAuthProviders(c *gin.Context) {
	if !h.requireAdmin(c) {
		return
	}
	providers := make([]oauthProviderDTO, 0, len(oauthProviderMetas()))
	for _, meta := range oauthProviderMetas() {
		cfg, ok, err := h.effectiveOAuthConfig(meta.Provider)
		if err != nil {
			fail(c, http.StatusInternalServerError, err.Error())
			return
		}
		if !ok {
			continue
		}
		providers = append(providers, h.oauthProviderDTO(meta, cfg, true))
	}
	ok(c, providers)
}

func (h *Handler) adminUpdateOAuthProvider(c *gin.Context) {
	if !h.requireAdmin(c) {
		return
	}
	provider := strings.ToLower(strings.TrimSpace(c.Param("provider")))
	meta, known := knownOAuthProvider(provider)
	if !known {
		fail(c, http.StatusNotFound, "oauth provider not found")
		return
	}
	current, _, err := h.effectiveOAuthConfig(provider)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	var input struct {
		ClientID     *string `json:"client_id"`
		ClientSecret *string `json:"client_secret"`
		RedirectURL  *string `json:"redirect_url"`
		Enabled      *bool   `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		fail(c, http.StatusBadRequest, "invalid json")
		return
	}
	if input.ClientID != nil {
		current.ClientID = strings.TrimSpace(*input.ClientID)
	}
	if input.ClientSecret != nil {
		secret := strings.TrimSpace(*input.ClientSecret)
		if secret != "" && secret != "***" {
			current.ClientSecret = secret
		}
	}
	if input.RedirectURL != nil {
		current.RedirectURL = strings.TrimSpace(*input.RedirectURL)
	}
	if current.RedirectURL == "" {
		current.RedirectURL = h.defaultOAuthRedirectURL(provider)
	}
	if err := validateOAuthRedirectURL(provider, current.RedirectURL); err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	if input.Enabled != nil {
		current.Enabled = *input.Enabled
	}
	if current.Enabled && !oauthConfigConfigured(current) {
		fail(c, http.StatusBadRequest, "client_id and client_secret are required before enabling this provider")
		return
	}
	setting := models.OAuthProviderSetting{
		Provider:     provider,
		ClientID:     current.ClientID,
		ClientSecret: current.ClientSecret,
		RedirectURL:  current.RedirectURL,
		Enabled:      current.Enabled,
	}
	if err := h.DB.Save(&setting).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	h.audit("oauth_provider.patch", actor(c), provider, "")
	ok(c, h.oauthProviderDTO(meta, current, true))
}

func (h *Handler) oauthRedirect(c *gin.Context) {
	provider := strings.ToLower(strings.TrimSpace(c.Param("provider")))
	cfg, meta, available := h.oauthProviderForLogin(provider)
	if !available {
		fail(c, http.StatusNotFound, "oauth provider not available")
		return
	}
	if err := validateOAuthRedirectURL(provider, cfg.RedirectURL); err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	state, err := randomURLToken(32)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	mode := strings.ToLower(strings.TrimSpace(c.Query("mode")))
	if mode == "" {
		mode = oauthModeLogin
	}
	var userID uint
	if mode == oauthModeBind {
		user, ok := h.requireLogin(c)
		if !ok {
			return
		}
		userID = user.ID
	} else if mode != oauthModeLogin {
		fail(c, http.StatusBadRequest, "invalid oauth mode")
		return
	}
	redirect := sanitizeOAuthRedirect(c.Query("redirect"))
	cookieValue, err := h.encodeOAuthStateCookie(oauthStateCookie{
		Provider:  provider,
		State:     state,
		Redirect:  redirect,
		Mode:      mode,
		UserID:    userID,
		ExpiresAt: time.Now().Add(oauthStateTTL).Unix(),
	})
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	setOAuthCookie(c, oauthStateCookieName(provider), cookieValue, oauthStateTTL)
	c.Redirect(http.StatusFound, buildOAuthAuthorizeURL(meta.Provider, cfg, state))
}

func (h *Handler) oauthCallback(c *gin.Context) {
	provider := strings.ToLower(strings.TrimSpace(c.Param("provider")))
	cfg, _, available := h.oauthProviderForLogin(provider)
	if !available {
		fail(c, http.StatusNotFound, "oauth provider not available")
		return
	}
	if errValue := strings.TrimSpace(c.Query("error")); errValue != "" {
		fail(c, http.StatusBadRequest, errValue)
		return
	}
	code := strings.TrimSpace(c.Query("code"))
	state := strings.TrimSpace(c.Query("state"))
	if code == "" || state == "" {
		fail(c, http.StatusBadRequest, "oauth code and state are required")
		return
	}
	stateRecord, valid := h.consumeOAuthState(c, provider)
	if !valid || stateRecord.State != state || stateRecord.Provider != provider {
		fail(c, http.StatusBadRequest, "invalid oauth state")
		return
	}
	token, err := h.exchangeOAuthCode(c.Request.Context(), provider, cfg, code)
	if err != nil {
		fail(c, http.StatusBadGateway, err.Error())
		return
	}
	info, err := h.fetchOAuthUserInfo(c.Request.Context(), provider, token)
	if err != nil {
		fail(c, http.StatusBadGateway, err.Error())
		return
	}

	redirect := sanitizeOAuthRedirect(stateRecord.Redirect)

	if stateRecord.Mode == oauthModeBind {
		if stateRecord.UserID == 0 {
			fail(c, http.StatusBadRequest, "invalid bind state")
			return
		}
		user, err := h.bindOAuthIdentity(stateRecord.UserID, provider, info, token)
		if err != nil {
			status := http.StatusBadRequest
			if strings.Contains(strings.ToLower(err.Error()), "already bound") {
				status = http.StatusConflict
			}
			fail(c, status, err.Error())
			return
		}
		h.audit("oauth.bind", user.Email, provider, "")
		redirect = appendOAuthQuery(redirect, "oauth_bound", provider)
		c.Redirect(http.StatusFound, redirect)
		return
	}

	user, isNew, err := h.loginOAuthUser(provider, info, token)
	if err != nil {
		status := http.StatusBadRequest
		if strings.Contains(strings.ToLower(err.Error()), "disabled") {
			status = http.StatusForbidden
		}
		fail(c, status, err.Error())
		return
	}
	sessionToken, err := h.Sessions.Create(user.ID, user.Role, 7*24*time.Hour)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	setSessionCookie(c, sessionToken, 7*24*time.Hour)
	if isNew {
		redirect = appendOAuthQuery(redirect, "oauth_register", provider)
	}
	c.Redirect(http.StatusFound, redirect)
}

func (h *Handler) oauthProviderForLogin(provider string) (config.OAuthProviderConfig, oauthProviderMeta, bool) {
	meta, known := knownOAuthProvider(provider)
	if !known {
		return config.OAuthProviderConfig{}, oauthProviderMeta{}, false
	}
	cfg, ok, err := h.effectiveOAuthConfig(provider)
	if err != nil || !ok || !cfg.Enabled || !oauthConfigConfigured(cfg) {
		return config.OAuthProviderConfig{}, oauthProviderMeta{}, false
	}
	return cfg, meta, true
}

func (h *Handler) effectiveOAuthConfig(provider string) (config.OAuthProviderConfig, bool, error) {
	provider = strings.ToLower(strings.TrimSpace(provider))
	if _, ok := knownOAuthProvider(provider); !ok {
		return config.OAuthProviderConfig{}, false, nil
	}
	cfg := config.OAuthProviderConfig{}
	switch provider {
	case oauthProviderGitHub:
		cfg = h.Config.GitHubOAuth
	case oauthProviderLinuxDo:
		cfg = h.Config.LinuxDoOAuth
	}
	var setting models.OAuthProviderSetting
	err := h.DB.First(&setting, "provider = ?", provider).Error
	if err == nil {
		cfg = config.OAuthProviderConfig{
			ClientID:     strings.TrimSpace(setting.ClientID),
			ClientSecret: strings.TrimSpace(setting.ClientSecret),
			RedirectURL:  strings.TrimSpace(setting.RedirectURL),
			Enabled:      setting.Enabled,
		}
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return cfg, true, err
	}
	if cfg.RedirectURL == "" {
		cfg.RedirectURL = h.defaultOAuthRedirectURL(provider)
	}
	return cfg, true, nil
}

func (h *Handler) defaultOAuthRedirectURL(provider string) string {
	base := strings.TrimRight(strings.TrimSpace(h.Config.PublicBaseURL), "/")
	if base == "" {
		base = "http://localhost:3000"
	}
	return base + "/api/oauth/" + provider + "/callback"
}

func (h *Handler) oauthProviderDTO(meta oauthProviderMeta, cfg config.OAuthProviderConfig, admin bool) oauthProviderDTO {
	dto := oauthProviderDTO{
		Provider:   meta.Provider,
		Name:       meta.Name,
		Enabled:    cfg.Enabled,
		Configured: oauthConfigConfigured(cfg),
		AuthURL:    "/api/oauth/" + meta.Provider + "/login",
	}
	if admin {
		dto.ClientID = cfg.ClientID
		dto.RedirectURL = cfg.RedirectURL
		if cfg.ClientSecret != "" {
			dto.ClientSecret = "***"
		}
	}
	return dto
}

func oauthConfigConfigured(cfg config.OAuthProviderConfig) bool {
	return strings.TrimSpace(cfg.ClientID) != "" && strings.TrimSpace(cfg.ClientSecret) != ""
}

func validateOAuthRedirectURL(provider, redirectURL string) error {
	parsed, err := url.Parse(strings.TrimSpace(redirectURL))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return fmt.Errorf("redirect_url must be an absolute http(s) URL")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return fmt.Errorf("redirect_url must use http or https")
	}
	wantPath := "/api/oauth/" + provider + "/callback"
	if strings.TrimRight(parsed.Path, "/") != wantPath {
		return fmt.Errorf("redirect_url path must be %s", wantPath)
	}
	return nil
}

func buildOAuthAuthorizeURL(provider string, cfg config.OAuthProviderConfig, state string) string {
	values := url.Values{}
	values.Set("client_id", cfg.ClientID)
	values.Set("redirect_uri", cfg.RedirectURL)
	values.Set("state", state)
	switch provider {
	case oauthProviderGitHub:
		values.Set("scope", "user:email")
		return "https://github.com/login/oauth/authorize?" + values.Encode()
	case oauthProviderLinuxDo:
		values.Set("response_type", "code")
		values.Set("scope", "read")
		return "https://connect.linux.do/oauth2/authorize?" + values.Encode()
	default:
		return ""
	}
}

func (h *Handler) exchangeOAuthCode(ctx context.Context, provider string, cfg config.OAuthProviderConfig, code string) (oauthToken, error) {
	switch provider {
	case oauthProviderGitHub:
		return exchangeGitHubOAuthCode(ctx, cfg, code)
	case oauthProviderLinuxDo:
		return exchangeLinuxDoOAuthCode(ctx, cfg, code)
	default:
		return oauthToken{}, fmt.Errorf("unsupported oauth provider")
	}
}

func exchangeGitHubOAuthCode(ctx context.Context, cfg config.OAuthProviderConfig, code string) (oauthToken, error) {
	payload, _ := json.Marshal(map[string]string{
		"client_id":     cfg.ClientID,
		"client_secret": cfg.ClientSecret,
		"code":          code,
		"redirect_uri":  cfg.RedirectURL,
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://github.com/login/oauth/access_token", bytes.NewReader(payload))
	if err != nil {
		return oauthToken{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	var out struct {
		AccessToken string `json:"access_token"`
		Scope       string `json:"scope"`
		TokenType   string `json:"token_type"`
		Error       string `json:"error"`
		Description string `json:"error_description"`
	}
	if err := doOAuthJSON(req, &out); err != nil {
		return oauthToken{}, err
	}
	if out.Error != "" {
		return oauthToken{}, fmt.Errorf("github oauth error: %s", out.Description)
	}
	if out.AccessToken == "" {
		return oauthToken{}, fmt.Errorf("github oauth did not return an access token")
	}
	return oauthToken{AccessToken: out.AccessToken}, nil
}

func exchangeLinuxDoOAuthCode(ctx context.Context, cfg config.OAuthProviderConfig, code string) (oauthToken, error) {
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("code", code)
	form.Set("client_id", cfg.ClientID)
	form.Set("client_secret", cfg.ClientSecret)
	form.Set("redirect_uri", cfg.RedirectURL)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://connect.linux.do/oauth2/token", strings.NewReader(form.Encode()))
	if err != nil {
		return oauthToken{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	var out struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int64  `json:"expires_in"`
		IDToken      string `json:"id_token"`
		Error        string `json:"error"`
		Description  string `json:"error_description"`
	}
	if err := doOAuthJSON(req, &out); err != nil {
		return oauthToken{}, err
	}
	if out.Error != "" {
		return oauthToken{}, fmt.Errorf("linux.do oauth error: %s", out.Description)
	}
	if out.AccessToken == "" {
		return oauthToken{}, fmt.Errorf("linux.do oauth did not return an access token")
	}
	var expiry *time.Time
	if out.ExpiresIn > 0 {
		t := time.Now().Add(time.Duration(out.ExpiresIn) * time.Second)
		expiry = &t
	}
	return oauthToken{AccessToken: out.AccessToken, RefreshToken: out.RefreshToken, Expiry: expiry, IDToken: out.IDToken}, nil
}

func (h *Handler) fetchOAuthUserInfo(ctx context.Context, provider string, token oauthToken) (OAuthUserInfo, error) {
	switch provider {
	case oauthProviderGitHub:
		return fetchGitHubUserInfo(ctx, token.AccessToken)
	case oauthProviderLinuxDo:
		return fetchLinuxDoUserInfo(ctx, token)
	default:
		return OAuthUserInfo{}, fmt.Errorf("unsupported oauth provider")
	}
}

func fetchGitHubUserInfo(ctx context.Context, accessToken string) (OAuthUserInfo, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.github.com/user", nil)
	if err != nil {
		return OAuthUserInfo{}, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/json")
	var out struct {
		ID        int64  `json:"id"`
		Login     string `json:"login"`
		Name      string `json:"name"`
		Email     string `json:"email"`
		AvatarURL string `json:"avatar_url"`
	}
	if err := doOAuthJSON(req, &out); err != nil {
		return OAuthUserInfo{}, err
	}
	email := strings.TrimSpace(out.Email)
	if email == "" {
		email, err = fetchGitHubPrimaryEmail(ctx, accessToken)
		if err != nil {
			return OAuthUserInfo{}, err
		}
	}
	name := strings.TrimSpace(out.Name)
	if name == "" {
		name = strings.TrimSpace(out.Login)
	}
	return OAuthUserInfo{
		ProviderUID: strconv.FormatInt(out.ID, 10),
		Email:       email,
		Name:        name,
		AvatarURL:   strings.TrimSpace(out.AvatarURL),
	}, nil
}

func fetchGitHubPrimaryEmail(ctx context.Context, accessToken string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.github.com/user/emails", nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/json")
	var emails []struct {
		Email    string `json:"email"`
		Primary  bool   `json:"primary"`
		Verified bool   `json:"verified"`
	}
	if err := doOAuthJSON(req, &emails); err != nil {
		return "", err
	}
	for _, email := range emails {
		if email.Primary && email.Verified && strings.TrimSpace(email.Email) != "" {
			return email.Email, nil
		}
	}
	for _, email := range emails {
		if email.Verified && strings.TrimSpace(email.Email) != "" {
			return email.Email, nil
		}
	}
	return "", fmt.Errorf("github account has no verified email available")
}

func fetchLinuxDoUserInfo(ctx context.Context, token oauthToken) (OAuthUserInfo, error) {
	raw, _, err := getOAuthRaw(ctx, "https://connect.linux.do/api/user", token.AccessToken)
	if err != nil {
		var httpErr oauthHTTPError
		if !errors.As(err, &httpErr) || httpErr.Status != http.StatusNotFound {
			if token.IDToken == "" {
				return OAuthUserInfo{}, err
			}
			return linuxDoInfoFromJWT(token.IDToken)
		}
		raw, _, err = getOAuthRaw(ctx, "https://connect.linux.do/oauth2/userinfo", token.AccessToken)
		if err != nil {
			if token.IDToken == "" {
				return OAuthUserInfo{}, err
			}
			return linuxDoInfoFromJWT(token.IDToken)
		}
	}
	info, err := decodeLinuxDoUserInfo(raw)
	if err == nil && info.Email != "" && info.ProviderUID != "" {
		return info, nil
	}
	if token.IDToken != "" {
		fallback, fallbackErr := linuxDoInfoFromJWT(token.IDToken)
		if fallbackErr == nil {
			if info.ProviderUID == "" {
				info.ProviderUID = fallback.ProviderUID
			}
			if info.Email == "" {
				info.Email = fallback.Email
			}
			if info.Name == "" {
				info.Name = fallback.Name
			}
			if info.AvatarURL == "" {
				info.AvatarURL = fallback.AvatarURL
			}
		}
	}
	if err != nil {
		return OAuthUserInfo{}, err
	}
	return info, nil
}

func decodeLinuxDoUserInfo(raw []byte) (OAuthUserInfo, error) {
	body := strings.TrimSpace(string(raw))
	if body == "" {
		return OAuthUserInfo{}, fmt.Errorf("linux.do userinfo response is empty")
	}
	if strings.Count(body, ".") == 2 && !strings.HasPrefix(body, "{") {
		return linuxDoInfoFromJWT(body)
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		var token string
		if json.Unmarshal(raw, &token) == nil && strings.Count(token, ".") == 2 {
			return linuxDoInfoFromJWT(token)
		}
		return OAuthUserInfo{}, err
	}
	if nested, ok := payload["user"].(map[string]any); ok {
		for key, value := range payload {
			if _, exists := nested[key]; !exists {
				nested[key] = value
			}
		}
		payload = nested
	}
	return linuxDoInfoFromMap(payload), nil
}

func linuxDoInfoFromJWT(token string) (OAuthUserInfo, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return OAuthUserInfo{}, fmt.Errorf("invalid linux.do id token")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return OAuthUserInfo{}, err
	}
	var claims map[string]any
	if err := json.Unmarshal(payload, &claims); err != nil {
		return OAuthUserInfo{}, err
	}
	return linuxDoInfoFromMap(claims), nil
}

func linuxDoInfoFromMap(payload map[string]any) OAuthUserInfo {
	avatar := firstString(payload, "picture", "avatar_url", "avatar_template")
	if strings.Contains(avatar, "{size}") {
		avatar = strings.ReplaceAll(avatar, "{size}", "96")
	}
	if strings.HasPrefix(avatar, "/") {
		avatar = "https://connect.linux.do" + avatar
	}
	return OAuthUserInfo{
		ProviderUID: firstString(payload, "sub", "id", "user_id"),
		Email:       firstString(payload, "email"),
		Name:        firstString(payload, "name", "username", "login"),
		AvatarURL:   avatar,
	}
}

func firstString(payload map[string]any, keys ...string) string {
	for _, key := range keys {
		value, exists := payload[key]
		if !exists || value == nil {
			continue
		}
		switch typed := value.(type) {
		case string:
			if strings.TrimSpace(typed) != "" {
				return strings.TrimSpace(typed)
			}
		case float64:
			return strconv.FormatInt(int64(typed), 10)
		case json.Number:
			return typed.String()
		default:
			text := strings.TrimSpace(fmt.Sprint(typed))
			if text != "" && text != "<nil>" {
				return text
			}
		}
	}
	return ""
}

func doOAuthJSON(req *http.Request, target any) error {
	raw, contentType, err := doOAuthRequest(req)
	if err != nil {
		return err
	}
	if !strings.Contains(strings.ToLower(contentType), "json") && len(raw) > 0 && raw[0] != '{' && raw[0] != '[' {
		return fmt.Errorf("oauth provider returned non-json response")
	}
	return json.Unmarshal(raw, target)
}

func getOAuthRaw(ctx context.Context, endpoint, accessToken string) ([]byte, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/json")
	return doOAuthRequest(req)
}

func doOAuthRequest(req *http.Request) ([]byte, string, error) {
	resp, err := oauthHTTPClient.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	raw, readErr := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if readErr != nil {
		return nil, "", readErr
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, resp.Header.Get("Content-Type"), oauthHTTPError{Status: resp.StatusCode, Body: string(raw)}
	}
	return raw, resp.Header.Get("Content-Type"), nil
}

func (h *Handler) loginOAuthUser(provider string, info OAuthUserInfo, token oauthToken) (*models.User, bool, error) {
	info.ProviderUID = strings.TrimSpace(info.ProviderUID)
	info.Email = strings.ToLower(strings.TrimSpace(info.Email))
	info.AvatarURL = strings.TrimSpace(info.AvatarURL)
	if info.ProviderUID == "" {
		return nil, false, fmt.Errorf("oauth provider did not return a user id")
	}
	if !strings.Contains(info.Email, "@") {
		return nil, false, fmt.Errorf("oauth provider did not return a verified email")
	}
	isNew := false
	var user models.User
	err := h.DB.Transaction(func(tx *gorm.DB) error {
		var identity models.OAuthIdentity
		err := tx.Where("provider = ? AND provider_uid = ?", provider, info.ProviderUID).First(&identity).Error
		if err == nil {
			if err := tx.First(&user, "id = ? AND enabled = ?", identity.UserID, true).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return fmt.Errorf("bound user is disabled or no longer exists")
				}
				return err
			}
			if err := updateOAuthUserProfile(tx, &user, info); err != nil {
				return err
			}
			return tx.Model(&identity).Updates(map[string]any{
				"token_expiry": token.Expiry,
			}).Error
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		err = tx.Where("email = ?", info.Email).First(&user).Error
		if err == nil {
			if !user.Enabled {
				return fmt.Errorf("matched user is disabled")
			}
			if err := updateOAuthUserProfile(tx, &user, info); err != nil {
				return err
			}
		} else if errors.Is(err, gorm.ErrRecordNotFound) {
			password, err := randomURLToken(32)
			if err != nil {
				return err
			}
			hash, err := auth.HashSecret(password)
			if err != nil {
				return err
			}
			user = models.User{
				Email:         info.Email,
				PasswordHash:  hash,
				AvatarURL:     info.AvatarURL,
				EmailVerified: true,
				Role:          models.UserRoleUser,
				Enabled:       true,
				DailyLimit:    1000,
				TotalLimit:    0,
			}
			if err := tx.Create(&user).Error; err != nil {
				return err
			}
			isNew = true
		} else {
			return err
		}
		identity = models.OAuthIdentity{
			UserID:      user.ID,
			Provider:    provider,
			ProviderUID: info.ProviderUID,
			TokenExpiry: token.Expiry,
		}
		return tx.Create(&identity).Error
	})
	if err != nil {
		return nil, false, err
	}
	h.audit("oauth.login", user.Email, provider, "")
	return &user, isNew, nil
}

func (h *Handler) bindOAuthIdentity(userID uint, provider string, info OAuthUserInfo, token oauthToken) (*models.User, error) {
	info.ProviderUID = strings.TrimSpace(info.ProviderUID)
	info.Email = strings.ToLower(strings.TrimSpace(info.Email))
	if info.ProviderUID == "" {
		return nil, fmt.Errorf("oauth provider did not return a user id")
	}
	var user models.User
	if err := h.DB.Transaction(func(tx *gorm.DB) error {
		var existing models.OAuthIdentity
		if err := tx.Where("user_id = ? AND provider = ?", userID, provider).First(&existing).Error; err == nil {
			return fmt.Errorf("already bound to this account")
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if err := tx.Where("provider = ? AND provider_uid = ?", provider, info.ProviderUID).First(&existing).Error; err == nil {
			if existing.UserID == userID {
				return fmt.Errorf("already bound to this account")
			}
			return fmt.Errorf("this %s account is already bound to another user", provider)
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if err := tx.First(&user, "id = ? AND enabled = ?", userID, true).Error; err != nil {
			return fmt.Errorf("user not found or disabled")
		}
		if err := updateOAuthUserProfile(tx, &user, info); err != nil {
			return err
		}
		identity := models.OAuthIdentity{
			UserID:      userID,
			Provider:    provider,
			ProviderUID: info.ProviderUID,
			TokenExpiry: token.Expiry,
		}
		return tx.Create(&identity).Error
	}); err != nil {
		return nil, err
	}
	return &user, nil
}

func appendOAuthQuery(redirect, key, value string) string {
	sep := "?"
	if strings.Contains(redirect, "?") {
		sep = "&"
	}
	return redirect + sep + url.QueryEscape(key) + "=" + url.QueryEscape(value)
}

func updateOAuthUserProfile(tx *gorm.DB, user *models.User, info OAuthUserInfo) error {
	updates := map[string]any{"email_verified": true}
	user.EmailVerified = true
	if info.AvatarURL != "" && user.AvatarURL != info.AvatarURL {
		updates["avatar_url"] = info.AvatarURL
		user.AvatarURL = info.AvatarURL
	}
	return tx.Model(user).Updates(updates).Error
}

func (h *Handler) encodeOAuthStateCookie(record oauthStateCookie) (string, error) {
	raw, err := json.Marshal(record)
	if err != nil {
		return "", err
	}
	payload := base64.RawURLEncoding.EncodeToString(raw)
	signature := signOAuthPayload(h.oauthHMACKey(), payload)
	return payload + "." + signature, nil
}

func (h *Handler) decodeOAuthStateCookie(value string) (oauthStateCookie, bool) {
	payload, signature, found := strings.Cut(value, ".")
	if !found || payload == "" || signature == "" {
		return oauthStateCookie{}, false
	}
	if !hmac.Equal([]byte(signature), []byte(signOAuthPayload(h.oauthHMACKey(), payload))) {
		return oauthStateCookie{}, false
	}
	raw, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		return oauthStateCookie{}, false
	}
	var record oauthStateCookie
	if err := json.Unmarshal(raw, &record); err != nil {
		return oauthStateCookie{}, false
	}
	if record.ExpiresAt < time.Now().Unix() {
		return oauthStateCookie{}, false
	}
	return record, true
}

func (h *Handler) oauthHMACKey() []byte {
	if len(h.Sessions.Secret) > 0 {
		return h.Sessions.Secret
	}
	return []byte("oauth-state:" + h.Config.SessionSecret)
}

func signOAuthPayload(key []byte, payload string) string {
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func (h *Handler) consumeOAuthState(c *gin.Context, provider string) (oauthStateCookie, bool) {
	name := oauthStateCookieName(provider)
	value, err := c.Cookie(name)
	setOAuthCookie(c, name, "", -time.Hour)
	if err != nil || value == "" {
		return oauthStateCookie{}, false
	}
	return h.decodeOAuthStateCookie(value)
}

func oauthStateCookieName(provider string) string {
	return "gptmail_oauth_state_" + provider
}

func setOAuthCookie(c *gin.Context, name, value string, ttl time.Duration) {
	maxAge := int(ttl.Seconds())
	if ttl < 0 {
		maxAge = -1
	}
	isSecure := c.Request.TLS != nil || strings.EqualFold(c.GetHeader("X-Forwarded-Proto"), "https")
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(name, value, maxAge, "/", "", isSecure, true)
}

func sanitizeOAuthRedirect(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "/"
	}
	if strings.HasPrefix(value, "#") {
		return "/" + value
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.IsAbs() || parsed.Host != "" || !strings.HasPrefix(value, "/") || strings.HasPrefix(value, "//") {
		return "/"
	}
	return value
}

type oauthIdentityDTO struct {
	Provider  string `json:"provider"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatar_url"`
	BoundAt   string `json:"bound_at"`
}

func (h *Handler) listUserOAuthIdentities(c *gin.Context) {
	user, loggedIn := h.requireLogin(c)
	if !loggedIn {
		return
	}
	var identities []models.OAuthIdentity
	if err := h.DB.Where("user_id = ?", user.ID).Find(&identities).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	metas := oauthProviderMetas()
	nameByProvider := make(map[string]string, len(metas))
	for _, meta := range metas {
		nameByProvider[meta.Provider] = meta.Name
	}
	result := make([]oauthIdentityDTO, 0, len(identities))
	for _, idt := range identities {
		name := nameByProvider[idt.Provider]
		if name == "" {
			name = idt.Provider
		}
		avatar := user.AvatarURL
		result = append(result, oauthIdentityDTO{
			Provider:  idt.Provider,
			Name:      name,
			AvatarURL: avatar,
			BoundAt:   idt.CreatedAt.Format(time.RFC3339),
		})
	}
	ok(c, result)
}

func (h *Handler) unbindUserOAuthIdentity(c *gin.Context) {
	user, loggedIn := h.requireLogin(c)
	if !loggedIn {
		return
	}
	provider := strings.ToLower(strings.TrimSpace(c.Param("provider")))
	if _, known := knownOAuthProvider(provider); !known {
		fail(c, http.StatusNotFound, "oauth provider not found")
		return
	}
	var identity models.OAuthIdentity
	if err := h.DB.Where("user_id = ? AND provider = ?", user.ID, provider).First(&identity).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			fail(c, http.StatusNotFound, "no bound identity for this provider")
			return
		}
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	if err := h.DB.Where("user_id = ? AND provider = ?", user.ID, provider).Delete(&models.OAuthIdentity{}).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	h.audit("oauth.unbind", user.Email, provider, "")
	ok(c, gin.H{"provider": provider, "unbound": true})
}

func randomURLToken(size int) (string, error) {
	buf := make([]byte, size)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}
