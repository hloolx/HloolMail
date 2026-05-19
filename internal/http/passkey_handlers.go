package httpapi

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"gptmail/internal/auth"
	appdb "gptmail/internal/db"
	"gptmail/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
	"gorm.io/gorm"
)

const (
	passkeySessionRegister = "register"
	passkeySessionLogin    = "login"
	passkeySessionTTL      = 5 * time.Minute
)

type passkeyUser struct {
	user        models.User
	credentials []webauthn.Credential
}

func (u passkeyUser) WebAuthnID() []byte {
	return []byte(strconv.FormatUint(uint64(u.user.ID), 10))
}

func (u passkeyUser) WebAuthnName() string {
	return u.user.Email
}

func (u passkeyUser) WebAuthnDisplayName() string {
	return u.user.Email
}

func (u passkeyUser) WebAuthnCredentials() []webauthn.Credential {
	return u.credentials
}

type passkeyDTO struct {
	ID         uint       `json:"id"`
	Name       string     `json:"name"`
	LastUsedAt *time.Time `json:"last_used_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
}

func (h *Handler) listUserPasskeys(c *gin.Context) {
	user, loggedIn := h.requireLogin(c)
	if !loggedIn {
		return
	}
	var credentials []models.PasskeyCredential
	if err := h.DB.Where("user_id = ?", user.ID).Order("created_at desc").Find(&credentials).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	result := make([]passkeyDTO, 0, len(credentials))
	for _, credential := range credentials {
		result = append(result, passkeyDTO{
			ID:         credential.ID,
			Name:       credential.Name,
			LastUsedAt: credential.LastUsedAt,
			CreatedAt:  credential.CreatedAt,
		})
	}
	ok(c, result)
}

func (h *Handler) beginPasskeyRegistration(c *gin.Context) {
	user, loggedIn := h.requireLogin(c)
	if !loggedIn {
		return
	}
	if !h.passkeysEnabled(c) {
		return
	}
	webAuthn, err := h.webAuthn(c)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	passkeyUser, err := h.loadPasskeyUser(*user)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	creation, sessionData, err := webAuthn.BeginRegistration(passkeyUser,
		webauthn.WithResidentKeyRequirement(protocol.ResidentKeyRequirementPreferred),
		webauthn.WithAuthenticatorSelection(protocol.AuthenticatorSelection{UserVerification: protocol.VerificationPreferred}),
		webauthn.WithExclusions(webauthn.Credentials(passkeyUser.WebAuthnCredentials()).CredentialDescriptors()),
	)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	sessionID, err := h.saveWebAuthnSession(user.ID, passkeySessionRegister, sessionData)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	ok(c, gin.H{"session_id": sessionID, "options": creation})
}

func (h *Handler) finishPasskeyRegistration(c *gin.Context) {
	user, loggedIn := h.requireLogin(c)
	if !loggedIn {
		return
	}
	if !h.passkeysEnabled(c) {
		return
	}
	sessionID := strings.TrimSpace(c.Query("session_id"))
	sessionData, err := h.consumeWebAuthnSession(sessionID, user.ID, passkeySessionRegister)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	webAuthn, err := h.webAuthn(c)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	passkeyUser, err := h.loadPasskeyUser(*user)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	credential, err := webAuthn.FinishRegistration(passkeyUser, sessionData, c.Request)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	raw, err := json.Marshal(credential)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	name := "Passkey"
	if len(passkeyUser.credentials) > 0 {
		name = fmt.Sprintf("Passkey %d", len(passkeyUser.credentials)+1)
	}
	record := models.PasskeyCredential{
		UserID:       user.ID,
		CredentialID: base64.RawURLEncoding.EncodeToString(credential.ID),
		Name:         name,
		Credential:   string(raw),
	}
	if err := h.DB.Create(&record).Error; err != nil {
		fail(c, http.StatusConflict, "passkey already bound")
		return
	}
	h.audit("passkey.register", user.Email, record.Name, "")
	ok(c, passkeyDTO{ID: record.ID, Name: record.Name, CreatedAt: record.CreatedAt})
}

func (h *Handler) deleteUserPasskey(c *gin.Context) {
	user, loggedIn := h.requireLogin(c)
	if !loggedIn {
		return
	}
	id, err := auth.ParseUintID(c.Param("id"))
	if err != nil {
		fail(c, http.StatusBadRequest, "invalid passkey id")
		return
	}
	var credential models.PasskeyCredential
	if err := h.DB.Where("id = ? AND user_id = ?", id, user.ID).First(&credential).Error; err != nil {
		fail(c, http.StatusNotFound, "passkey not found")
		return
	}
	if err := h.DB.Delete(&credential).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	h.audit("passkey.delete", user.Email, credential.Name, "")
	ok(c, gin.H{"deleted": true})
}

func (h *Handler) beginPasskeyLogin(c *gin.Context) {
	if !h.isInstalled() {
		fail(c, http.StatusPreconditionRequired, "install required")
		return
	}
	if !h.passkeysEnabled(c) {
		return
	}
	var input struct {
		Email string `json:"email"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		fail(c, http.StatusBadRequest, "invalid json")
		return
	}
	var user models.User
	if err := h.DB.Where("email = ? AND enabled = ?", strings.ToLower(strings.TrimSpace(input.Email)), true).First(&user).Error; err != nil {
		fail(c, http.StatusUnauthorized, "no passkey found for this account")
		return
	}
	passkeyUser, err := h.loadPasskeyUser(user)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	if len(passkeyUser.credentials) == 0 {
		fail(c, http.StatusUnauthorized, "no passkey found for this account")
		return
	}
	webAuthn, err := h.webAuthn(c)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	assertion, sessionData, err := webAuthn.BeginLogin(passkeyUser, webauthn.WithUserVerification(protocol.VerificationPreferred))
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	sessionID, err := h.saveWebAuthnSession(user.ID, passkeySessionLogin, sessionData)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	ok(c, gin.H{"session_id": sessionID, "options": assertion})
}

