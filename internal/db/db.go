package db

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"gptmail/internal/config"
	"gptmail/internal/models"

	"github.com/glebarez/sqlite"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/gorm/logger"
)

func Open(cfg config.Config) (*gorm.DB, error) {
	driver := strings.ToLower(cfg.DatabaseDriver)
	if strings.HasPrefix(cfg.DatabaseURL, "postgres://") || strings.HasPrefix(cfg.DatabaseURL, "postgresql://") {
		driver = "postgres"
	}

	gormConfig := &gorm.Config{Logger: logger.Default.LogMode(logger.Warn)}
	switch driver {
	case "postgres", "postgresql":
		return gorm.Open(postgres.Open(cfg.DatabaseURL), gormConfig)
	case "sqlite", "sqlite3", "":
		return openSQLite(cfg.DatabaseURL, gormConfig)
	default:
		return nil, fmt.Errorf("unsupported database driver %q", cfg.DatabaseDriver)
	}
}

func openSQLite(dsn string, gormConfig *gorm.Config) (*gorm.DB, error) {
	dsn = resolveSQLiteDefaultDSN(dsn)
	dir := filepath.Dir(dsn)
	if err := os.MkdirAll(dir, 0o755); err != nil && dir != "." {
		return nil, err
	}

	db, err := gorm.Open(sqlite.Open(sqliteDSNWithPragmas(dsn)), gormConfig)
	if err != nil {
		return nil, err
	}
	if err := configureSQLitePool(db); err != nil {
		return nil, err
	}
	if err := configureSQLite(db); err != nil {
		return nil, err
	}
	return db, nil
}

func resolveSQLiteDefaultDSN(dsn string) string {
	defaults := []struct {
		current string
		legacy  string
	}{
		{current: config.DefaultSQLiteDatabaseURL, legacy: config.LegacySQLiteDatabaseURL},
		{current: config.DefaultDockerSQLiteDatabaseURL, legacy: config.LegacyDockerSQLiteDatabaseURL},
	}
	for _, pair := range defaults {
		if sameSQLitePath(dsn, pair.current) && sqliteFileExists(pair.legacy) && !sqliteFileExists(pair.current) {
			return pair.legacy
		}
	}
	return dsn
}

func sameSQLitePath(a, b string) bool {
	return filepath.Clean(strings.TrimSpace(a)) == filepath.Clean(strings.TrimSpace(b))
}

func sqliteFileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func sqliteDSNWithPragmas(dsn string) string {
	const pragmas = "_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(ON)"

	base, fragment, hasFragment := strings.Cut(dsn, "#")
	separator := "?"
	if strings.Contains(base, "?") {
		separator = "&"
	}
	if strings.HasSuffix(base, "?") || strings.HasSuffix(base, "&") {
		separator = ""
	}

	configured := base + separator + pragmas
	if hasFragment {
		configured += "#" + fragment
	}
	return configured
}

func configureSQLitePool(db *gorm.DB) error {
	sqlDB, err := db.DB()
	if err != nil {
		return err
	}
	sqlDB.SetMaxOpenConns(1)
	sqlDB.SetMaxIdleConns(1)
	return nil
}

func configureSQLite(db *gorm.DB) error {
	pragmas := []string{
		"PRAGMA journal_mode=WAL",
		"PRAGMA busy_timeout=5000",
		"PRAGMA foreign_keys=ON",
	}
	for _, pragma := range pragmas {
		if err := db.Exec(pragma).Error; err != nil {
			return fmt.Errorf("%s: %w", pragma, err)
		}
	}
	return nil
}

