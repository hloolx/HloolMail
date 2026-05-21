package jobs

import (
	"context"
	"strings"
	"testing"
	"time"

	"gptmail/internal/config"
	"gptmail/internal/models"
	"gptmail/internal/webhook"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestRunCleanupRemovesExpiredMessages(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.User{}, &models.Domain{}, &models.Mailbox{}, &models.Message{}, &models.MessageAttachment{}, &models.ShareLink{}, &models.ShareLinkAccessLog{}, &models.WebhookEndpoint{}, &models.WebhookDelivery{}, &models.AuditLog{}); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	owner := models.User{Email: "owner@example.test", PasswordHash: "hash", Role: models.UserRoleUser, Enabled: true}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	domain := models.Domain{Domain: "example.test", Mode: models.DomainModePrivate, OwnerID: &owner.ID, Active: true, MXVerified: true}
	if err := db.Create(&domain).Error; err != nil {
		t.Fatal(err)
	}
	mailbox := models.Mailbox{OwnerID: owner.ID, Email: "demo@example.test", LocalPart: "demo", Host: "example.test", DomainID: domain.ID}
	if err := db.Create(&mailbox).Error; err != nil {
		t.Fatal(err)
	}
	msg := models.Message{
		ID:        "expired",
		Recipient: "demo@example.test",
		ExpiresAt: now.Add(-time.Hour),
	}
	if err := db.Create(&msg).Error; err != nil {
		t.Fatal(err)
	}
	fresh := models.Message{
		ID:        "fresh",
		Recipient: "demo@example.test",
		ExpiresAt: now.Add(time.Hour),
	}
	if err := db.Create(&fresh).Error; err != nil {
		t.Fatal(err)
	}
	attachments := []models.MessageAttachment{
		{ID: "00000000-0000-0000-0000-000000000301", MessageID: msg.ID, Sequence: 1, SizeBytes: 5, SHA256: strings.Repeat("d", 64)},
		{ID: "00000000-0000-0000-0000-000000000302", MessageID: fresh.ID, Sequence: 1, SizeBytes: 5, SHA256: strings.Repeat("e", 64)},
	}
	if err := db.Create(&attachments).Error; err != nil {
		t.Fatal(err)
	}
	expiredMessageID := msg.ID
	freshMessageID := fresh.ID
	mailboxID := mailbox.ID
	shareLinks := []models.ShareLink{
		{OwnerID: owner.ID, TokenHash: "hash-expired", TokenPrefix: "expired", ResourceType: models.ShareResourceTypeMessage, MessageID: &expiredMessageID},
		{OwnerID: owner.ID, TokenHash: "hash-fresh", TokenPrefix: "fresh", ResourceType: models.ShareResourceTypeMessage, MessageID: &freshMessageID},
		{OwnerID: owner.ID, TokenHash: "hash-mailbox", TokenPrefix: "mailbox", ResourceType: models.ShareResourceTypeMailbox, MailboxID: &mailboxID, AccessKeyHash: "key-hash"},
	}
	if err := db.Create(&shareLinks).Error; err != nil {
		t.Fatal(err)
	}
	accessLogs := []models.ShareLinkAccessLog{
		{ShareLinkID: shareLinks[0].ID, OwnerID: owner.ID, ResourceType: models.ShareResourceTypeMessage, MessageID: &expiredMessageID, Success: true, IP: "127.0.0.1", UserAgent: "test"},
		{ShareLinkID: shareLinks[1].ID, OwnerID: owner.ID, ResourceType: models.ShareResourceTypeMessage, MessageID: &freshMessageID, Success: true, IP: "127.0.0.1", UserAgent: "test"},
		{ShareLinkID: shareLinks[2].ID, OwnerID: owner.ID, ResourceType: models.ShareResourceTypeMailbox, MailboxID: &mailboxID, Success: true, IP: "127.0.0.1", UserAgent: "test"},
	}
	if err := db.Create(&accessLogs).Error; err != nil {
		t.Fatal(err)
	}
	eventsJSON, err := webhook.EventsJSON([]string{models.WebhookEventMessageReceived})
	if err != nil {
		t.Fatal(err)
	}
	endpoint := models.WebhookEndpoint{
		OwnerID:       owner.ID,
		Name:          "cleanup",
		URL:           "https://example.com/hook",
		Secret:        "secret",
		SecretPreview: "preview",
		Enabled:       true,
		EventsJSON:    eventsJSON,
		Scope:         models.WebhookScopeAll,
	}
	if err := db.Create(&endpoint).Error; err != nil {
		t.Fatal(err)
	}
	nextAttempt := now.Add(-time.Minute)
	webhookDeliveries := []models.WebhookDelivery{
		{
			ID:            "00000000-0000-0000-0000-000000000401",
			EndpointID:    endpoint.ID,
			OwnerID:       owner.ID,
			EventType:     models.WebhookEventMessageReceived,
			MessageID:     msg.ID,
			PayloadJSON:   `{"message":{"subject":"expired","text_content":"expired secret","headers_json":"x-private"}}`,
			DedupKey:      "cleanup:expired",
			Status:        models.WebhookDeliveryStatusRetry,
			MaxAttempts:   8,
			NextAttemptAt: &nextAttempt,
			ResponseBody:  "echo expired secret",
		},
		{
			ID:            "00000000-0000-0000-0000-000000000402",
			EndpointID:    endpoint.ID,
			OwnerID:       owner.ID,
			EventType:     models.WebhookEventMessageReceived,
			MessageID:     fresh.ID,
			PayloadJSON:   `{"message":{"subject":"fresh","text_content":"fresh secret"}}`,
			DedupKey:      "cleanup:fresh",
			Status:        models.WebhookDeliveryStatusPending,
			MaxAttempts:   8,
			NextAttemptAt: &nextAttempt,
		},
	}
	if err := db.Create(&webhookDeliveries).Error; err != nil {
		t.Fatal(err)
	}
	if err := RunCleanup(db, now); err != nil {
		t.Fatal(err)
	}
	var count int64
	db.Unscoped().Model(&models.Message{}).Count(&count)
	if count != 1 {
		t.Fatalf("message count = %d", count)
	}
	if err := db.First(&models.Message{}, "id = ?", fresh.ID).Error; err != nil {
		t.Fatalf("fresh message missing: %v", err)
	}
	var remainingAttachments []models.MessageAttachment
	if err := db.Order("message_id asc").Find(&remainingAttachments).Error; err != nil {
		t.Fatal(err)
	}
	if len(remainingAttachments) != 1 || remainingAttachments[0].MessageID != fresh.ID {
		t.Fatalf("remaining attachments = %+v, want only fresh", remainingAttachments)
	}
	var expiredMessageShares int64
	if err := db.Model(&models.ShareLink{}).Where("resource_type = ? AND message_id = ?", models.ShareResourceTypeMessage, msg.ID).Count(&expiredMessageShares).Error; err != nil {
		t.Fatal(err)
	}
	if expiredMessageShares != 0 {
		t.Fatalf("expired historical message-scoped links = %d, want 0", expiredMessageShares)
	}
	var freshMessageShares int64
	if err := db.Model(&models.ShareLink{}).Where("resource_type = ? AND message_id = ?", models.ShareResourceTypeMessage, fresh.ID).Count(&freshMessageShares).Error; err != nil {
		t.Fatal(err)
	}
	if freshMessageShares != 1 {
		t.Fatalf("fresh historical message-scoped links = %d, want 1", freshMessageShares)
	}
	var mailboxShares int64
	if err := db.Model(&models.ShareLink{}).Where("resource_type = ? AND mailbox_id = ?", models.ShareResourceTypeMailbox, mailbox.ID).Count(&mailboxShares).Error; err != nil {
		t.Fatal(err)
	}
	if mailboxShares != 1 {
		t.Fatalf("mailbox share links = %d, want 1", mailboxShares)
	}
	var expiredMessageLogs int64
	if err := db.Model(&models.ShareLinkAccessLog{}).Where("resource_type = ? AND message_id = ?", models.ShareResourceTypeMessage, msg.ID).Count(&expiredMessageLogs).Error; err != nil {
		t.Fatal(err)
	}
	if expiredMessageLogs != 0 {
		t.Fatalf("expired message access logs = %d, want 0", expiredMessageLogs)
	}
	var remainingMailboxLogs int64
	if err := db.Model(&models.ShareLinkAccessLog{}).Where("resource_type = ? AND mailbox_id = ?", models.ShareResourceTypeMailbox, mailbox.ID).Count(&remainingMailboxLogs).Error; err != nil {
		t.Fatal(err)
	}
	if remainingMailboxLogs != 1 {
		t.Fatalf("mailbox access logs = %d, want 1", remainingMailboxLogs)
	}
	var expiredDelivery models.WebhookDelivery
	if err := db.First(&expiredDelivery, "id = ?", webhookDeliveries[0].ID).Error; err != nil {
		t.Fatal(err)
	}
	if expiredDelivery.Status != models.WebhookDeliveryStatusFailed || expiredDelivery.NextAttemptAt != nil {
		t.Fatalf("expired delivery was not canceled: %+v", expiredDelivery)
	}
	if !strings.Contains(expiredDelivery.PayloadJSON, `"redacted":true`) ||
		strings.Contains(expiredDelivery.PayloadJSON, "expired secret") ||
		strings.Contains(expiredDelivery.PayloadJSON, "x-private") ||
		expiredDelivery.ResponseBody != "" {
		t.Fatalf("expired delivery payload was not redacted: %+v", expiredDelivery)
	}
	var freshDelivery models.WebhookDelivery
	if err := db.First(&freshDelivery, "id = ?", webhookDeliveries[1].ID).Error; err != nil {
		t.Fatal(err)
	}
	if freshDelivery.Status != models.WebhookDeliveryStatusPending || !strings.Contains(freshDelivery.PayloadJSON, "fresh secret") {
		t.Fatalf("fresh delivery changed unexpectedly: %+v", freshDelivery)
	}
}

