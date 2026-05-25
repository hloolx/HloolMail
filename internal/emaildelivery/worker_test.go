package emaildelivery

import (
	"context"
	"strings"
	"testing"

	"gptmail/internal/mailer"
	"gptmail/internal/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

type recordingSender struct {
	settings []mailer.Settings
	messages []mailer.Message
	err      error
}

func (s *recordingSender) Send(_ context.Context, settings mailer.Settings, message mailer.Message) error {
	if s.err != nil {
		return s.err
	}
	s.settings = append(s.settings, settings)
	s.messages = append(s.messages, message)
	return nil
}

func TestWorkerRedactsSensitivePayloadsAfterSuccess(t *testing.T) {
	db := testDB(t)
	sender := &recordingSender{}
	delivery, err := Enqueue(db, EnqueueInput{
		Purpose:   models.EmailDeliveryPurposeRegistrationVerification,
		Recipient: "recipient@example.com",
		Settings: mailer.Settings{
			Mode:          models.EmailVerificationModeSMTP,
			SMTPHost:      "smtp.example.com",
			SMTPUsername:  "mailer",
			SMTPPassword:  "super-secret-password",
			SMTPFromEmail: "no-reply@example.com",
		},
		Message: mailer.Message{
			To:      "recipient@example.com",
			Subject: "Verify your email",
			Text:    "Your verification code is 123456.",
			HTML:    "<p>Your verification code is <strong>123456</strong>.</p>",
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	worker := NewWorker(db, sender)
	if err := worker.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}

	var refreshed models.EmailDelivery
	if err := db.First(&refreshed, "id = ?", delivery.ID).Error; err != nil {
		t.Fatal(err)
	}
	if refreshed.Status != models.EmailDeliveryStatusSucceeded {
		t.Fatalf("status = %q, want %q", refreshed.Status, models.EmailDeliveryStatusSucceeded)
	}
	if refreshed.MessageJSON != "{}" || refreshed.SettingsJSON != "{}" {
		t.Fatalf("sensitive payloads were not redacted: message=%q settings=%q", refreshed.MessageJSON, refreshed.SettingsJSON)
	}
	combined := refreshed.MessageJSON + refreshed.SettingsJSON
	for _, leak := range []string{"super-secret-password", "123456", "recipient@example.com"} {
		if strings.Contains(combined, leak) {
			t.Fatalf("redacted payload still contains %q: %s", leak, combined)
		}
	}
}

func testDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.EmailDelivery{}); err != nil {
		t.Fatal(err)
	}
	return db
}
