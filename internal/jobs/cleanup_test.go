package jobs

import (
	"context"
	"strings"
	"testing"
	"time"

	"gptmail/internal/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestRunCleanupRemovesExpiredMessages(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.Domain{}, &models.Message{}, &models.AuditLog{}); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
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
}

func TestRunExpiredMessageCleanupUsesSetBasedDelete(t *testing.T) {
	queryLog := &sqlQueryLog{Interface: logger.Discard}
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: queryLog})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.Message{}); err != nil {
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
		if strings.Contains(normalized, "MESSAGES") && strings.HasPrefix(strings.TrimSpace(normalized), "DELETE") {
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

func TestRunCleanupRemovesExpiredWaitingDomains(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.Domain{}, &models.Message{}, &models.AuditLog{}); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	oldPending := models.Domain{
		Domain:    "old-pending.test",
		Mode:      models.DomainModePrivate,
		Active:    true,
		CreatedAt: now.Add(-3 * time.Hour),
	}
	oldWildcardPending := models.Domain{
		Domain:            "old-wildcard.test",
		Mode:              models.DomainModePrivate,
		Active:            true,
		MXVerified:        true,
		WildcardRequested: true,
		CreatedAt:         now.Add(-3 * time.Hour),
	}
	freshPending := models.Domain{
		Domain:    "fresh-pending.test",
		Mode:      models.DomainModePrivate,
		Active:    true,
		CreatedAt: now.Add(-30 * time.Minute),
	}
	ready := models.Domain{
		Domain:     "ready.test",
		Mode:       models.DomainModePublic,
		Active:     true,
		MXVerified: true,
		CreatedAt:  now.Add(-3 * time.Hour),
	}
	if err := db.Create(&[]models.Domain{oldPending, oldWildcardPending, freshPending, ready}).Error; err != nil {
		t.Fatal(err)
	}
	if err := RunCleanup(db, now); err != nil {
		t.Fatal(err)
	}
	for _, domainName := range []string{"old-pending.test", "old-wildcard.test"} {
		var count int64
		db.Model(&models.Domain{}).Where("domain = ?", domainName).Count(&count)
		if count != 0 {
			t.Fatalf("expected %s to be deleted, count=%d", domainName, count)
		}
	}
	for _, domainName := range []string{"fresh-pending.test", "ready.test"} {
		var count int64
		db.Model(&models.Domain{}).Where("domain = ?", domainName).Count(&count)
		if count != 1 {
			t.Fatalf("expected %s to remain, count=%d", domainName, count)
		}
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