func TestRunCleanupWithConfigRemovesExpiredRegistrationDataAndKeepsExistingCleanup(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&models.User{},
		&models.Domain{},
		&models.Mailbox{},
		&models.Message{},
		&models.MessageAttachment{},
		&models.ShareLink{},
		&models.ShareLinkAccessLog{},
		&models.PendingRegistration{},
		&models.RegistrationCaptcha{},
		&models.AuditLog{},
	); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 5, 21, 12, 0, 0, 0, time.UTC)
	expiredAt := now.Add(-time.Minute)
	futureAt := now.Add(time.Hour)
	pending := []models.PendingRegistration{
		{
			VerificationID: "expired-pending",
			TokenHash:      "expired-token-hash",
			Email:          "expired@example.test",
			PasswordHash:   "expired-password-hash",
			CodeHash:       "expired-code-hash",
			ExpiresAt:      expiredAt,
			LastSentAt:     now.Add(-2 * time.Hour),
			IP:             "127.0.0.1",
			UserAgent:      "test",
		},
		{
			VerificationID: "fresh-pending",
			TokenHash:      "fresh-token-hash",
			Email:          "fresh@example.test",
			PasswordHash:   "fresh-password-hash",
			CodeHash:       "fresh-code-hash",
			ExpiresAt:      futureAt,
			LastSentAt:     now.Add(-time.Minute),
			IP:             "127.0.0.1",
			UserAgent:      "test",
		},
		{
			VerificationID: "boundary-pending",
			TokenHash:      "boundary-token-hash",
			Email:          "boundary@example.test",
			PasswordHash:   "boundary-password-hash",
			CodeHash:       "boundary-code-hash",
			ExpiresAt:      now,
			LastSentAt:     now.Add(-time.Minute),
			IP:             "127.0.0.1",
			UserAgent:      "test",
		},
	}
	if err := db.Create(&pending).Error; err != nil {
		t.Fatal(err)
	}
	captchas := []models.RegistrationCaptcha{
		{
			CaptchaID:  "expired-captcha",
			AnswerHash: "expired-answer-hash",
			Challenge:  "1 + 1",
			ExpiresAt:  expiredAt,
			IP:         "127.0.0.1",
			UserAgent:  "test",
		},
		{
			CaptchaID:  "fresh-captcha",
			AnswerHash: "fresh-answer-hash",
			Challenge:  "2 + 2",
			ExpiresAt:  futureAt,
			IP:         "127.0.0.1",
			UserAgent:  "test",
		},
		{
			CaptchaID:  "boundary-captcha",
			AnswerHash: "boundary-answer-hash",
			Challenge:  "3 + 3",
			ExpiresAt:  now,
			IP:         "127.0.0.1",
			UserAgent:  "test",
		},
	}
	if err := db.Create(&captchas).Error; err != nil {
		t.Fatal(err)
	}
	pendingDomain := models.Domain{
		Domain:          "expired-domain.test",
		Mode:            models.DomainModePrivate,
		Active:          true,
		PendingDeleteAt: &expiredAt,
	}
	retainedDomain := models.Domain{
		Domain:          "fresh-domain.test",
		Mode:            models.DomainModePrivate,
		Active:          true,
		PendingDeleteAt: &futureAt,
	}
	if err := db.Create(&[]models.Domain{pendingDomain, retainedDomain}).Error; err != nil {
		t.Fatal(err)
	}
	messages := []models.Message{
		{ID: "expired-message", Recipient: "old@example.test", ExpiresAt: expiredAt},
		{ID: "fresh-message", Recipient: "new@example.test", ExpiresAt: futureAt},
	}
	if err := db.Create(&messages).Error; err != nil {
		t.Fatal(err)
	}
	auditLogs := []models.AuditLog{
		{Category: "activity", Severity: "info", Action: "cleanup.old_activity", Actor: "system", Target: "old-activity", CreatedAt: now.AddDate(0, 0, -31)},
		{Category: "activity", Severity: "info", Action: "cleanup.fresh_activity", Actor: "system", Target: "fresh-activity", CreatedAt: now.AddDate(0, 0, -7)},
		{Category: "security", Severity: "warning", Action: "cleanup.old_security", Actor: "system", Target: "old-security", CreatedAt: now.AddDate(0, 0, -181)},
		{Category: "security", Severity: "warning", Action: "cleanup.fresh_security", Actor: "system", Target: "fresh-security", CreatedAt: now.AddDate(0, 0, -60)},
	}
	if err := db.Create(&auditLogs).Error; err != nil {
		t.Fatal(err)
	}

	if err := RunCleanupWithConfig(db, now, config.Config{}); err != nil {
		t.Fatal(err)
	}

	assertCount := func(name string, model any, want int64, query string, args ...any) {
		t.Helper()
		var count int64
		if err := db.Model(model).Where(query, args...).Count(&count).Error; err != nil {
			t.Fatal(err)
		}
		if count != want {
			t.Fatalf("%s count = %d, want %d", name, count, want)
		}
	}
	assertCount("expired pending registration", &models.PendingRegistration{}, 0, "verification_id = ?", "expired-pending")
	assertCount("fresh pending registration", &models.PendingRegistration{}, 1, "verification_id = ?", "fresh-pending")
	assertCount("boundary pending registration", &models.PendingRegistration{}, 1, "verification_id = ?", "boundary-pending")
	assertCount("expired registration captcha", &models.RegistrationCaptcha{}, 0, "captcha_id = ?", "expired-captcha")
	assertCount("fresh registration captcha", &models.RegistrationCaptcha{}, 1, "captcha_id = ?", "fresh-captcha")
	assertCount("boundary registration captcha", &models.RegistrationCaptcha{}, 1, "captcha_id = ?", "boundary-captcha")
	assertCount("expired message", &models.Message{}, 0, "id = ?", "expired-message")
	assertCount("fresh message", &models.Message{}, 1, "id = ?", "fresh-message")
	assertCount("expired pending domain", &models.Domain{}, 0, "domain = ?", "expired-domain.test")
	assertCount("fresh pending domain", &models.Domain{}, 1, "domain = ?", "fresh-domain.test")
	assertCount("old activity audit log", &models.AuditLog{}, 0, "target = ?", "old-activity")
	assertCount("fresh activity audit log", &models.AuditLog{}, 1, "target = ?", "fresh-activity")
	assertCount("old security audit log", &models.AuditLog{}, 0, "target = ?", "old-security")
	assertCount("fresh security audit log", &models.AuditLog{}, 1, "target = ?", "fresh-security")

	var freshPending models.PendingRegistration
	if err := db.First(&freshPending, "verification_id = ?", "fresh-pending").Error; err != nil {
		t.Fatal(err)
	}
	if freshPending.PasswordHash != "fresh-password-hash" {
		t.Fatalf("fresh pending password hash = %q, want unchanged", freshPending.PasswordHash)
	}
	var freshCaptcha models.RegistrationCaptcha
	if err := db.First(&freshCaptcha, "captcha_id = ?", "fresh-captcha").Error; err != nil {
		t.Fatal(err)
	}
	if freshCaptcha.AnswerHash != "fresh-answer-hash" {
		t.Fatalf("fresh captcha answer hash = %q, want unchanged", freshCaptcha.AnswerHash)
	}
}

