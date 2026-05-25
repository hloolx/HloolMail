package httpapi

import (
	"fmt"
	"net/http"
	"strings"
	"unicode"
	"unicode/utf8"

	"gptmail/internal/auth"
	"gptmail/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const maxNicknameRunes = 40

func normalizeNickname(value string) (string, error) {
	nickname := strings.TrimSpace(value)
	if nickname == "" {
		return "", fmt.Errorf("nickname is required")
	}
	if utf8.RuneCountInString(nickname) > maxNicknameRunes {
		return "", fmt.Errorf("nickname must be %d characters or fewer", maxNicknameRunes)
	}
	for _, r := range nickname {
		if unicode.IsControl(r) {
			return "", fmt.Errorf("nickname contains invalid characters")
		}
	}
	return nickname, nil
}

func oauthNickname(name, email string) string {
	if nickname, err := normalizeNickname(name); err == nil {
		return nickname
	}
	local, _, _ := strings.Cut(strings.TrimSpace(email), "@")
	if nickname, err := normalizeNickname(local); err == nil {
		return nickname
	}
	return ""
}

func (h *Handler) listUsers(c *gin.Context) {
	if _, ok := h.requireAdminSession(c); !ok {
		return
	}
	page := parsePage(c.Query("page"))
	pageSize := parseLimit(c.Query("page_size"), 20, 100)
	search := strings.TrimSpace(c.Query("search"))
	role := strings.TrimSpace(c.Query("role"))
	status := strings.TrimSpace(c.Query("status"))

	db := h.DB.Model(&models.User{})
	if search != "" {
		like := "%" + strings.ToLower(search) + "%"
		db = db.Where(
			"LOWER(email) LIKE ? OR LOWER(nickname) LIKE ? OR EXISTS (SELECT 1 FROM api_keys WHERE api_keys.owner_id = users.id AND (LOWER(api_keys.name) LIKE ? OR LOWER(api_keys.key_prefix) LIKE ?))",
			like, like, like, like,
		)
	}
	if role == models.UserRoleAdmin || role == models.UserRoleUser {
		db = db.Where("role = ?", role)
	}
	if status == "enabled" {
		db = db.Where("enabled = ?", true)
	} else if status == "disabled" {
		db = db.Where("enabled = ?", false)
	}

	var total int64
	if err := db.Count(&total).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	totalPages := pageCount(total, pageSize)
	if page > totalPages {
		page = totalPages
	}

	var users []models.User
	if err := db.Order("created_at desc").Offset((page - 1) * pageSize).Limit(pageSize).Find(&users).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}

	ok(c, paginatedResponse[UserDTO]{
		Items:      userDTOs(users),
		Page:       page,
		PerPage:    pageSize,
		Total:      total,
		TotalPages: totalPages,
	})
}

func (h *Handler) listUserAPIKeys(c *gin.Context) {
	if _, ok := h.requireAdminSession(c); !ok {
		return
	}
	userID, err := auth.ParseUintID(c.Param("id"))
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	var user models.User
	if err := h.DB.First(&user, "id = ?", userID).Error; err != nil {
		fail(c, http.StatusNotFound, "user not found")
		return
	}
	page := parsePage(c.Query("page"))
	pageSize := parseLimit(c.Query("page_size"), 10, 100)
	search := strings.TrimSpace(c.Query("search"))

	query := h.DB.Model(&models.APIKey{}).Where("owner_id = ?", user.ID)
	if search != "" {
		like := "%" + strings.ToLower(search) + "%"
		query = query.Where("LOWER(name) LIKE ? OR LOWER(key_prefix) LIKE ?", like, like)
	}
	var total int64
	if err := query.Session(&gorm.Session{}).Count(&total).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	totalPages := pageCount(total, pageSize)
	if page > totalPages {
		page = totalPages
	}

	var keys []models.APIKey
	if err := query.Order("created_at desc").Offset((page - 1) * pageSize).Limit(pageSize).Find(&keys).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	ok(c, paginatedResponse[models.APIKey]{
		Items:      keys,
		Page:       page,
		PerPage:    pageSize,
		Total:      total,
		TotalPages: totalPages,
	})
}

func (h *Handler) revealUserAPIKey(c *gin.Context) {
	if _, ok := h.requireAdminSession(c); !ok {
		return
	}
	userID, err := auth.ParseUintID(c.Param("id"))
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	keyID, err := auth.ParseUintID(c.Param("key_id"))
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	var key models.APIKey
	if err := h.DB.First(&key, "id = ? AND owner_id = ?", keyID, userID).Error; err != nil {
		fail(c, http.StatusNotFound, "api key not found")
		return
	}
	h.audit("api_key.reveal", actor(c), key.KeyPrefix, "admin user key view")
	ok(c, gin.H{"plain_key": key.KeyValue})
}

