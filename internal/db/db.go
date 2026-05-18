package db

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gptmail/internal/config"
	"gptmail/internal/models"

	"github.com/glebarez/sqlite"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
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
	return db.AutoMigrate(
		&models.User{},
		&models.OAuthIdentity{},
		&models.OAuthProviderSetting{},
		&models.DomainCheckSettings{},
		&models.DomainCheckRun{},
		&models.Domain{},
		&models.APIKey{},
		&models.SessionToken{},
		&models.Mailbox{},
		&models.Message{},
		&models.APIUsageLog{},
		&models.Notification{},
		&models.DomainCheckResultRecord{},
		&models.AuditLog{},
	)
}