func TestRunExpiredMessageCleanupUsesSetBasedDelete(t *testing.T) {
	queryLog := &sqlQueryLog{Interface: logger.Discard}
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: queryLog})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.User{}, &models.Message{}, &models.MessageAttachment{}, &models.ShareLink{}, &models.ShareLinkAccessLog{}); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	messages := []models.Message{
		{ID: "expired-1", Recipient: "a@example.test", ExpiresAt: now.Add(-time.Hour)},
		{ID: "expired-2", Recipient: "b@example.test", ExpiresAt: now.Add(-time.Minute)},
		{ID: "fresh", Recipient: "c@example.test", ExpiresAt: now.Add(time.Hour)},
	}
	if err := db.Create(&messages).Error; err != nil {
		t.Fatal(err)
	}

	queryLog.Reset()
	if err := RunExpiredMessageCleanup(db, now); err != nil {
		t.Fatal(err)
	}

	var deleteMessages, selectMessages int
	for _, stmt := range queryLog.Statements() {
		normalized := strings.ToUpper(stmt)
		if strings.HasPrefix(strings.TrimSpace(normalized), "DELETE FROM `MESSAGES`") || strings.HasPrefix(strings.TrimSpace(normalized), "DELETE FROM \"MESSAGES\"") {
			deleteMessages++
		}
		if strings.Contains(normalized, "MESSAGES") && strings.HasPrefix(strings.TrimSpace(normalized), "SELECT") {
			selectMessages++
		}
	}
	if deleteMessages != 1 {
		t.Fatalf("message delete statements = %d, want 1; statements=%v", deleteMessages, queryLog.Statements())
	}
	if selectMessages != 0 {
		t.Fatalf("message cleanup issued SELECT statements: %v", queryLog.Statements())
	}
}

