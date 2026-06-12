package db

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"gptmail/internal/config"
	"gptmail/internal/models"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func TestOpenSQLiteConfiguresPragmas(t *testing.T) {
	database, err := Open(config.Config{
		DatabaseDriver: "sqlite",
		DatabaseURL:    filepath.Join(t.TempDir(), "mail.db"),
	})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := database.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()

	var journalMode string
	if err := database.Raw("PRAGMA journal_mode").Scan(&journalMode).Error; err != nil {
		t.Fatal(err)
	}
	if strings.ToLower(journalMode) != "wal" {
		t.Fatalf("journal_mode = %q, want wal", journalMode)
	}

	var busyTimeout int
	if err := database.Raw("PRAGMA busy_timeout").Scan(&busyTimeout).Error; err != nil {
		t.Fatal(err)
	}
	if busyTimeout != 5000 {
		t.Fatalf("busy_timeout = %d, want 5000", busyTimeout)
	}

	var foreignKeys int
	if err := database.Raw("PRAGMA foreign_keys").Scan(&foreignKeys).Error; err != nil {
		t.Fatal(err)
	}
	if foreignKeys != 1 {
		t.Fatalf("foreign_keys = %d, want 1", foreignKeys)
	}

	if maxOpen := sqlDB.Stats().MaxOpenConnections; maxOpen != 1 {
		t.Fatalf("MaxOpenConnections = %d, want 1", maxOpen)
	}
}