func (h *Handler) finishPasskeyLogin(c *gin.Context) {
	if !h.isInstalled() {
		fail(c, http.StatusPreconditionRequired, "install required")
		return
	}
	if !h.passkeysEnabled(c) {
		return
	}
	sessionID := strings.TrimSpace(c.Query("session_id"))
	sessionRecord, sessionData, err := h.consumeAnyWebAuthnSession(sessionID, passkeySessionLogin)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	var user models.User
	if err := h.DB.Where("id = ? AND enabled = ?", sessionRecord.UserID, true).First(&user).Error; err != nil {
		fail(c, http.StatusUnauthorized, "user disabled or not found")
		return
	}
	passkeyUser, err := h.loadPasskeyUser(user)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	webAuthn, err := h.webAuthn(c)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	credential, err := webAuthn.FinishLogin(passkeyUser, sessionData, c.Request)
	if err != nil {
		fail(c, http.StatusUnauthorized, err.Error())
		return
	}
	if err := h.updateStoredPasskey(user.ID, credential); err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	token, err := h.Sessions.Create(user.ID, user.Role, 7*24*time.Hour)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	setSessionCookie(c, token, 7*24*time.Hour)
	h.audit("passkey.login", user.Email, "", "")
	ok(c, user)
}

func (h *Handler) loadPasskeyUser(user models.User) (passkeyUser, error) {
	var records []models.PasskeyCredential
	if err := h.DB.Where("user_id = ?", user.ID).Find(&records).Error; err != nil {
		return passkeyUser{}, err
	}
	credentials := make([]webauthn.Credential, 0, len(records))
	for _, record := range records {
		var credential webauthn.Credential
		if err := json.Unmarshal([]byte(record.Credential), &credential); err != nil {
			continue
		}
		credentials = append(credentials, credential)
	}
	return passkeyUser{user: user, credentials: credentials}, nil
}

