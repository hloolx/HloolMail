package smtpserver

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"
	"time"

	"gptmail/internal/config"
	"gptmail/internal/domain"
	"gptmail/internal/models"
	"gptmail/internal/webhook"

	gosmtp "github.com/emersion/go-smtp"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func TestDataRejectsOversizedAttachment(t *testing.T) {
	session, _ := newSMTPTestSession(t, config.Config{
		MaxMessageBytes:    4096,
		MaxAttachmentBytes: 5,
		MessageRetention:   time.Hour,
	})

	raw := "From: Sender <sender@example.test>\r\n" +
		"To: demo@example.test\r\n" +
		"Subject: Large attachment\r\n" +
		"MIME-Version: 1.0\r\n" +
		"Content-Type: multipart/mixed; boundary=outer\r\n\r\n" +
		"--outer\r\n" +
		"Content-Type: text/plain; charset=utf-8\r\n\r\n" +
		"hello\r\n" +
		"--outer\r\n" +
		"Content-Type: application/octet-stream; name=file.bin\r\n" +
		"Content-Disposition: attachment; filename=file.bin\r\n\r\n" +
		"123456\r\n" +
		"--outer--\r\n"

	err := session.Data(strings.NewReader(raw))
	smtpErr, ok := err.(*gosmtp.SMTPError)
	if !ok {
		t.Fatalf("error = %T %v, want SMTPError", err, err)
	}
	if smtpErr.Code != 552 || smtpErr.Message != "attachment exceeds size limit" {
		t.Fatalf("smtp error = %d %q", smtpErr.Code, smtpErr.Message)
	}
}

func TestDataSanitizesStorageErrors(t *testing.T) {
	session, db := newSMTPTestSession(t, config.Config{
		MaxMessageBytes:  4096,
		MessageRetention: time.Hour,
	})
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	if err := sqlDB.Close(); err != nil {
		t.Fatal(err)
	}

	err = session.Data(strings.NewReader("From: Sender <sender@example.test>\r\n" +
		"To: demo@example.test\r\n" +
		"Subject: Store failure\r\n\r\n" +
		"hello\r\n"))
	smtpErr, ok := err.(*gosmtp.SMTPError)
	if !ok {
		t.Fatalf("error = %T %v, want SMTPError", err, err)
	}
	if smtpErr.Code != 451 || smtpErr.Message != "failed to store message" {
		t.Fatalf("smtp error = %d %q", smtpErr.Code, smtpErr.Message)
	}
}

func TestDataStoresAttachmentMetadataOnly(t *testing.T) {
	session, db := newSMTPTestSession(t, config.Config{
		MaxMessageBytes:    4096,
		MaxAttachmentBytes: 1024,
		MessageRetention:   time.Hour,
	})

	raw := "From: Sender <sender@example.test>\r\n" +
		"To: demo@example.test\r\n" +
		"Subject: Attachment metadata\r\n" +
		"MIME-Version: 1.0\r\n" +
		"Content-Type: multipart/mixed; boundary=outer\r\n\r\n" +
		"--outer\r\n" +
		"Content-Type: text/plain; charset=utf-8\r\n\r\n" +
		"visible text\r\n" +
		"--outer\r\n" +
		"Content-Type: text/plain; name=note.txt\r\n" +
		"Content-Disposition: attachment; filename=note.txt\r\n" +
		"Content-Transfer-Encoding: base64\r\n\r\n" +
		"c2VjcmV0\r\n" +
		"--outer--\r\n"

	if err := session.Data(strings.NewReader(raw)); err != nil {
		t.Fatal(err)
	}
	var msg models.Message
	if err := db.First(&msg, "recipient = ?", "demo@example.test").Error; err != nil {
		t.Fatal(err)
	}
	if strings.Contains(msg.TextContent, "secret") || strings.Contains(msg.HTMLContent, "secret") {
		t.Fatalf("attachment body leaked into stored message: %+v", msg)
	}
	var attachments []models.MessageAttachment
	if err := db.Order("sequence asc").Find(&attachments, "message_id = ?", msg.ID).Error; err != nil {
		t.Fatal(err)
	}
	if len(attachments) != 1 {
		t.Fatalf("attachments = %d, want 1", len(attachments))
	}
	attachment := attachments[0]
	if attachment.Sequence != 1 || attachment.Filename != "note.txt" || attachment.ContentType != "text/plain" || attachment.Disposition != "attachment" || attachment.TransferEncoding != "base64" {
		t.Fatalf("unexpected attachment metadata: %+v", attachment)
	}
	if attachment.SizeBytes != 6 {
		t.Fatalf("attachment size = %d, want 6", attachment.SizeBytes)
	}
	wantHash := sha256.Sum256([]byte("secret"))
	if attachment.SHA256 != hex.EncodeToString(wantHash[:]) {
		t.Fatalf("attachment sha256 = %q", attachment.SHA256)
	}
}