func TestOpenSQLiteDefaultUsesLegacyDatabaseWhenNewDefaultMissing(t *testing.T) {
	withTempWorkdir(t)
	legacy := openSQLiteMarkerDB(t, config.LegacySQLiteDatabaseURL, "legacy")
	closeGormDB(t, legacy)

	database, err := Open(config.Config{
		DatabaseDriver: "sqlite",
		DatabaseURL:    config.DefaultSQLiteDatabaseURL,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer closeGormDB(t, database)

	if got := readSQLiteMarker(t, database); got != "legacy" {
		t.Fatalf("opened marker = %q, want legacy database", got)
	}
	if sqliteFileExists(config.DefaultSQLiteDatabaseURL) {
		t.Fatalf("new default database %q should not be created when legacy database exists", config.DefaultSQLiteDatabaseURL)
	}
}

func TestOpenSQLiteDefaultPrefersNewDefaultWhenItExists(t *testing.T) {
	withTempWorkdir(t)
	current := openSQLiteMarkerDB(t, config.DefaultSQLiteDatabaseURL, "current")
	closeGormDB(t, current)
	legacy := openSQLiteMarkerDB(t, config.LegacySQLiteDatabaseURL, "legacy")
	closeGormDB(t, legacy)

	database, err := Open(config.Config{
		DatabaseDriver: "sqlite",
		DatabaseURL:    config.DefaultSQLiteDatabaseURL,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer closeGormDB(t, database)

	if got := readSQLiteMarker(t, database); got != "current" {
		t.Fatalf("opened marker = %q, want current database", got)
	}
}

func TestSQLiteDSNWithPragmasPreservesExistingQuery(t *testing.T) {
	dsn := sqliteDSNWithPragmas("storage/mail.db?cache=shared")
	if !strings.HasPrefix(dsn, "storage/mail.db?cache=shared&") {
		t.Fatalf("dsn = %q, want existing query preserved", dsn)
	}
	for _, want := range []string{
		"_pragma=journal_mode(WAL)",
		"_pragma=busy_timeout(5000)",
		"_pragma=foreign_keys(ON)",
	} {
		if !strings.Contains(dsn, want) {
			t.Fatalf("dsn = %q, missing %s", dsn, want)
		}
	}
}

func TestConfigurePostgresPoolAppliesConfiguredLimits(t *testing.T) {
	sqliteDB, err := Open(config.Config{
		DatabaseDriver: "sqlite",
		DatabaseURL:    filepath.Join(t.TempDir(), "pool.db"),
	})
	if err != nil {
		t.Fatal(err)
	}
	defer closeGormDB(t, sqliteDB)

	if err := configurePostgresPool(sqliteDB, config.Config{DBMaxOpenConns: 17, DBMaxIdleConns: 3}); err != nil {
		t.Fatal(err)
	}
	sqlDB, err := sqliteDB.DB()
	if err != nil {
		t.Fatal(err)
	}
	if got := sqlDB.Stats().MaxOpenConnections; got != 17 {
		t.Fatalf("MaxOpenConnections = %d, want 17", got)
	}
}

func TestRunMigrationsRecordsEmbeddedBaseline(t *testing.T) {
	database := openSQLiteTestDB(t)

	if err := RunMigrations(database); err != nil {
		t.Fatal(err)
	}
	if err := RunMigrations(database); err != nil {
		t.Fatal(err)
	}

	var row struct {
		Version uint64
		Name    string
		Count   int64
	}
	if err := database.Raw("SELECT version, name, COUNT(*) AS count FROM schema_migrations WHERE version = 1 GROUP BY version, name").Scan(&row).Error; err != nil {
		t.Fatal(err)
	}
	if row.Version != 1 || row.Name != "baseline" || row.Count != 1 {
		t.Fatalf("baseline migration row = %+v, want version=1 name=baseline count=1", row)
	}
}

func TestRunMigrationsAppliesPendingSQLInVersionOrder(t *testing.T) {
	database := openSQLiteTestDB(t)
	migrationFS := fstest.MapFS{
		"sqlite/000002_insert_marker.up.sql": {
			Data: []byte("INSERT INTO migration_marker (value) VALUES ('created-before-automigrate')"),
		},
		"sqlite/000001_create_marker.up.sql": {
			Data: []byte("CREATE TABLE migration_marker (value TEXT NOT NULL)"),
		},
	}

	if err := runMigrations(database, migrationFS); err != nil {
		t.Fatal(err)
	}

	if got := readMigrationMarker(t, database); got != "created-before-automigrate" {
		t.Fatalf("migration marker = %q, want created-before-automigrate", got)
	}
	var versions []uint64
	if err := database.Raw("SELECT version FROM schema_migrations ORDER BY version").Scan(&versions).Error; err != nil {
		t.Fatal(err)
	}
	if len(versions) != 2 || versions[0] != 1 || versions[1] != 2 {
		t.Fatalf("versions = %+v, want [1 2]", versions)
	}
}

func TestAutoMigrateCreatesIntegrityConstraints(t *testing.T) {
	database, err := Open(config.Config{
		DatabaseDriver: "sqlite",
		DatabaseURL:    filepath.Join(t.TempDir(), "mail.db"),
	})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := database.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()

	if err := AutoMigrate(database); err != nil {
		t.Fatal(err)
	}

	assertNotNullColumns(t, database, "users", "email", "password_hash", "nickname", "role")
	assertNotNullColumns(t, database, "pending_registrations", "verification_id", "token_hash", "email", "nickname", "password_hash", "code_hash", "expires_at")
	assertNotNullColumns(t, database, "oauth_identities", "user_id", "provider", "provider_uid")
	assertNotNullColumns(t, database, "oauth_provider_settings", "provider")
	assertNotNullColumns(t, database, "domains", "domain", "mode", "verification_token")
	assertNotNullColumns(t, database, "api_keys", "name", "key_prefix", "key_hash", "key_value")
	assertNotNullColumns(t, database, "messages", "recipient", "recipient_domain", "root_domain", "from_address", "subject", "expires_at")
	assertNotNullColumns(t, database, "message_attachments", "id", "message_id", "sequence", "size_bytes", "sha256")
	assertNotNullColumns(t, database, "message_daily_stats", "day", "message_count")
	assertNotNullColumns(t, database, "share_links", "owner_id", "token_hash", "token_prefix", "resource_type", "access_count")
	assertNotNullColumns(t, database, "share_link_access_logs", "share_link_id", "owner_id", "resource_type", "success", "ip", "user_agent")
	assertNotNullColumns(t, database, "mailboxes", "owner_id", "email", "local_part", "host", "domain_id")
	assertNotNullColumns(t, database, "domain_check_result_records", "run_id", "domain_id", "domain", "status", "mx_records_json", "probes_json")

	assertForeignKey(t, database, "domains", "owner_id", "users")
	assertForeignKey(t, database, "oauth_identities", "user_id", "users")
	assertForeignKey(t, database, "domains", "last_health_run_id", "domain_check_runs")
	assertForeignKey(t, database, "api_keys", "owner_id", "users")
	assertForeignKey(t, database, "session_tokens", "user_id", "users")
	assertForeignKey(t, database, "messages", "domain_id", "domains")
	assertForeignKey(t, database, "messages", "owner_id", "users")
	assertForeignKey(t, database, "messages", "mailbox_id", "mailboxes")
	assertForeignKey(t, database, "message_attachments", "message_id", "messages")
	assertForeignKey(t, database, "share_links", "owner_id", "users")
	assertForeignKey(t, database, "share_links", "message_id", "messages")
	assertForeignKey(t, database, "share_links", "mailbox_id", "mailboxes")
	assertForeignKey(t, database, "share_link_access_logs", "share_link_id", "share_links")
	assertForeignKey(t, database, "share_link_access_logs", "owner_id", "users")
	assertForeignKey(t, database, "mailboxes", "owner_id", "users")
	assertForeignKey(t, database, "mailboxes", "domain_id", "domains")
	assertForeignKey(t, database, "api_usage_logs", "api_key_id", "api_keys")
	assertForeignKey(t, database, "api_usage_logs", "user_id", "users")
	assertForeignKey(t, database, "notifications", "user_id", "users")
	assertForeignKey(t, database, "notifications", "domain_id", "domains")
	assertForeignKey(t, database, "domain_check_result_records", "run_id", "domain_check_runs")
	assertForeignKey(t, database, "domain_check_result_records", "domain_id", "domains")
	if got := columnDefault(t, database, "share_links", "resource_type"); got != models.ShareResourceTypeMailbox {
		t.Fatalf("share_links.resource_type default = %q, want %q", got, models.ShareResourceTypeMailbox)
	}
	assertIndex(t, database, "messages", "idx_messages_root_domain")
	assertIndex(t, database, "messages", "idx_messages_mailbox_created")
}

func TestAutoMigrateBackfillsMessageDailyStats(t *testing.T) {
	database := openSQLiteTestDB(t)
	if err := database.AutoMigrate(&models.Message{}); err != nil {
		t.Fatal(err)
	}
	today := time.Date(2026, 6, 8, 12, 0, 0, 0, time.Local)
	oldDay := today.AddDate(0, 0, -2)
	messages := []models.Message{
		legacyMessage("message-daily-1", "a@example.test", "example.test", "example.test"),
		legacyMessage("message-daily-2", "b@example.test", "example.test", "example.test"),
		legacyMessage("message-daily-3", "c@example.test", "example.test", "example.test"),
	}
	messages[0].CreatedAt = oldDay
	messages[1].CreatedAt = oldDay.Add(time.Hour)
	messages[2].CreatedAt = today
	if err := database.Create(&messages).Error; err != nil {
		t.Fatal(err)
	}

	if err := AutoMigrate(database); err != nil {
		t.Fatal(err)
	}

	var stats []models.MessageDailyStat
	if err := database.Order("day asc").Find(&stats).Error; err != nil {
		t.Fatal(err)
	}
	want := map[string]int64{
		oldDay.Local().Format("2006-01-02"): 2,
		today.Local().Format("2006-01-02"):  1,
	}
	if len(stats) != len(want) {
		t.Fatalf("message daily stats = %+v, want %d days", stats, len(want))
	}
	for _, stat := range stats {
		if stat.MessageCount != want[stat.Day] {
			t.Fatalf("message daily stat %s = %d, want %d", stat.Day, stat.MessageCount, want[stat.Day])
		}
	}
}

func TestIncrementMessageDailyStatAccumulates(t *testing.T) {
	database := openSQLiteTestDB(t)
	if err := database.AutoMigrate(&models.MessageDailyStat{}); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	if err := IncrementMessageDailyStat(database, now, 1); err != nil {
		t.Fatal(err)
	}
	if err := IncrementMessageDailyStat(database, now.Add(time.Hour), 2); err != nil {
		t.Fatal(err)
	}

	var stat models.MessageDailyStat
	if err := database.First(&stat, "day = ?", now.Local().Format("2006-01-02")).Error; err != nil {
		t.Fatal(err)
	}
	if stat.MessageCount != 3 {
		t.Fatalf("message daily stat = %d, want 3", stat.MessageCount)
	}
}

func TestMessageDailyStatUpsertQualifiesCountColumnForPostgres(t *testing.T) {
	database, err := gorm.Open(postgres.New(postgres.Config{
		DSN: "postgres://user:pass@127.0.0.1:5432/hloolmail?sslmode=disable",
	}), &gorm.Config{DryRun: true, DisableAutomaticPing: true})
	if err != nil {
		t.Fatal(err)
	}

	now := time.Date(2026, 6, 9, 12, 0, 0, 0, time.UTC)
	incrementSQL := database.ToSQL(func(tx *gorm.DB) *gorm.DB {
		return tx.Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "day"}},
			DoUpdates: clause.Assignments(map[string]interface{}{
				"message_count": messageDailyStatIncrementExpr(2),
				"updated_at":    now,
			}),
		}).Create(&models.MessageDailyStat{
			Day:          "2026-06-09",
			MessageCount: 2,
			CreatedAt:    now,
			UpdatedAt:    now,
		})
	})
	if !strings.Contains(incrementSQL, `"message_count"="message_daily_stats"."message_count" + `) {
		t.Fatalf("increment upsert SQL did not qualify message_count: %s", incrementSQL)
	}

	backfillSQL := database.ToSQL(func(tx *gorm.DB) *gorm.DB {
		return tx.Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "day"}},
			DoUpdates: clause.Assignments(map[string]interface{}{
				"message_count": messageDailyStatMaxExpr(69),
				"updated_at":    now,
			}),
		}).Create(&models.MessageDailyStat{
			Day:          "2026-06-09",
			MessageCount: 69,
			CreatedAt:    now,
			UpdatedAt:    now,
		})
	})
	if !strings.Contains(backfillSQL, `CASE WHEN "message_daily_stats"."message_count" < `) ||
		!strings.Contains(backfillSQL, `ELSE "message_daily_stats"."message_count" END`) {
		t.Fatalf("backfill upsert SQL did not qualify message_count: %s", backfillSQL)
	}
}