func AutoMigrate(db *gorm.DB) error {
	hadPendingRegistrationTable := db.Migrator().HasTable(&models.PendingRegistration{})
	if err := db.AutoMigrate(
		&models.User{},
		&models.PendingRegistration{},
		&models.RegistrationCaptcha{},
		&models.OAuthIdentity{},
		&models.PasskeyCredential{},
		&models.WebAuthnSession{},
		&models.OAuthProviderSetting{},
		&models.DomainCheckSettings{},
		&models.DomainCheckRun{},
		&models.Domain{},
		&models.APIKey{},
		&models.SessionToken{},
		&models.Mailbox{},
		&models.Message{},
		&models.MessageAttachment{},
		&models.MessageDailyStat{},
		&models.ShareLink{},
		&models.ShareLinkAccessLog{},
		&models.WebhookEndpoint{},
		&models.WebhookDelivery{},
		&models.EmailDelivery{},
		&models.APIUsageLog{},
		&models.Notification{},
		&models.Announcement{},
		&models.AnnouncementRead{},
		&models.DomainCheckResultRecord{},
		&models.AuditLog{},
		&models.SystemQuotaSettings{},
		&models.APIInterfaceSettings{},
		&models.LoginSettings{},
	); err != nil {
		return err
	}
	if err := EnsureShareLinkMailboxShareSchema(db); err != nil {
		return err
	}
	if err := BackfillExistingUsersEmailVerified(db, hadPendingRegistrationTable); err != nil {
		return err
	}
	if err := BackfillUserNicknameDefaults(db); err != nil {
		return err
	}
	if err := BackfillDomainBoolDefaults(db); err != nil {
		return err
	}
	if err := BackfillMessageOwnership(db); err != nil {
		return err
	}
	if err := BackfillMessageDailyStats(db); err != nil {
		return err
	}
	if err := BackfillMailboxCounters(db); err != nil {
		return err
	}
	return BackfillDomainFirstVerifiedAt(db)
}

func EnsureShareLinkMailboxShareSchema(db *gorm.DB) error {
	if !db.Migrator().HasTable(&models.ShareLink{}) {
		return nil
	}
	columns, err := db.Migrator().ColumnTypes(&models.ShareLink{})
	if err != nil {
		return err
	}
	for _, column := range columns {
		if strings.EqualFold(column.Name(), "message_id") {
			if nullable, ok := column.Nullable(); ok && nullable {
				continue
			}
			if err := db.Migrator().AlterColumn(&models.ShareLink{}, "MessageID"); err != nil {
				return err
			}
			continue
		}
		if strings.EqualFold(column.Name(), "resource_type") {
			defaultValue, _ := column.DefaultValue()
			defaultValue = strings.Trim(defaultValue, "'\"")
			if strings.EqualFold(defaultValue, models.ShareResourceTypeMailbox) {
				continue
			}
			if err := db.Migrator().AlterColumn(&models.ShareLink{}, "ResourceType"); err != nil {
				return err
			}
		}
	}
	return nil
}

func BackfillDomainBoolDefaults(db *gorm.DB) error {
	defaults := map[string]bool{
		"active":             false,
		"mx_verified":        false,
		"wildcard_requested": false,
		"wildcard_enabled":   false,
	}
	for column, value := range defaults {
		if err := db.Model(&models.Domain{}).Where(column+" IS NULL").Update(column, value).Error; err != nil {
			return err
		}
	}
	return nil
}

func BackfillUserNicknameDefaults(db *gorm.DB) error {
	for _, table := range []string{"users", "pending_registrations"} {
		ok, err := hasTableColumns(db, table, "nickname")
		if err != nil || !ok {
			return err
		}
		if err := db.Table(table).Where("nickname IS NULL").Update("nickname", "").Error; err != nil {
			return err
		}
	}
	return nil
}

func BackfillExistingUsersEmailVerified(db *gorm.DB, hadPendingRegistrationTable bool) error {
	ok, err := hasTableColumns(db, "users", "email_verified")
	if err != nil || !ok {
		return err
	}
	query := db.Model(&models.User{}).Where("email_verified IS NULL OR email_verified = ?", false)
	if !hadPendingRegistrationTable {
		return query.Update("email_verified", true).Error
	}
	ok, err = hasTableColumns(db, "users", "email")
	if err != nil || !ok {
		return err
	}
	ok, err = hasTableColumns(db, "pending_registrations", "email")
	if err != nil || !ok {
		return nil
	}
	return query.
		Where("NOT EXISTS (SELECT 1 FROM pending_registrations WHERE pending_registrations.email = users.email)").
		Update("email_verified", true).Error
}