func (h *Handler) updateStoredPasskey(userID uint, credential *webauthn.Credential) error {
	raw, err := json.Marshal(credential)
	if err != nil {
		return err
	}
	now := time.Now()
	credentialID := base64.RawURLEncoding.EncodeToString(credential.ID)
	result := h.DB.Model(&models.PasskeyCredential{}).
		Where("user_id = ? AND credential_id = ?", userID, credentialID).
		Updates(map[string]interface{}{"credential": string(raw), "last_used_at": &now})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return fmt.Errorf("passkey not found")
	}
	return nil
}

func (h *Handler) saveWebAuthnSession(userID uint, kind string, sessionData *webauthn.SessionData) (string, error) {
	raw, err := json.Marshal(sessionData)
	if err != nil {
		return "", err
	}
	id, err := randomURLToken(32)
	if err != nil {
		return "", err
	}
	record := models.WebAuthnSession{
		ID:        id,
		UserID:    userID,
		Kind:      kind,
		Data:      string(raw),
		ExpiresAt: time.Now().Add(passkeySessionTTL),
	}
	if err := h.DB.Create(&record).Error; err != nil {
		return "", err
	}
	return id, nil
}

func (h *Handler) consumeWebAuthnSession(id string, userID uint, kind string) (webauthn.SessionData, error) {
	record, sessionData, err := h.consumeAnyWebAuthnSession(id, kind)
	if err != nil {
		return webauthn.SessionData{}, err
	}
	if record.UserID != userID {
		return webauthn.SessionData{}, fmt.Errorf("invalid passkey session")
	}
	return sessionData, nil
}

func (h *Handler) consumeAnyWebAuthnSession(id string, kind string) (models.WebAuthnSession, webauthn.SessionData, error) {
	if id == "" {
		return models.WebAuthnSession{}, webauthn.SessionData{}, fmt.Errorf("missing passkey session")
	}
	var record models.WebAuthnSession
	err := h.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("id = ? AND kind = ? AND expires_at > ?", id, kind, time.Now()).First(&record).Error; err != nil {
			return err
		}
		return tx.Delete(&record).Error
	})
	if err != nil {
		return models.WebAuthnSession{}, webauthn.SessionData{}, fmt.Errorf("invalid or expired passkey session")
	}
	var sessionData webauthn.SessionData
	if err := json.Unmarshal([]byte(record.Data), &sessionData); err != nil {
		return models.WebAuthnSession{}, webauthn.SessionData{}, err
	}
	return record, sessionData, nil
}

func (h *Handler) passkeysEnabled(c *gin.Context) bool {
	settings, err := appdb.EnsureLoginSettings(h.DB)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return false
	}
	if !settings.PasskeyEnabled {
		fail(c, http.StatusForbidden, "passkey login is disabled")
		return false
	}
	return true
}

func (h *Handler) webAuthn(c *gin.Context) (*webauthn.WebAuthn, error) {
	origin := h.webAuthnOrigin(c)
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return nil, fmt.Errorf("invalid public base url for passkey")
	}
	rpID := parsed.Hostname()
	return webauthn.New(&webauthn.Config{
		RPDisplayName: "HLOOL Mail",
		RPID:          rpID,
		RPOrigins:     []string{origin},
	})
}

func (h *Handler) webAuthnOrigin(c *gin.Context) string {
	if base := strings.TrimRight(strings.TrimSpace(h.Config.PublicBaseURL), "/"); base != "" {
		if parsed, err := url.Parse(base); err == nil && parsed.Scheme != "" && parsed.Host != "" {
			return parsed.Scheme + "://" + parsed.Host
		}
	}
	scheme := "http"
	if c.Request.TLS != nil || strings.EqualFold(c.GetHeader("X-Forwarded-Proto"), "https") {
		scheme = "https"
	}
	return scheme + "://" + c.Request.Host
}