func TestAutoMigrateUpgradesLegacyShareLinksForMailboxShares(t *testing.T) {
	database, err := Open(config.Config{
		DatabaseDriver: "sqlite",
		DatabaseURL:    filepath.Join(t.TempDir(), "mail.db"),
	})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := database.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()

	if err := database.AutoMigrate(&legacyShareLink{}); err != nil {
		t.Fatal(err)
	}
	if nullable := columnNullable(t, database, "share_links", "message_id"); nullable {
		t.Fatal("legacy message_id should start as NOT NULL")
	}

	if err := AutoMigrate(database); err != nil {
		t.Fatal(err)
	}
	if nullable := columnNullable(t, database, "share_links", "message_id"); !nullable {
		t.Fatal("message_id should be nullable after mailbox share migration")
	}
	if !database.Migrator().HasColumn(&models.ShareLink{}, "MailboxID") {
		t.Fatal("mailbox_id column was not created")
	}
	if !database.Migrator().HasColumn(&models.ShareLink{}, "AccessKeyHash") {
		t.Fatal("access_key_hash column was not created")
	}
	if got := columnDefault(t, database, "share_links", "resource_type"); got != models.ShareResourceTypeMailbox {
		t.Fatalf("resource_type default = %q, want %q", got, models.ShareResourceTypeMailbox)
	}
}

