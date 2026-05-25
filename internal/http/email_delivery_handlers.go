package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"gptmail/internal/config"
	db "gptmail/internal/db"
	"gptmail/internal/emaildelivery"
	"gptmail/internal/mailer"
	"gptmail/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func (h *Handler) getEmailDelivery(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		fail(c, http.StatusBadRequest, "delivery id is required")
		return
	}
	var delivery models.EmailDelivery
	if err := h.DB.First(&delivery, "id = ?", id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			fail(c, http.StatusNotFound, "email delivery not found")
			return
		}
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	if delivery.Purpose == models.EmailDeliveryPurposeLoginSettingsTest && !h.requireAdmin(c) {
		return
	}
	user := currentUser(c)
	if delivery.Purpose == models.EmailDeliveryPurposeRegistrationVerification && (user == nil || user.Role != models.UserRoleAdmin) {
		ok(c, emaildelivery.PublicDTO(delivery))
		return
	}
	ok(c, emaildelivery.DTO(delivery))
}

func (h *Handler) enqueueEmailDelivery(input emaildelivery.EnqueueInput) (*models.EmailDelivery, error) {
	delivery, err := emaildelivery.Enqueue(h.DB, input)
	if err != nil {
		return nil, err
	}
	if h.EmailWorker != nil {
		_ = h.EmailWorker.RunOnce(context.Background())
		_ = h.DB.First(delivery, "id = ?", delivery.ID).Error
	}
	return delivery, nil
}

func emailDeliveryStatusFields(delivery *models.EmailDelivery) gin.H {
	if delivery == nil {
		return gin.H{}
	}
	return gin.H{
		"delivery_id":           delivery.ID,
		"email_delivery_status": delivery.Status,
		"email_delivery_stage":  delivery.Stage,
		"email_delivery_error":  delivery.Error,
		"sent":                  delivery.Status == models.EmailDeliveryStatusSucceeded,
	}
}

func EmailDeliverySuccessCallback(cfg config.Config) func(context.Context, *gorm.DB, models.EmailDelivery, time.Time) error {
	return func(ctx context.Context, database *gorm.DB, delivery models.EmailDelivery, now time.Time) error {
		if delivery.Purpose != models.EmailDeliveryPurposeLoginSettingsTest {
			return nil
		}
		settings, err := dbEnsureLoginSettings(database)
		if err != nil {
			return err
		}
		settings.EmailDeliveryTestedAt = &now
		settings.EmailDeliveryTestHash = delivery.SettingsHash
		settings.EmailDeliveryTestRecipient = delivery.Recipient
		return database.WithContext(ctx).Save(settings).Error
	}
}

func enqueueRegistrationVerification(h *Handler, settings *models.LoginSettings, email, code, verificationID string) (*models.EmailDelivery, error) {
	message := registrationVerificationMessage(email, code)
	return h.enqueueEmailDelivery(emaildelivery.EnqueueInput{
		Purpose:      models.EmailDeliveryPurposeRegistrationVerification,
		ReferenceID:  verificationID,
		Recipient:    email,
		SettingsHash: loginEmailSettingsFingerprint(h.Config, settings),
		Settings:     mailerSettingsFromLoginSettings(h.Config, settings),
		Message:      message,
		MaxAttempts:  emaildelivery.DefaultMaxAttempts,
	})
}

func registrationVerificationMessage(email, code string) mailer.Message {
	subject := "Verify your email address"
	text := "Your verification code is " + code + ". It expires in 15 minutes."
	html := "<p>Your verification code is <strong>" + code + "</strong>.</p><p>It expires in 15 minutes.</p>"
	return mailer.Message{
		To:      email,
		Subject: subject,
		Text:    text,
		HTML:    html,
	}
}

func loginSettingsTestMessage(recipient string) mailer.Message {
	return mailer.Message{
		To:      recipient,
		Subject: "HloolMail test email",
		Text:    "This is a test email from HloolMail.",
		HTML:    "<p>This is a test email from HloolMail.</p>",
	}
}

func dbEnsureLoginSettings(database *gorm.DB) (*models.LoginSettings, error) {
	return db.EnsureLoginSettings(database)
}