func TestRunPendingDomainCleanupUsesExplicitDeleteDeadline(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.User{}, &models.Domain{}, &models.Message{}, &models.MessageAttachment{}, &models.ShareLink{}, &models.ShareLinkAccessLog{}, &models.AuditLog{}); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	expiredAt := now.Add(-time.Minute)
	firstVerifiedAt := now.Add(-24 * time.Hour)
	legacyOldUnhealthy := models.Domain{
		Domain:     "legacy-old-unhealthy.test",
		Mode:       models.DomainModePrivate,
		Active:     true,
		MXVerified: false,
		CreatedAt:  now.Add(-30 * 24 * time.Hour),
	}
	expiredNeverVerified := models.Domain{
		Domain:          "expired-never-verified.test",
		Mode:            models.DomainModePrivate,
		Active:          true,
		PendingDeleteAt: &expiredAt,
		CreatedAt:       now.Add(-30 * time.Minute),
	}
	previouslyVerifiedNowUnhealthy := models.Domain{
		Domain:          "previously-verified-unhealthy.test",
		Mode:            models.DomainModePrivate,
		Active:          true,
		MXVerified:      false,
		FirstVerifiedAt: &firstVerifiedAt,
		PendingDeleteAt: &expiredAt,
		CreatedAt:       now.Add(-30 * 24 * time.Hour),
	}
	ready := models.Domain{
		Domain:          "ready.test",
		Mode:            models.DomainModePublic,
		Active:          true,
		MXVerified:      true,
		FirstVerifiedAt: &firstVerifiedAt,
		CreatedAt:       now.Add(-3 * time.Hour),
	}
	if err := db.Create(&[]models.Domain{legacyOldUnhealthy, expiredNeverVerified, previouslyVerifiedNowUnhealthy, ready}).Error; err != nil {
		t.Fatal(err)
	}
	if err := RunPendingDomainCleanup(db, now); err != nil {
		t.Fatal(err)
	}
	for _, domainName := range []string{"expired-never-verified.test"} {
		var count int64
		db.Model(&models.Domain{}).Where("domain = ?", domainName).Count(&count)
		if count != 0 {
			t.Fatalf("expected %s to be deleted, count=%d", domainName, count)
		}
	}
	for _, domainName := range []string{"legacy-old-unhealthy.test", "previously-verified-unhealthy.test", "ready.test"} {
		var count int64
		db.Model(&models.Domain{}).Where("domain = ?", domainName).Count(&count)
		if count != 1 {
			t.Fatalf("expected %s to remain, count=%d", domainName, count)
		}
	}
}