func TestBackfillMailboxCountersUsesExistingMailboxes(t *testing.T) {
	database, err := Open(config.Config{
		DatabaseDriver: "sqlite",
		DatabaseURL:    filepath.Join(t.TempDir(), "mail.db"),
	})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := database.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()

	if err := AutoMigrate(database); err != nil {
		t.Fatal(err)
	}
	user := models.User{
		Email:        "owner@example.com",
		PasswordHash: "hash",
		Role:         models.UserRoleUser,
		Enabled:      true,
	}
	if err := database.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	publicDomain := models.Domain{
		Domain:            "public.test",
		Mode:              models.DomainModePublic,
		Active:            true,
		MXVerified:        true,
		VerificationToken: "public-token",
	}
	privateDomain := models.Domain{
		Domain:            "private.test",
		Mode:              models.DomainModePrivate,
		OwnerID:           &user.ID,
		Active:            true,
		MXVerified:        true,
		VerificationToken: "private-token",
	}
	if err := database.Create(&publicDomain).Error; err != nil {
		t.Fatal(err)
	}
	if err := database.Create(&privateDomain).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	old := now.AddDate(0, 0, -1)
	mailboxes := []models.Mailbox{
		{OwnerID: user.ID, Email: "today@public.test", LocalPart: "today", Host: "public.test", DomainID: publicDomain.ID, CreatedAt: now},
		{OwnerID: user.ID, Email: "old@public.test", LocalPart: "old", Host: "public.test", DomainID: publicDomain.ID, CreatedAt: old},
		{OwnerID: user.ID, Email: "mine@private.test", LocalPart: "mine", Host: "private.test", DomainID: privateDomain.ID, CreatedAt: now},
	}
	if err := database.Create(&mailboxes).Error; err != nil {
		t.Fatal(err)
	}

	if err := BackfillMailboxCounters(database); err != nil {
		t.Fatal(err)
	}
	var refreshedUser models.User
	if err := database.First(&refreshedUser, user.ID).Error; err != nil {
		t.Fatal(err)
	}
	if refreshedUser.PublicMailboxCreated != 2 || refreshedUser.PrivateMailboxCreated != 1 {
		t.Fatalf("user counters public/private = %d/%d, want 2/1", refreshedUser.PublicMailboxCreated, refreshedUser.PrivateMailboxCreated)
	}
	if refreshedUser.PublicMailboxDate != now.Format("2006-01-02") || refreshedUser.PublicMailboxToday != 1 {
		t.Fatalf("today counter date/count = %q/%d, want today/1", refreshedUser.PublicMailboxDate, refreshedUser.PublicMailboxToday)
	}
	var refreshedPublic models.Domain
	if err := database.First(&refreshedPublic, publicDomain.ID).Error; err != nil {
		t.Fatal(err)
	}
	if refreshedPublic.MailboxCreatedCount != 2 {
		t.Fatalf("public domain mailbox_created_count = %d, want 2", refreshedPublic.MailboxCreatedCount)
	}
}