func BackfillMessageOwnership(db *gorm.DB) error {
	ok, err := hasTableColumns(db, "messages", "recipient", "recipient_domain", "root_domain", "owner_id", "mailbox_id", "domain_id")
	if err != nil || !ok {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		ok, err := hasTableColumns(tx, "mailboxes", "id", "email", "owner_id", "domain_id")
		if err != nil {
			return err
		}
		if ok {
			if err := backfillMessageMailboxOwnership(tx); err != nil {
				return err
			}
		}

		ok, err = hasTableColumns(tx, "domains", "id", "domain", "mode", "owner_id")
		if err != nil {
			return err
		}
		if !ok {
			return nil
		}
		if err := backfillMessagePrivateDomainOwnership(tx, "root_domain"); err != nil {
			return err
		}
		return backfillMessagePrivateDomainOwnership(tx, "recipient_domain")
	})
}

func backfillMessageMailboxOwnership(db *gorm.DB) error {
	mailboxMatch := "mailboxes.email = messages.recipient"
	return db.Unscoped().Model(&models.Message{}).
		Where("owner_id IS NULL").
		Where("EXISTS (SELECT 1 FROM mailboxes WHERE " + mailboxMatch + ")").
		Updates(map[string]interface{}{
			"owner_id":   gorm.Expr("(SELECT mailboxes.owner_id FROM mailboxes WHERE " + mailboxMatch + " LIMIT 1)"),
			"mailbox_id": gorm.Expr("(SELECT mailboxes.id FROM mailboxes WHERE " + mailboxMatch + " LIMIT 1)"),
			"domain_id":  gorm.Expr("(SELECT mailboxes.domain_id FROM mailboxes WHERE " + mailboxMatch + " LIMIT 1)"),
		}).Error
}

func backfillMessagePrivateDomainOwnership(db *gorm.DB, messageDomainColumn string) error {
	switch messageDomainColumn {
	case "root_domain", "recipient_domain":
	default:
		return fmt.Errorf("unsupported message domain column %q", messageDomainColumn)
	}
	domainMatch := "domains.domain = messages." + messageDomainColumn
	privateDomainMatch := domainMatch + " AND domains.mode = ? AND domains.owner_id IS NOT NULL"
	return db.Unscoped().Model(&models.Message{}).
		Where("owner_id IS NULL").
		Where("EXISTS (SELECT 1 FROM domains WHERE "+privateDomainMatch+")", models.DomainModePrivate).
		Updates(map[string]interface{}{
			"owner_id":  gorm.Expr("(SELECT domains.owner_id FROM domains WHERE "+privateDomainMatch+" LIMIT 1)", models.DomainModePrivate),
			"domain_id": gorm.Expr("(SELECT domains.id FROM domains WHERE "+privateDomainMatch+" LIMIT 1)", models.DomainModePrivate),
		}).Error
}

func hasTableColumns(db *gorm.DB, table string, columns ...string) (bool, error) {
	if !db.Migrator().HasTable(table) {
		return false, nil
	}
	columnTypes, err := db.Migrator().ColumnTypes(table)
	if err != nil {
		return false, err
	}
	available := make(map[string]struct{}, len(columnTypes))
	for _, column := range columnTypes {
		available[strings.ToLower(column.Name())] = struct{}{}
	}
	for _, column := range columns {
		if _, ok := available[strings.ToLower(column)]; !ok {
			return false, nil
		}
	}
	return true, nil
}

func BackfillDomainFirstVerifiedAt(db *gorm.DB) error {
	return db.Model(&models.Domain{}).
		Where("active = ? AND (mx_verified = ? OR COALESCE(wildcard_enabled, ?) = ?) AND first_verified_at IS NULL",
			true,
			true,
			false,
			true,
		).
		Update("first_verified_at", gorm.Expr("COALESCE(last_healthy_at, updated_at, created_at)")).Error
}

func BackfillMailboxCounters(db *gorm.DB) error {
	return db.Transaction(func(tx *gorm.DB) error {
		if err := backfillDomainMailboxCounters(tx); err != nil {
			return err
		}
		if err := backfillUserMailboxCounters(tx); err != nil {
			return err
		}
		return backfillUserPublicMailboxToday(tx, time.Now())
	})
}