func TestDataEnqueuesWebhookWithoutCallingTarget(t *testing.T) {
	session, db := newSMTPTestSession(t, config.Config{
		MaxMessageBytes:  4096,
		MessageRetention: time.Hour,
		WebhooksEnabled:  true,
	})
	owner := models.User{Email: "owner@example.test", PasswordHash: "hash", Role: models.UserRoleUser, Enabled: true}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	var domain models.Domain
	if err := db.First(&domain, "domain = ?", "example.test").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&domain).Updates(map[string]any{
		"mode":     models.DomainModePrivate,
		"owner_id": owner.ID,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&models.Mailbox{
		OwnerID:   owner.ID,
		Email:     "demo@example.test",
		LocalPart: "demo",
		Host:      "example.test",
		DomainID:  domain.ID,
	}).Error; err != nil {
		t.Fatal(err)
	}
	eventsJSON, err := webhook.EventsJSON([]string{models.WebhookEventMessageReceived})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&models.WebhookEndpoint{
		OwnerID:       owner.ID,
		Name:          "slow-or-blocked-target",
		URL:           "https://10.0.0.1/hook",
		Secret:        "secret",
		SecretPreview: "preview",
		Enabled:       true,
		EventsJSON:    eventsJSON,
		Scope:         models.WebhookScopeAll,
	}).Error; err != nil {
		t.Fatal(err)
	}

	start := time.Now()
	err = session.Data(strings.NewReader("From: Sender <sender@example.test>\r\n" +
		"To: demo@example.test\r\n" +
		"Subject: Enqueue only\r\n\r\n" +
		"hello\r\n"))
	if err != nil {
		t.Fatal(err)
	}
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Fatalf("smtp Data took %s; webhook target should not be called synchronously", elapsed)
	}
	var deliveries []models.WebhookDelivery
	if err := db.Find(&deliveries).Error; err != nil {
		t.Fatal(err)
	}
	if len(deliveries) != 1 {
		t.Fatalf("deliveries = %d, want 1", len(deliveries))
	}
	if !strings.Contains(deliveries[0].PayloadJSON, "Enqueue only") {
		t.Fatalf("delivery payload missing message DTO: %s", deliveries[0].PayloadJSON)
	}
}

func newSMTPTestSession(t *testing.T, cfg config.Config) (*Session, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.User{}, &models.Domain{}, &models.Mailbox{}, &models.Message{}, &models.MessageAttachment{}, &models.WebhookEndpoint{}, &models.WebhookDelivery{}); err != nil {
		t.Fatal(err)
	}
	d := models.Domain{
		Domain:     "example.test",
		Active:     true,
		MXVerified: true,
		CreatedAt:  time.Now(),
	}
	if err := db.Create(&d).Error; err != nil {
		t.Fatal(err)
	}
	session := &Session{service: Service{
		Config:   cfg,
		DB:       db,
		Resolver: domain.Resolver{DB: db},
	}}
	if err := session.Mail("sender@example.test", nil); err != nil {
		t.Fatal(err)
	}
	if err := session.Rcpt("demo@example.test", nil); err != nil {
		t.Fatal(err)
	}
	return session, db
}