func TestAutoMigrateBackfillsExistingUsersEmailVerified(t *testing.T) {
	database := openSQLiteTestDB(t)
	if err := database.AutoMigrate(&models.User{}); err != nil {
		t.Fatal(err)
	}
	user := models.User{
		Email:         "legacy-admin@example.test",
		PasswordHash:  "hash",
		EmailVerified: false,
		Role:          models.UserRoleAdmin,
		Enabled:       true,
	}
	if err := database.Create(&user).Error; err != nil {
		t.Fatal(err)
	}

	if err := AutoMigrate(database); err != nil {
		t.Fatal(err)
	}

	var reloaded models.User
	if err := database.First(&reloaded, user.ID).Error; err != nil {
		t.Fatal(err)
	}
	if !reloaded.EmailVerified {
		t.Fatal("legacy user email_verified was not backfilled")
	}
}

func TestBackfillUserNicknameDefaults(t *testing.T) {
	database := openSQLiteTestDB(t)
	if err := database.Exec("CREATE TABLE users (id integer primary key, nickname text NULL)").Error; err != nil {
		t.Fatal(err)
	}
	if err := database.Exec("CREATE TABLE pending_registrations (verification_id text primary key, nickname text NULL)").Error; err != nil {
		t.Fatal(err)
	}
	if err := database.Exec("INSERT INTO users (id, nickname) VALUES (1, NULL)").Error; err != nil {
		t.Fatal(err)
	}
	if err := database.Exec("INSERT INTO pending_registrations (verification_id, nickname) VALUES ('pending-1', NULL)").Error; err != nil {
		t.Fatal(err)
	}

	if err := BackfillUserNicknameDefaults(database); err != nil {
		t.Fatal(err)
	}

	var userNickname string
	if err := database.Raw("SELECT nickname FROM users WHERE id = 1").Scan(&userNickname).Error; err != nil {
		t.Fatal(err)
	}
	if userNickname != "" {
		t.Fatalf("users.nickname = %q, want empty string", userNickname)
	}
	var pendingNickname string
	if err := database.Raw("SELECT nickname FROM pending_registrations WHERE verification_id = 'pending-1'").Scan(&pendingNickname).Error; err != nil {
		t.Fatal(err)
	}
	if pendingNickname != "" {
		t.Fatalf("pending_registrations.nickname = %q, want empty string", pendingNickname)
	}
}

func TestAutoMigrateDoesNotBackfillPendingUnverifiedUsersOnRestart(t *testing.T) {
	database := openSQLiteTestDB(t)
	if err := AutoMigrate(database); err != nil {
		t.Fatal(err)
	}
	user := models.User{
		Email:         "pending-user@example.test",
		PasswordHash:  "hash",
		EmailVerified: false,
		Role:          models.UserRoleUser,
		Enabled:       true,
	}
	if err := database.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	pending := models.PendingRegistration{
		VerificationID: "pending-verification-id",
		TokenHash:      "token-hash",
		Email:          user.Email,
		PasswordHash:   "hash",
		CodeHash:       "code-hash",
		ExpiresAt:      time.Now().Add(time.Hour),
		LastSentAt:     time.Now(),
		IP:             "127.0.0.1",
		UserAgent:      "db-test",
	}
	if err := database.Create(&pending).Error; err != nil {
		t.Fatal(err)
	}

	if err := AutoMigrate(database); err != nil {
		t.Fatal(err)
	}

	var reloaded models.User
	if err := database.First(&reloaded, user.ID).Error; err != nil {
		t.Fatal(err)
	}
	if reloaded.EmailVerified {
		t.Fatal("pending unverified user was incorrectly marked verified on restart")
	}
}

func TestAutoMigrateBackfillsLegacyUserWithoutPendingAfterBrokenVersion(t *testing.T) {
	database := openSQLiteTestDB(t)
	if err := AutoMigrate(database); err != nil {
		t.Fatal(err)
	}
	user := models.User{
		Email:         "broken-version-legacy@example.test",
		PasswordHash:  "hash",
		EmailVerified: false,
		Role:          models.UserRoleUser,
		Enabled:       true,
	}
	if err := database.Create(&user).Error; err != nil {
		t.Fatal(err)
	}

	if err := AutoMigrate(database); err != nil {
		t.Fatal(err)
	}

	var reloaded models.User
	if err := database.First(&reloaded, user.ID).Error; err != nil {
		t.Fatal(err)
	}
	if !reloaded.EmailVerified {
		t.Fatal("legacy user without pending registration was not recovered after broken migration")
	}
}