type mailboxCountRow struct {
	ID    uint
	Count int64
}

func backfillDomainMailboxCounters(db *gorm.DB) error {
	var rows []mailboxCountRow
	if err := db.Table("mailboxes").
		Select("domain_id AS id, COUNT(*) AS count").
		Group("domain_id").
		Scan(&rows).Error; err != nil {
		return err
	}
	for _, row := range rows {
		if row.ID == 0 {
			continue
		}
		if err := db.Model(&models.Domain{}).
			Where("id = ? AND mailbox_created_count < ?", row.ID, row.Count).
			Update("mailbox_created_count", row.Count).Error; err != nil {
			return err
		}
	}
	return nil
}

func backfillUserMailboxCounters(db *gorm.DB) error {
	for _, mode := range []struct {
		domainMode string
		column     string
	}{
		{domainMode: models.DomainModePublic, column: "public_mailbox_created"},
		{domainMode: models.DomainModePrivate, column: "private_mailbox_created"},
	} {
		var rows []mailboxCountRow
		if err := db.Table("mailboxes").
			Select("mailboxes.owner_id AS id, COUNT(*) AS count").
			Joins("JOIN domains ON domains.id = mailboxes.domain_id").
			Where("domains.mode = ?", mode.domainMode).
			Group("mailboxes.owner_id").
			Scan(&rows).Error; err != nil {
			return err
		}
		for _, row := range rows {
			if row.ID == 0 {
				continue
			}
			if err := db.Model(&models.User{}).
				Where("id = ? AND "+mode.column+" < ?", row.ID, row.Count).
				Update(mode.column, row.Count).Error; err != nil {
				return err
			}
		}
	}
	return nil
}

func backfillUserPublicMailboxToday(db *gorm.DB, now time.Time) error {
	today := now.Format("2006-01-02")
	start := startOfLocalDay(now)
	var rows []mailboxCountRow
	if err := db.Table("mailboxes").
		Select("mailboxes.owner_id AS id, COUNT(*) AS count").
		Joins("JOIN domains ON domains.id = mailboxes.domain_id").
		Where("domains.mode = ? AND mailboxes.created_at >= ?", models.DomainModePublic, start).
		Group("mailboxes.owner_id").
		Scan(&rows).Error; err != nil {
		return err
	}
	for _, row := range rows {
		if row.ID == 0 {
			continue
		}
		if err := db.Model(&models.User{}).
			Where("id = ? AND (public_mailbox_date <> ? OR public_mailbox_today < ?)", row.ID, today, row.Count).
			Updates(map[string]interface{}{
				"public_mailbox_date":  today,
				"public_mailbox_today": row.Count,
			}).Error; err != nil {
			return err
		}
	}
	return nil
}

func startOfLocalDay(t time.Time) time.Time {
	y, m, d := t.Local().Date()
	return time.Date(y, m, d, 0, 0, 0, 0, t.Location())
}

func IncrementMessageDailyStat(tx *gorm.DB, at time.Time, amount int64) error {
	if amount <= 0 {
		return nil
	}
	now := time.Now()
	return tx.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "day"}},
		DoUpdates: clause.Assignments(map[string]interface{}{
			"message_count": messageDailyStatIncrementExpr(amount),
			"updated_at":    now,
		}),
	}).Create(&models.MessageDailyStat{
		Day:          at.Local().Format("2006-01-02"),
		MessageCount: amount,
		CreatedAt:    now,
		UpdatedAt:    now,
	}).Error
}

