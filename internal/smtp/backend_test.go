package smtpserver

import (
	"strings"
	"testing"
	"time"

	"gptmail/internal/config"
	"gptmail/internal/domain"
	"gptmail/internal/models"

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

func newSMTPTestSession(t *testing.T, cfg config.Config) (*Session, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.Domain{}, &models.Message{}); err != nil {
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