func TestAutoMigrateBackfillsMessageOwnershipFromMailbox(t *testing.T) {
	database := openSQLiteTestDB(t)
	if err := database.AutoMigrate(&models.User{}, &models.Domain{}, &models.Mailbox{}, &models.Message{}); err != nil {
		t.Fatal(err)
	}
	owner := models.User{Email: "mailbox-owner@example.test", PasswordHash: "hash", Role: models.UserRoleUser, Enabled: true}
	if err := database.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	domain := models.Domain{
		Domain:            "mailbox.test",
		Mode:              models.DomainModePublic,
		Active:            true,
		MXVerified:        true,
		VerificationToken: "mailbox-token",
	}
	if err := database.Create(&domain).Error; err != nil {
		t.Fatal(err)
	}
	mailbox := models.Mailbox{
		OwnerID:   owner.ID,
		Email:     "legacy@mailbox.test",
		LocalPart: "legacy",
		Host:      "mailbox.test",
		DomainID:  domain.ID,
	}
	if err := database.Create(&mailbox).Error; err != nil {
		t.Fatal(err)
	}
	message := legacyMessage("mailbox-message", "legacy@mailbox.test", "mailbox.test", "mailbox.test")
	if err := database.Create(&message).Error; err != nil {
		t.Fatal(err)
	}

	if err := AutoMigrate(database); err != nil {
		t.Fatal(err)
	}

	var reloaded models.Message
	if err := database.First(&reloaded, "id = ?", message.ID).Error; err != nil {
		t.Fatal(err)
	}
	assertUintPtr(t, reloaded.OwnerID, owner.ID, "owner_id")
	assertUintPtr(t, reloaded.MailboxID, mailbox.ID, "mailbox_id")
	assertUintPtr(t, reloaded.DomainID, domain.ID, "domain_id")
}

func TestAutoMigrateBackfillsMessageOwnershipFromPrivateDomain(t *testing.T) {
	database := openSQLiteTestDB(t)
	if err := database.AutoMigrate(&models.User{}, &models.Domain{}, &models.Message{}); err != nil {
		t.Fatal(err)
	}
	owner := models.User{Email: "private-owner@example.test", PasswordHash: "hash", Role: models.UserRoleUser, Enabled: true}
	if err := database.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	domain := models.Domain{
		Domain:            "private.test",
		Mode:              models.DomainModePrivate,
		OwnerID:           &owner.ID,
		Active:            true,
		MXVerified:        true,
		VerificationToken: "private-token",
	}
	if err := database.Create(&domain).Error; err != nil {
		t.Fatal(err)
	}
	message := legacyMessage("private-domain-message", "anything@private.test", "private.test", "private.test")
	if err := database.Create(&message).Error; err != nil {
		t.Fatal(err)
	}

	if err := AutoMigrate(database); err != nil {
		t.Fatal(err)
	}

	var reloaded models.Message
	if err := database.First(&reloaded, "id = ?", message.ID).Error; err != nil {
		t.Fatal(err)
	}
	assertUintPtr(t, reloaded.OwnerID, owner.ID, "owner_id")
	assertUintPtr(t, reloaded.DomainID, domain.ID, "domain_id")
	if reloaded.MailboxID != nil {
		t.Fatalf("mailbox_id = %d, want nil", *reloaded.MailboxID)
	}
}

func TestBackfillMessagePrivateDomainOwnershipRejectsUnexpectedColumn(t *testing.T) {
	database := openSQLiteTestDB(t)
	if err := backfillMessagePrivateDomainOwnership(database, "recipient_domain; DROP TABLE messages"); err == nil {
		t.Fatal("expected unexpected message domain column to be rejected")
	}
}

