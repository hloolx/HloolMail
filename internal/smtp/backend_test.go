package smtpserver

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"
	"time"

	"gptmail/internal/config"
	"gptmail/internal/domain"
	mailparser "gptmail/internal/mail"
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

func TestSessionDoesNotSupportSMTPAuth(t *testing.T) {
	var session any = &Session{}
	if _, ok := session.(gosmtp.AuthSession); ok {
		t.Fatal("session should not advertise SMTP AUTH")
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
	if msg.OwnerID == nil || msg.MailboxID == nil {
		t.Fatalf("message owner snapshot not stored: owner_id=%v mailbox_id=%v", msg.OwnerID, msg.MailboxID)
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

func TestDataIncrementsMessageDailyStats(t *testing.T) {
	session, db := newSMTPTestSession(t, config.Config{
		MaxMessageBytes:  4096,
		MessageRetention: time.Hour,
	})

	if err := session.Data(strings.NewReader("From: Sender <sender@example.test>\r\n" +
		"To: demo@example.test\r\n" +
		"Subject: Count me\r\n\r\n" +
		"hello\r\n")); err != nil {
		t.Fatal(err)
	}

	var stat models.MessageDailyStat
	if err := db.First(&stat).Error; err != nil {
		t.Fatal(err)
	}
	if stat.Day != time.Now().Local().Format("2006-01-02") || stat.MessageCount != 1 {
		t.Fatalf("message daily stat = %+v, want today count 1", stat)
	}
}

func TestDataTruncatesLongAttachmentMetadataBeforeStore(t *testing.T) {
	session, db := newSMTPTestSession(t, config.Config{
		MaxMessageBytes:    4096,
		MaxAttachmentBytes: 1024,
		MessageRetention:   time.Hour,
	})
	longFilename := strings.Repeat("f", 700)
	longContentID := strings.Repeat("c", 300)

	raw := "From: Sender <sender@example.test>\r\n" +
		"To: demo@example.test\r\n" +
		"Subject: Long attachment metadata\r\n" +
		"MIME-Version: 1.0\r\n" +
		"Content-Type: multipart/mixed; boundary=outer\r\n\r\n" +
		"--outer\r\n" +
		"Content-Type: text/plain; charset=utf-8\r\n\r\n" +
		"visible text\r\n" +
		"--outer\r\n" +
		"Content-Type: application/octet-stream; name=\"" + longFilename + "\"\r\n" +
		"Content-Disposition: attachment; filename=\"" + longFilename + "\"\r\n" +
		"Content-ID: <" + longContentID + ">\r\n\r\n" +
		"data\r\n" +
		"--outer--\r\n"

	if err := session.Data(strings.NewReader(raw)); err != nil {
		t.Fatal(err)
	}
	var attachment models.MessageAttachment
	if err := db.First(&attachment).Error; err != nil {
		t.Fatal(err)
	}
	if len([]rune(attachment.Filename)) != 500 {
		t.Fatalf("filename length = %d, want 500", len([]rune(attachment.Filename)))
	}
	if len([]rune(attachment.ContentID)) != 255 {
		t.Fatalf("content id length = %d, want 255", len([]rune(attachment.ContentID)))
	}
}

func TestDataAllowsTextBodyUpToMessageLimit(t *testing.T) {
	body := strings.Repeat("a", 2*1024*1024+1024)
	raw := "From: Sender <sender@example.test>\r\n" +
		"To: demo@example.test\r\n" +
		"Subject: Large text body\r\n" +
		"MIME-Version: 1.0\r\n" +
		"Content-Type: text/plain; charset=utf-8\r\n\r\n" +
		body + "\r\n"
	session, db := newSMTPTestSession(t, config.Config{
		MaxMessageBytes:  int64(len(raw) + 1024),
		MessageRetention: time.Hour,
	})

	if err := session.Data(strings.NewReader(raw)); err != nil {
		t.Fatal(err)
	}
	var msg models.Message
	if err := db.First(&msg).Error; err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(msg.TextContent, body) {
		t.Fatalf("text body was not preserved up to configured message limit: got prefix length %d want at least %d", len(msg.TextContent), len(body))
	}
}

func TestCreateMessageAttachmentsTruncatesParserBypassMetadata(t *testing.T) {
	_, db := newSMTPTestSession(t, config.Config{
		MaxMessageBytes:  4096,
		MessageRetention: time.Hour,
	})
	messageID := "metadata-truncate-message"
	if err := db.Create(&models.Message{
		ID:              messageID,
		Recipient:       "demo@example.test",
		RecipientLocal:  "demo",
		RecipientDomain: "example.test",
		RootDomain:      "example.test",
		FromAddress:     "sender@example.test",
		Subject:         "metadata",
		ExpiresAt:       time.Now().Add(time.Hour),
	}).Error; err != nil {
		t.Fatal(err)
	}

	if err := createMessageAttachments(db, messageID, []mailparser.ParsedAttachment{{
		Sequence:         1,
		Filename:         strings.Repeat("f", 700),
		ContentType:      strings.Repeat("t", 300),
		Disposition:      strings.Repeat("d", 80),
		ContentID:        strings.Repeat("c", 300),
		TransferEncoding: strings.Repeat("e", 80),
		SHA256:           strings.Repeat("a", 64),
	}}); err != nil {
		t.Fatal(err)
	}

	var attachment models.MessageAttachment
	if err := db.First(&attachment, "message_id = ?", messageID).Error; err != nil {
		t.Fatal(err)
	}
	if len([]rune(attachment.Filename)) != 500 ||
		len([]rune(attachment.ContentType)) != 255 ||
		len([]rune(attachment.Disposition)) != 40 ||
		len([]rune(attachment.ContentID)) != 255 ||
		len([]rune(attachment.TransferEncoding)) != 40 {
		t.Fatalf("metadata was not truncated to model limits: %+v", attachment)
	}
}

func TestDataEnqueuesWebhookWithoutCallingTarget(t *testing.T) {
	session, db := newSMTPTestSession(t, config.Config{
		MaxMessageBytes:  4096,
		MessageRetention: time.Hour,
		WebhooksEnabled:  true,
	})
	var mailbox models.Mailbox
	if err := db.First(&mailbox, "email = ?", "demo@example.test").Error; err != nil {
		t.Fatal(err)
	}
	ownerID := mailbox.OwnerID
	var domain models.Domain
	if err := db.First(&domain, "domain = ?", "example.test").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&domain).Updates(map[string]any{
		"mode":     models.DomainModePrivate,
		"owner_id": ownerID,
	}).Error; err != nil {
		t.Fatal(err)
	}
	eventsJSON, err := webhook.EventsJSON([]string{models.WebhookEventMessageReceived})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&models.WebhookEndpoint{
		OwnerID:       ownerID,
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

func TestRcptRejectsMissingMailboxOnPublicDomain(t *testing.T) {
	session, _ := newSMTPTestSession(t, config.Config{
		MaxMessageBytes:  4096,
		MessageRetention: time.Hour,
	})
	session.Reset()
	if err := session.Mail("sender@example.test", nil); err != nil {
		t.Fatal(err)
	}
	err := session.Rcpt("missing@example.test", nil)
	smtpErr, ok := err.(*gosmtp.SMTPError)
	if !ok {
		t.Fatalf("error = %T %v, want SMTPError", err, err)
	}
	if smtpErr.Code != 550 || smtpErr.Message != "mailbox not found" {
		t.Fatalf("smtp error = %d %q", smtpErr.Code, smtpErr.Message)
	}
}

func TestRcptRejectsWildcardHostInFullAddress(t *testing.T) {
	session, _ := newSMTPTestSession(t, config.Config{
		MaxMessageBytes:  4096,
		MessageRetention: time.Hour,
	})
	session.Reset()
	if err := session.Mail("sender@example.test", nil); err != nil {
		t.Fatal(err)
	}
	err := session.Rcpt("demo@*.example.test", nil)
	smtpErr, ok := err.(*gosmtp.SMTPError)
	if !ok {
		t.Fatalf("error = %T %v, want SMTPError", err, err)
	}
	if smtpErr.Code != 550 || smtpErr.Message != "invalid recipient" {
		t.Fatalf("smtp error = %d %q", smtpErr.Code, smtpErr.Message)
	}
}

func TestDataUsesResolvedExactDomainWhenMailboxEmailBelongsToWildcardParent(t *testing.T) {
	session, db := newSMTPTestSession(t, config.Config{
		MaxMessageBytes:  4096,
		MessageRetention: time.Hour,
	})
	parentOwner := models.User{Email: "smtp-parent@example.test", PasswordHash: "hash", Role: models.UserRoleUser, Enabled: true}
	childOwner := models.User{Email: "smtp-child@example.test", PasswordHash: "hash", Role: models.UserRoleUser, Enabled: true}
	if err := db.Create(&parentOwner).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&childOwner).Error; err != nil {
		t.Fatal(err)
	}
	parentDomain := models.Domain{
		Domain:            "smtp-wild.test",
		Mode:              models.DomainModePrivate,
		OwnerID:           &parentOwner.ID,
		Active:            true,
		WildcardEnabled:   true,
		WildcardRequested: true,
	}
	childDomain := models.Domain{
		Domain:     "shop.smtp-wild.test",
		Mode:       models.DomainModePrivate,
		OwnerID:    &childOwner.ID,
		Active:     true,
		MXVerified: true,
	}
	if err := db.Create(&parentDomain).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&childDomain).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&models.Mailbox{
		OwnerID:   parentOwner.ID,
		Email:     "demo@shop.smtp-wild.test",
		LocalPart: "demo",
		Host:      "shop.smtp-wild.test",
		DomainID:  parentDomain.ID,
	}).Error; err != nil {
		t.Fatal(err)
	}

	session.Reset()
	if err := session.Mail("sender@example.test", nil); err != nil {
		t.Fatal(err)
	}
	if err := session.Rcpt("demo@shop.smtp-wild.test", nil); err != nil {
		t.Fatal(err)
	}
	if err := session.Data(strings.NewReader("From: Sender <sender@example.test>\r\n" +
		"To: demo@shop.smtp-wild.test\r\n" +
		"Subject: Exact child domain\r\n\r\n" +
		"hello\r\n")); err != nil {
		t.Fatal(err)
	}
	var msg models.Message
	if err := db.First(&msg, "recipient = ?", "demo@shop.smtp-wild.test").Error; err != nil {
		t.Fatal(err)
	}
	if msg.OwnerID == nil || *msg.OwnerID != childOwner.ID {
		t.Fatalf("owner snapshot = %v, want exact child owner %d", msg.OwnerID, childOwner.ID)
	}
	if msg.MailboxID != nil {
		t.Fatalf("mailbox snapshot = %v, want nil for exact child private fallback", *msg.MailboxID)
	}
	if msg.DomainID == nil || *msg.DomainID != childDomain.ID || msg.RootDomain != childDomain.Domain {
		t.Fatalf("domain snapshot id=%v root=%q, want child domain %d/%q", msg.DomainID, msg.RootDomain, childDomain.ID, childDomain.Domain)
	}
}

func TestDataStoresPrivateCatchAllOwnerSnapshot(t *testing.T) {
	session, db := newSMTPTestSession(t, config.Config{
		MaxMessageBytes:  4096,
		MessageRetention: time.Hour,
	})
	owner := models.User{Email: "private-owner@example.test", PasswordHash: "hash", Role: models.UserRoleUser, Enabled: true}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	domain := models.Domain{
		Domain:          "private.test",
		Mode:            models.DomainModePrivate,
		OwnerID:         &owner.ID,
		Active:          true,
		MXVerified:      true,
		WildcardEnabled: true,
	}
	if err := db.Create(&domain).Error; err != nil {
		t.Fatal(err)
	}
	session.Reset()
	if err := session.Mail("sender@example.test", nil); err != nil {
		t.Fatal(err)
	}
	if err := session.Rcpt("anything@private.test", nil); err != nil {
		t.Fatal(err)
	}
	if err := session.Data(strings.NewReader("From: Sender <sender@example.test>\r\n" +
		"To: anything@private.test\r\n" +
		"Subject: Catch all\r\n\r\n" +
		"hello\r\n")); err != nil {
		t.Fatal(err)
	}
	var msg models.Message
	if err := db.First(&msg, "recipient = ?", "anything@private.test").Error; err != nil {
		t.Fatal(err)
	}
	if msg.OwnerID == nil || *msg.OwnerID != owner.ID {
		t.Fatalf("owner snapshot = %v, want %d", msg.OwnerID, owner.ID)
	}
	if msg.MailboxID != nil {
		t.Fatalf("mailbox snapshot = %v, want nil for private catch-all", *msg.MailboxID)
	}
}

func newSMTPTestSession(t *testing.T, cfg config.Config) (*Session, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.User{}, &models.Domain{}, &models.Mailbox{}, &models.Message{}, &models.MessageAttachment{}, &models.MessageDailyStat{}, &models.WebhookEndpoint{}, &models.WebhookDelivery{}); err != nil {
		t.Fatal(err)
	}
	d := models.Domain{
		Domain:     "example.test",
		Mode:       models.DomainModePublic,
		Active:     true,
		MXVerified: true,
		CreatedAt:  time.Now(),
	}
	if err := db.Create(&d).Error; err != nil {
		t.Fatal(err)
	}
	owner := models.User{Email: "owner@example.test", PasswordHash: "hash", Role: models.UserRoleUser, Enabled: true}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&models.Mailbox{
		OwnerID:   owner.ID,
		Email:     "demo@example.test",
		LocalPart: "demo",
		Host:      "example.test",
		DomainID:  d.ID,
	}).Error; err != nil {
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
