package httpapi

import (
	"net/http"
	"strings"

	"gptmail/internal/auth"
	"gptmail/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func (h *Handler) listUsers(c *gin.Context) {
	if !h.requireAdmin(c) {
		return
	}
	page := parsePage(c.Query("page"))
	pageSize := parseLimit(c.Query("page_size"), 20, 100)
	search := strings.TrimSpace(c.Query("search"))
	role := strings.TrimSpace(c.Query("role"))
	status := strings.TrimSpace(c.Query("status"))

	db := h.DB.Model(&models.User{})
	if search != "" {
		db = db.Where("LOWER(email) LIKE ?", "%"+strings.ToLower(search)+"%")
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

	ok(c, paginatedResponse[models.User]{
		Items:      users,
		Page:       page,
		PerPage:    pageSize,
		Total:      total,
		TotalPages: totalPages,
	})
}

func (h *Handler) createUser(c *gin.Context) {
	if !h.requireAdmin(c) {
		return
	}
	var input struct {
		Email      string `json:"email"`
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
		Email:        email,
		PasswordHash: hash,
		Role:         role,
		Enabled:      true,
		DailyLimit:   input.DailyLimit,
		TotalLimit:   input.TotalLimit,
	}
	if err := h.DB.Create(&user).Error; err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	h.audit("user.create", actor(c), user.Email, user.Role)
	created(c, user)
}

func (h *Handler) patchUser(c *gin.Context) {
	if !h.requireAdmin(c) {
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
		Email      string `json:"email"`
		Password   string `json:"password"`
		Role       string `json:"role"`
		Enabled    *bool  `json:"enabled"`
		DailyLimit *int64 `json:"daily_limit"`
		TotalLimit *int64 `json:"total_limit"`
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
	ok(c, user)
}

func (h *Handler) deleteUser(c *gin.Context) {
	if !h.requireAdmin(c) {
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