func TestRunPendingDomainCleanupKeepsDomainsWithBusinessData(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.User{}, &models.Domain{}, &models.Mailbox{}, &models.Message{}, &models.Notification{}); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	expiredAt := now.Add(-time.Minute)
	user := models.User{
		Email:        "owner@example.test",
		PasswordHash: "hash",
		Role:         models.UserRoleUser,
		Enabled:      true,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	withMailbox := models.Domain{Domain: "with-mailbox.test", Mode: models.DomainModePrivate, Active: true, PendingDeleteAt: &expiredAt}
	withMessage := models.Domain{Domain: "with-message.test", Mode: models.DomainModePrivate, Active: true, PendingDeleteAt: &expiredAt}
	withoutData := models.Domain{Domain: "without-data.test", Mode: models.DomainModePrivate, Active: true, PendingDeleteAt: &expiredAt}
	if err := db.Create(&[]models.Domain{withMailbox, withMessage, withoutData}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&withMailbox, "domain = ?", withMailbox.Domain).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&withMessage, "domain = ?", withMessage.Domain).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&models.Mailbox{
		OwnerID:   user.ID,
		Email:     "box@with-mailbox.test",
		LocalPart: "box",
		Host:      "with-mailbox.test",
		DomainID:  withMailbox.ID,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&models.Message{
		ID:              "message-domain",
		Recipient:       "inbox@with-message.test",
		RecipientLocal:  "inbox",
		RecipientDomain: "with-message.test",
		RootDomain:      "with-message.test",
		DomainID:        &withMessage.ID,
		FromAddress:     "sender@example.test",
		Subject:         "hello",
		ExpiresAt:       now.Add(time.Hour),
	}).Error; err != nil {
		t.Fatal(err)
	}

	if err := RunPendingDomainCleanup(db, now); err != nil {
		t.Fatal(err)
	}

	for _, domainName := range []string{"with-mailbox.test", "with-message.test"} {
		var count int64
		db.Model(&models.Domain{}).Where("domain = ?", domainName).Count(&count)
		if count != 1 {
			t.Fatalf("expected %s to remain, count=%d", domainName, count)
		}
	}
	var deleted int64
	db.Model(&models.Domain{}).Where("domain = ?", "without-data.test").Count(&deleted)
	if deleted != 0 {
		t.Fatalf("expected domain without business data to be deleted, count=%d", deleted)
	}
}