func BackfillMessageDailyStats(db *gorm.DB) error {
	ok, err := hasTableColumns(db, "messages", "created_at")
	if err != nil || !ok {
		return err
	}
	if !db.Migrator().HasTable(&models.MessageDailyStat{}) {
		return nil
	}
	rows, err := db.Unscoped().Model(&models.Message{}).Select("created_at").Rows()
	if err != nil {
		return err
	}
	defer rows.Close()

	counts := map[string]int64{}
	for rows.Next() {
		var createdAt time.Time
		if err := rows.Scan(&createdAt); err != nil {
			return err
		}
		if createdAt.IsZero() {
			continue
		}
		counts[createdAt.Local().Format("2006-01-02")]++
	}
	if err := rows.Err(); err != nil {
		return err
	}

	now := time.Now()
	for day, count := range counts {
		if err := db.Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "day"}},
			DoUpdates: clause.Assignments(map[string]interface{}{
				"message_count": messageDailyStatMaxExpr(count),
				"updated_at":    now,
			}),
		}).Create(&models.MessageDailyStat{
			Day:          day,
			MessageCount: count,
			CreatedAt:    now,
			UpdatedAt:    now,
		}).Error; err != nil {
			return err
		}
	}
	return nil
}

func messageDailyStatCountColumn() clause.Column {
	return clause.Column{Table: clause.CurrentTable, Name: "message_count"}
}

func messageDailyStatIncrementExpr(amount int64) clause.Expr {
	return gorm.Expr("? + ?", messageDailyStatCountColumn(), amount)
}

func messageDailyStatMaxExpr(count int64) clause.Expr {
	column := messageDailyStatCountColumn()
	return gorm.Expr("CASE WHEN ? < ? THEN ? ELSE ? END", column, count, count, column)
}

func EnsureLoginSettings(db *gorm.DB) (*models.LoginSettings, error) {
	var settings models.LoginSettings
	err := db.First(&settings).Error
	if err == nil {
		return normalizeLoginSettings(db, &settings)
	}
	if err != gorm.ErrRecordNotFound {
		return nil, err
	}
	settings = models.LoginSettings{
		ID:                    1,
		EmailVerificationMode: models.EmailVerificationModeInternal,
		InternalSenderPrefix:  "no-reply",
		SMTPSecurity:          models.SMTPSecuritySTARTTLS,
	}
	if err := db.Create(&settings).Error; err != nil {
		if err2 := db.First(&settings).Error; err2 != nil {
			return nil, err
		}
		return normalizeLoginSettings(db, &settings)
	}
	return normalizeLoginSettings(db, &settings)
}

func normalizeLoginSettings(db *gorm.DB, settings *models.LoginSettings) (*models.LoginSettings, error) {
	changed := false
	if strings.TrimSpace(settings.EmailVerificationMode) == "" {
		settings.EmailVerificationMode = models.EmailVerificationModeInternal
		changed = true
	}
	if strings.TrimSpace(settings.InternalSenderPrefix) == "" {
		settings.InternalSenderPrefix = "no-reply"
		changed = true
	}
	if strings.TrimSpace(settings.SMTPSecurity) == "" {
		settings.SMTPSecurity = models.SMTPSecuritySTARTTLS
		changed = true
	}
	if !changed {
		return settings, nil
	}
	if err := db.Save(settings).Error; err != nil {
		return nil, err
	}
	return settings, nil
}

func EnsureSystemQuotaSettings(db *gorm.DB) (*models.SystemQuotaSettings, error) {
	var settings models.SystemQuotaSettings
	err := db.First(&settings).Error
	if err == nil {
		return &settings, nil
	}
	if err != gorm.ErrRecordNotFound {
		return nil, err
	}
	settings = models.SystemQuotaSettings{
		ID: 1,
	}
	if err := db.Create(&settings).Error; err != nil {
		// race: another request may have created it
		if err2 := db.First(&settings).Error; err2 != nil {
			return nil, err
		}
		return &settings, nil
	}
	return &settings, nil
}

func EnsureAPIInterfaceSettings(db *gorm.DB) (*models.APIInterfaceSettings, error) {
	var settings models.APIInterfaceSettings
	err := db.First(&settings).Error
	if err == nil {
		return &settings, nil
	}
	if err != gorm.ErrRecordNotFound {
		return nil, err
	}
	settings = models.APIInterfaceSettings{ID: 1}
	if err := db.Create(&settings).Error; err != nil {
		if err2 := db.First(&settings).Error; err2 != nil {
			return nil, err
		}
		return &settings, nil
	}
	return &settings, nil
}