func (h *Handler) createUser(c *gin.Context) {
	if _, ok := h.requireAdminSession(c); !ok {
		return
	}
	var input struct {
		Email      string `json:"email"`
		Nickname   string `json:"nickname"`
		Password   string `json:"password"`
		Role       string `json:"role"`
		DailyLimit int64  `json:"daily_limit"`
		TotalLimit int64  `json:"total_limit"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		fail(c, http.StatusBadRequest, "invalid json")
		return
	}
	email := strings.ToLower(strings.TrimSpace(input.Email))
	if !strings.Contains(email, "@") || len(input.Password) < 8 {
		fail(c, http.StatusBadRequest, "valid email and 8+ character password required")
		return
	}
	var nickname string
	if strings.TrimSpace(input.Nickname) == "" {
		nickname = oauthNickname("", email)
	} else {
		var err error
		nickname, err = normalizeNickname(input.Nickname)
		if err != nil {
			fail(c, http.StatusBadRequest, err.Error())
			return
		}
	}
	if input.DailyLimit < 0 || input.TotalLimit < 0 {
		fail(c, http.StatusBadRequest, "quota limits must be zero or greater")
		return
	}
	role := input.Role
	if role != models.UserRoleAdmin && role != models.UserRoleUser {
		fail(c, http.StatusBadRequest, "role must be 'admin' or 'user'")
		return
	}
	hash, err := auth.HashSecret(input.Password)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	user := models.User{
		Email:         email,
		Nickname:      nickname,
		PasswordHash:  hash,
		EmailVerified: true,
		Role:          role,
		Enabled:       true,
		DailyLimit:    input.DailyLimit,
		TotalLimit:    input.TotalLimit,
	}
	if err := h.DB.Create(&user).Error; err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	h.audit("user.create", actor(c), user.Email, user.Role)
	created(c, userDTO(user))
}

func (h *Handler) patchUser(c *gin.Context) {
	if _, ok := h.requireAdminSession(c); !ok {
		return
	}
	id, err := auth.ParseUintID(c.Param("id"))
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	var user models.User
	if err := h.DB.First(&user, "id = ?", id).Error; err != nil {
		fail(c, http.StatusNotFound, "user not found")
		return
	}
	var input struct {
		Email      string  `json:"email"`
		Nickname   *string `json:"nickname"`
		Password   string  `json:"password"`
		Role       string  `json:"role"`
		Enabled    *bool   `json:"enabled"`
		DailyLimit *int64  `json:"daily_limit"`
		TotalLimit *int64  `json:"total_limit"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		fail(c, http.StatusBadRequest, "invalid json")
		return
	}
	if email := strings.ToLower(strings.TrimSpace(input.Email)); email != "" {
		if !strings.Contains(email, "@") {
			fail(c, http.StatusBadRequest, "valid email required")
			return
		}
		user.Email = email
	}
	if input.Nickname != nil {
		nickname, err := normalizeNickname(*input.Nickname)
		if err != nil {
			fail(c, http.StatusBadRequest, err.Error())
			return
		}
		user.Nickname = nickname
	}
	current := currentUser(c)
	if current != nil && current.ID == user.ID {
		if input.Enabled != nil && !*input.Enabled {
			fail(c, http.StatusBadRequest, "cannot disable your own account")
			return
		}
		if input.Role == models.UserRoleUser && user.Role == models.UserRoleAdmin {
			fail(c, http.StatusBadRequest, "cannot demote your own admin account")
			return
		}
	}
	if user.Role == models.UserRoleAdmin {
		removingAdmin := false
		if input.Enabled != nil && !*input.Enabled {
			removingAdmin = true
		}
		if input.Role == models.UserRoleUser {
			removingAdmin = true
		}
		if removingAdmin {
			count, err := h.enabledAdminCountExcluding(user.ID)
			if err != nil {
				fail(c, http.StatusInternalServerError, err.Error())
				return
			}
			if count == 0 {
				cannotRemoveAdminResponse(c)
				return
			}
		}
	}
	if input.Role == models.UserRoleAdmin || input.Role == models.UserRoleUser {
		user.Role = input.Role
	}
	if input.Enabled != nil {
		user.Enabled = *input.Enabled
	}
	if input.DailyLimit != nil {
		if *input.DailyLimit < 0 {
			fail(c, http.StatusBadRequest, "daily_limit must be zero or greater")
			return
		}
		user.DailyLimit = *input.DailyLimit
	}
	if input.TotalLimit != nil {
		if *input.TotalLimit < 0 {
			fail(c, http.StatusBadRequest, "total_limit must be zero or greater")
			return
		}
		user.TotalLimit = *input.TotalLimit
	}
	if input.Password != "" {
		if len(input.Password) < 8 {
			fail(c, http.StatusBadRequest, "password must be at least 8 characters")
			return
		}
		hash, err := auth.HashSecret(input.Password)
		if err != nil {
			fail(c, http.StatusInternalServerError, err.Error())
			return
		}
		user.PasswordHash = hash
	}
	if err := h.DB.Save(&user).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	h.audit("user.patch", actor(c), user.Email, "")
	ok(c, userDTO(user))
}