func TestRunAuditLogCleanupUsesSeparateRetentionWindows(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.AuditLog{}); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	logs := []models.AuditLog{
		{Category: "activity", Severity: "info", Action: "mailbox.create", Actor: "user@example.com", Target: "old", CreatedAt: now.AddDate(0, 0, -31)},
		{Category: "activity", Severity: "info", Action: "mailbox.create", Actor: "user@example.com", Target: "fresh", CreatedAt: now.AddDate(0, 0, -7)},
		{Category: "security", Severity: "warning", Action: "api_key.reveal", Actor: "admin@example.com", Target: "old", CreatedAt: now.AddDate(0, 0, -181)},
		{Category: "security", Severity: "warning", Action: "api_key.reveal", Actor: "admin@example.com", Target: "fresh", CreatedAt: now.AddDate(0, 0, -60)},
	}
	if err := db.Create(&logs).Error; err != nil {
		t.Fatal(err)
	}

	if err := RunAuditLogCleanup(db, now, 180, 30); err != nil {
		t.Fatal(err)
	}

	var remaining []models.AuditLog
	if err := db.Order("target asc").Find(&remaining).Error; err != nil {
		t.Fatal(err)
	}
	if len(remaining) != 2 {
		t.Fatalf("remaining logs = %d, want 2: %+v", len(remaining), remaining)
	}
	for _, log := range remaining {
		if log.Target != "fresh" {
			t.Fatalf("unexpected remaining log: %+v", log)
		}
	}
}

type sqlQueryLog struct {
	logger.Interface
	statements []string
}

func (l *sqlQueryLog) Trace(ctx context.Context, begin time.Time, fc func() (string, int64), err error) {
	sql, _ := fc()
	l.statements = append(l.statements, sql)
	l.Interface.Trace(ctx, begin, fc, err)
}

func (l *sqlQueryLog) Reset() {
	l.statements = nil
}

func (l *sqlQueryLog) Statements() []string {
	return append([]string(nil), l.statements...)
}