func TestAutoMigrateKeepsPublicDomainOrphanMessageUnowned(t *testing.T) {
	database := openSQLiteTestDB(t)
	if err := database.AutoMigrate(&models.User{}, &models.Domain{}, &models.Message{}); err != nil {
		t.Fatal(err)
	}
	owner := models.User{Email: "public-owner@example.test", PasswordHash: "hash", Role: models.UserRoleUser, Enabled: true}
	if err := database.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	domain := models.Domain{
		Domain:            "public.test",
		Mode:              models.DomainModePublic,
		OwnerID:           &owner.ID,
		Active:            true,
		MXVerified:        true,
		VerificationToken: "public-token",
	}
	if err := database.Create(&domain).Error; err != nil {
		t.Fatal(err)
	}
	message := legacyMessage("public-domain-message", "orphan@public.test", "public.test", "public.test")
	if err := database.Create(&message).Error; err != nil {
		t.Fatal(err)
	}

	if err := AutoMigrate(database); err != nil {
		t.Fatal(err)
	}

	var reloaded models.Message
	if err := database.First(&reloaded, "id = ?", message.ID).Error; err != nil {
		t.Fatal(err)
	}
	if reloaded.OwnerID != nil || reloaded.MailboxID != nil || reloaded.DomainID != nil {
		t.Fatalf("public orphan got ownership owner=%v mailbox=%v domain=%v", reloaded.OwnerID, reloaded.MailboxID, reloaded.DomainID)
	}
}

type legacyShareLink struct {
	ID           uint   `gorm:"primaryKey"`
	OwnerID      uint   `gorm:"index;not null"`
	TokenHash    string `gorm:"type:text;not null"`
	TokenPrefix  string `gorm:"index;size:32;not null"`
	ResourceType string `gorm:"size:40;index;not null;default:message"`
	MessageID    string `gorm:"size:36;index;not null"`
	AccessCount  int64  `gorm:"not null;default:0"`
}

func (legacyShareLink) TableName() string {
	return "share_links"
}

func openSQLiteTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	database, err := Open(config.Config{
		DatabaseDriver: "sqlite",
		DatabaseURL:    filepath.Join(t.TempDir(), "mail.db"),
	})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := database.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := sqlDB.Close(); err != nil {
			t.Fatal(err)
		}
	})
	return database
}

func legacyMessage(id, recipient, recipientDomain, rootDomain string) models.Message {
	return models.Message{
		ID:              id,
		Recipient:       recipient,
		RecipientLocal:  strings.SplitN(recipient, "@", 2)[0],
		RecipientDomain: recipientDomain,
		RootDomain:      rootDomain,
		FromAddress:     "sender@example.test",
		Subject:         "legacy message",
		ExpiresAt:       time.Now().Add(24 * time.Hour),
	}
}

func assertUintPtr(t *testing.T, got *uint, want uint, name string) {
	t.Helper()
	if got == nil || *got != want {
		t.Fatalf("%s = %v, want %d", name, got, want)
	}
}

func columnNullable(t *testing.T, database *gorm.DB, table, column string) bool {
	t.Helper()
	columns, err := database.Migrator().ColumnTypes(table)
	if err != nil {
		t.Fatal(err)
	}
	for _, candidate := range columns {
		if strings.EqualFold(candidate.Name(), column) {
			nullable, ok := candidate.Nullable()
			if !ok {
				t.Fatalf("nullable metadata unavailable for %s.%s", table, column)
			}
			return nullable
		}
	}
	t.Fatalf("column %s.%s not found", table, column)
	return false
}

func columnDefault(t *testing.T, database *gorm.DB, table, column string) string {
	t.Helper()
	columns, err := database.Migrator().ColumnTypes(table)
	if err != nil {
		t.Fatal(err)
	}
	for _, candidate := range columns {
		if strings.EqualFold(candidate.Name(), column) {
			value, ok := candidate.DefaultValue()
			if !ok {
				return ""
			}
			return strings.Trim(value, "'\"")
		}
	}
	t.Fatalf("column %s.%s not found", table, column)
	return ""
}