func (h *Handler) patchUserProfile(c *gin.Context) {
	user, loggedIn := h.requireLogin(c)
	if !loggedIn {
		return
	}
	var input struct {
		Nickname string `json:"nickname"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		fail(c, http.StatusBadRequest, "invalid json")
		return
	}
	nickname, err := normalizeNickname(input.Nickname)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	if err := h.DB.Model(&models.User{}).Where("id = ?", user.ID).Update("nickname", nickname).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	user.Nickname = nickname
	h.audit("user.profile.patch", user.Email, user.Email, "")
	ok(c, gin.H{"user": userDTO(*user)})
}

func (h *Handler) deleteUser(c *gin.Context) {
	if _, ok := h.requireAdminSession(c); !ok {
		return
	}
	id, err := auth.ParseUintID(c.Param("id"))
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	var user models.User
	if err := h.DB.First(&user, "id = ?", id).Error; err != nil {
		fail(c, http.StatusNotFound, "user not found")
		return
	}
	if current := currentUser(c); current != nil && current.ID == user.ID {
		fail(c, http.StatusBadRequest, "cannot delete your own account")
		return
	}
	if user.Role == models.UserRoleAdmin {
		count, err := h.enabledAdminCountExcluding(user.ID)
		if err != nil {
			fail(c, http.StatusInternalServerError, err.Error())
			return
		}
		if count == 0 {
			cannotRemoveAdminResponse(c)
			return
		}
	}
	if err := h.DB.Transaction(func(tx *gorm.DB) error {
		var domainIDs []uint
		if err := tx.Model(&models.Domain{}).Where("owner_id = ?", user.ID).Pluck("id", &domainIDs).Error; err != nil {
			return err
		}
		var mailboxIDs []uint
		if err := tx.Model(&models.Mailbox{}).Where("owner_id = ?", user.ID).Pluck("id", &mailboxIDs).Error; err != nil {
			return err
		}
		var mailboxEmails []string
		if err := tx.Model(&models.Mailbox{}).Where("owner_id = ?", user.ID).Pluck("email", &mailboxEmails).Error; err != nil {
			return err
		}
		if len(mailboxIDs) > 0 {
			mailboxShares := tx.Model(&models.ShareLink{}).Where("resource_type = ? AND mailbox_id IN ?", models.ShareResourceTypeMailbox, mailboxIDs)
			if err := tx.Where("share_link_id IN (?)", mailboxShares.Select("id")).Delete(&models.ShareLinkAccessLog{}).Error; err != nil {
				return err
			}
			if err := tx.Where("resource_type = ? AND mailbox_id IN ?", models.ShareResourceTypeMailbox, mailboxIDs).Delete(&models.ShareLink{}).Error; err != nil {
				return err
			}
		}
		messageQuery := tx.Model(&models.Message{}).Where("owner_id = ?", user.ID)
		if len(domainIDs) > 0 {
			messageQuery = messageQuery.Or("domain_id IN ?", domainIDs)
		}
		if len(mailboxEmails) > 0 {
			messageQuery = messageQuery.Or("recipient IN ?", mailboxEmails)
		}
		if err := deleteMessageDependentsForQuery(tx, messageQuery); err != nil {
			return err
		}
		if err := messageQuery.Unscoped().Delete(&models.Message{}).Error; err != nil {
			return err
		}
		userShareLinks := tx.Model(&models.ShareLink{}).Where("owner_id = ?", user.ID)
		if err := tx.Where("share_link_id IN (?)", userShareLinks.Select("id")).Delete(&models.ShareLinkAccessLog{}).Error; err != nil {
			return err
		}
		if err := tx.Where("owner_id = ?", user.ID).Delete(&models.ShareLink{}).Error; err != nil {
			return err
		}
		if err := tx.Where("owner_id = ?", user.ID).Delete(&models.ShareLinkAccessLog{}).Error; err != nil {
			return err
		}
		endpoints := tx.Model(&models.WebhookEndpoint{}).Where("owner_id = ?", user.ID)
		if err := tx.Where("endpoint_id IN (?) OR owner_id = ?", endpoints.Select("id"), user.ID).Delete(&models.WebhookDelivery{}).Error; err != nil {
			return err
		}
		if err := tx.Where("owner_id = ?", user.ID).Delete(&models.WebhookEndpoint{}).Error; err != nil {
			return err
		}
		if err := tx.Where("owner_id = ?", user.ID).Delete(&models.APIKey{}).Error; err != nil {
			return err
		}
		if err := tx.Where("owner_id = ?", user.ID).Delete(&models.Mailbox{}).Error; err != nil {
			return err
		}
		if err := tx.Where("user_id = ?", user.ID).Delete(&models.Notification{}).Error; err != nil {
			return err
		}
		if len(domainIDs) > 0 {
			if err := tx.Where("domain_id IN ?", domainIDs).Delete(&models.Notification{}).Error; err != nil {
				return err
			}
			if err := tx.Where("id IN ?", domainIDs).Delete(&models.Domain{}).Error; err != nil {
				return err
			}
		}
		return tx.Delete(&user).Error
	}); err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	h.audit("user.delete", actor(c), user.Email, "")
	ok(c, gin.H{"deleted": true})
}

func actor(c *gin.Context) string {
	if user := currentUser(c); user != nil {
		return user.Email
	}
	return "system"
}
