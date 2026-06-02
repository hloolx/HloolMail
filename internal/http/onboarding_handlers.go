package httpapi

import (
	"net/http"
	"time"

	appdb "gptmail/internal/db"
	"gptmail/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type userOnboardingStatus struct {
	Enabled                     bool       `json:"enabled"`
	Required                    bool       `json:"required"`
	RequirePublicDomainForQuota bool       `json:"require_public_domain_for_quota"`
	HasReadyPublicDomain        bool       `json:"has_ready_public_domain"`
	HasMailbox                  bool       `json:"has_mailbox"`
	HasAPIKey                   bool       `json:"has_api_key"`
	CanComplete                 bool       `json:"can_complete"`
	NextStep                    string     `json:"next_step,omitempty"`
	Completed                   bool       `json:"completed"`
	Skipped                     bool       `json:"skipped"`
	CompletedAt                 *time.Time `json:"completed_at,omitempty"`
	SkippedAt                   *time.Time `json:"skipped_at,omitempty"`
}

func markNewUserOnboardingRequired(tx *gorm.DB, user *models.User) error {
	if user.Role != models.UserRoleUser {
		user.OnboardingRequired = false
		return nil
	}
	settings, err := appdb.EnsureSystemQuotaSettings(tx)
	if err != nil {
		return err
	}
	user.OnboardingRequired = settings.EnableUserOnboarding
	return nil
}

func (h *Handler) getUserOnboarding(c *gin.Context) {
	user, loggedIn := h.requireLogin(c)
	if !loggedIn {
		return
	}
	status, err := h.buildUserOnboardingStatus(*user)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	ok(c, status)
}

func (h *Handler) patchUserOnboarding(c *gin.Context) {
	user, loggedIn := h.requireLogin(c)
	if !loggedIn {
		return
	}
	var input struct {
		Completed *bool `json:"completed"`
		Skipped   *bool `json:"skipped"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		fail(c, http.StatusBadRequest, "invalid json")
		return
	}
	complete := input.Completed != nil && *input.Completed
	skip := input.Skipped != nil && *input.Skipped
	if complete == skip {
		fail(c, http.StatusBadRequest, "set exactly one of completed or skipped")
		return
	}
	if complete {
		status, err := h.buildUserOnboardingStatus(*user)
		if err != nil {
			fail(c, http.StatusInternalServerError, err.Error())
			return
		}
		if !status.CanComplete {
			fail(c, http.StatusBadRequest, "finish onboarding tasks first")
			return
		}
	}

	now := time.Now()
	updates := map[string]any{"onboarding_required": false}
	if complete {
		updates["onboarding_completed_at"] = now
		updates["onboarding_skipped_at"] = nil
	} else {
		updates["onboarding_skipped_at"] = now
		updates["onboarding_completed_at"] = nil
	}
	if err := h.DB.Model(&models.User{}).Where("id = ?", user.ID).Updates(updates).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}

	var updated models.User
	if err := h.DB.First(&updated, "id = ?", user.ID).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	h.audit("user.onboarding.patch", user.Email, user.Email, "")
	status, err := h.buildUserOnboardingStatus(updated)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	ok(c, status)
}

func (h *Handler) buildUserOnboardingStatus(user models.User) (userOnboardingStatus, error) {
	settings, err := appdb.EnsureSystemQuotaSettings(h.DB)
	if err != nil {
		return userOnboardingStatus{}, err
	}
	completed := user.OnboardingCompletedAt != nil
	skipped := user.OnboardingSkippedAt != nil
	progress, err := h.userOnboardingProgress(user, settings.RequirePublicDomainForQuota)
	if err != nil {
		return userOnboardingStatus{}, err
	}
	required := settings.EnableUserOnboarding &&
		user.Role == models.UserRoleUser &&
		user.OnboardingRequired &&
		!completed &&
		!skipped
	return userOnboardingStatus{
		Enabled:                     settings.EnableUserOnboarding,
		Required:                    required,
		RequirePublicDomainForQuota: settings.RequirePublicDomainForQuota,
		HasReadyPublicDomain:        progress.HasReadyPublicDomain,
		HasMailbox:                  progress.HasMailbox,
		HasAPIKey:                   progress.HasAPIKey,
		CanComplete:                 progress.CanComplete,
		NextStep:                    progress.NextStep,
		Completed:                   completed,
		Skipped:                     skipped,
		CompletedAt:                 user.OnboardingCompletedAt,
		SkippedAt:                   user.OnboardingSkippedAt,
	}, nil
}

type userOnboardingProgress struct {
	HasReadyPublicDomain bool
	HasMailbox           bool
	HasAPIKey            bool
	CanComplete          bool
	NextStep             string
}

func (h *Handler) userOnboardingProgress(user models.User, requirePublicDomainForQuota bool) (userOnboardingProgress, error) {
	var progress userOnboardingProgress
	if requirePublicDomainForQuota {
		var count int64
		if err := ownerRootReadyPublicDomainQuery(h.DB.Model(&models.Domain{}), user.ID).Count(&count).Error; err != nil {
			return progress, err
		}
		progress.HasReadyPublicDomain = count > 0
	}

	var mailboxCount int64
	if err := h.DB.Model(&models.Mailbox{}).Where("owner_id = ?", user.ID).Count(&mailboxCount).Error; err != nil {
		return progress, err
	}
	progress.HasMailbox = mailboxCount > 0

	var apiKeyCount int64
	if err := h.DB.Model(&models.APIKey{}).Where("owner_id = ?", user.ID).Count(&apiKeyCount).Error; err != nil {
		return progress, err
	}
	progress.HasAPIKey = apiKeyCount > 0

	progress.CanComplete = (!requirePublicDomainForQuota || progress.HasReadyPublicDomain) &&
		progress.HasMailbox &&
		progress.HasAPIKey
	progress.NextStep = onboardingNextStep(progress, requirePublicDomainForQuota)
	return progress, nil
}

func onboardingNextStep(progress userOnboardingProgress, requirePublicDomainForQuota bool) string {
	if requirePublicDomainForQuota && !progress.HasReadyPublicDomain {
		return "domain"
	}
	if !progress.HasMailbox {
		return "mailbox"
	}
	if !progress.HasAPIKey {
		return "api-key"
	}
	return "api-docs"
}