func TestBackfillDomainFirstVerifiedAtProtectsOnlyCurrentlyReadyDomains(t *testing.T) {
	database, err := Open(config.Config{
		DatabaseDriver: "sqlite",
		DatabaseURL:    filepath.Join(t.TempDir(), "mail.db"),
	})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := database.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()

	if err := AutoMigrate(database); err != nil {
		t.Fatal(err)
	}
	lastHealthyAt := time.Now().Add(-time.Hour).UTC()
	ready := models.Domain{
		Domain:            "ready-backfill.test",
		Mode:              models.DomainModePrivate,
		Active:            true,
		MXVerified:        true,
		VerificationToken: "ready-token",
		LastHealthyAt:     &lastHealthyAt,
	}
	unhealthy := models.Domain{
		Domain:            "unhealthy-backfill.test",
		Mode:              models.DomainModePrivate,
		Active:            true,
		MXVerified:        false,
		VerificationToken: "unhealthy-token",
		CreatedAt:         time.Now().Add(-30 * 24 * time.Hour),
	}
	if err := database.Create(&[]models.Domain{ready, unhealthy}).Error; err != nil {
		t.Fatal(err)
	}

	if err := BackfillDomainFirstVerifiedAt(database); err != nil {
		t.Fatal(err)
	}

	var reloadedReady models.Domain
	if err := database.First(&reloadedReady, "domain = ?", ready.Domain).Error; err != nil {
		t.Fatal(err)
	}
	if reloadedReady.FirstVerifiedAt == nil || !reloadedReady.FirstVerifiedAt.Equal(lastHealthyAt) {
		t.Fatalf("first_verified_at = %v, want %v", reloadedReady.FirstVerifiedAt, lastHealthyAt)
	}
	if reloadedReady.PendingDeleteAt != nil {
		t.Fatalf("pending_delete_at should remain nil, got %v", reloadedReady.PendingDeleteAt)
	}
	var reloadedUnhealthy models.Domain
	if err := database.First(&reloadedUnhealthy, "domain = ?", unhealthy.Domain).Error; err != nil {
		t.Fatal(err)
	}
	if reloadedUnhealthy.FirstVerifiedAt != nil || reloadedUnhealthy.PendingDeleteAt != nil {
		t.Fatalf("unhealthy legacy domain should stay conservative, first=%v pending=%v", reloadedUnhealthy.FirstVerifiedAt, reloadedUnhealthy.PendingDeleteAt)
	}
}

type tableColumn struct {
	Name    string
	NotNull int `gorm:"column:notnull"`
}

func withTempWorkdir(t *testing.T) {
	t.Helper()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	temp := t.TempDir()
	if err := os.Chdir(temp); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(wd); err != nil {
			t.Fatalf("restore working directory: %v", err)
		}
	})
}

func openSQLiteMarkerDB(t *testing.T, path, value string) *gorm.DB {
	t.Helper()
	database, err := Open(config.Config{DatabaseDriver: "sqlite", DatabaseURL: path})
	if err != nil {
		t.Fatal(err)
	}
	if err := database.Exec("CREATE TABLE marker (value text NOT NULL)").Error; err != nil {
		closeGormDB(t, database)
		t.Fatal(err)
	}
	if err := database.Exec("INSERT INTO marker (value) VALUES (?)", value).Error; err != nil {
		closeGormDB(t, database)
		t.Fatal(err)
	}
	return database
}

func readSQLiteMarker(t *testing.T, database *gorm.DB) string {
	t.Helper()
	var got string
	if err := database.Raw("SELECT value FROM marker LIMIT 1").Scan(&got).Error; err != nil {
		t.Fatal(err)
	}
	return got
}

func readMigrationMarker(t *testing.T, database *gorm.DB) string {
	t.Helper()
	var got string
	if err := database.Raw("SELECT value FROM migration_marker LIMIT 1").Scan(&got).Error; err != nil {
		t.Fatal(err)
	}
	return got
}

func closeGormDB(t *testing.T, database *gorm.DB) {
	t.Helper()
	sqlDB, err := database.DB()
	if err != nil {
		t.Fatal(err)
	}
	if err := sqlDB.Close(); err != nil {
		t.Fatal(err)
	}
}

func assertNotNullColumns(t *testing.T, database *gorm.DB, table string, names ...string) {
	t.Helper()
	var columns []tableColumn
	if err := database.Raw("PRAGMA table_info(" + table + ")").Scan(&columns).Error; err != nil {
		t.Fatal(err)
	}
	byName := make(map[string]tableColumn, len(columns))
	for _, column := range columns {
		byName[column.Name] = column
	}
	for _, name := range names {
		column, ok := byName[name]
		if !ok {
			t.Fatalf("%s.%s column not found", table, name)
		}
		if column.NotNull != 1 {
			t.Fatalf("%s.%s notnull = %d, want 1", table, name, column.NotNull)
		}
	}
}

type foreignKeyColumn struct {
	Table string `gorm:"column:table"`
	From  string `gorm:"column:from"`
}

func assertForeignKey(t *testing.T, database *gorm.DB, table string, from string, targetTable string) {
	t.Helper()
	var keys []foreignKeyColumn
	if err := database.Raw("PRAGMA foreign_key_list(" + table + ")").Scan(&keys).Error; err != nil {
		t.Fatal(err)
	}
	for _, key := range keys {
		if key.From == from && key.Table == targetTable {
			return
		}
	}
	t.Fatalf("%s.%s foreign key to %s not found: %+v", table, from, targetTable, keys)
}

func assertIndex(t *testing.T, database *gorm.DB, table, index string) {
	t.Helper()
	if !database.Migrator().HasIndex(table, index) {
		t.Fatalf("%s index %s not found", table, index)
	}
}
