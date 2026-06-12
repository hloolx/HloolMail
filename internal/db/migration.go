package db

import (
	"errors"
	"fmt"
	"io/fs"
	"path"
	"sort"
	"strconv"
	"strings"

	migrationFiles "gptmail/internal/db/migrations"

	"gorm.io/gorm"
)

type migration struct {
	Version uint64
	Name    string
	Path    string
	SQL     string
}

// RunMigrations applies versioned SQL migrations before GORM AutoMigrate fills
// any remaining schema gaps during the transition period.
func RunMigrations(db *gorm.DB) error {
	return runMigrations(db, migrationFiles.FS)
}

func runMigrations(db *gorm.DB, migrationFS fs.FS) error {
	dialect := migrationDialect(db)
	migrations, err := readMigrations(migrationFS, dialect)
	if err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		if dialect == "postgres" {
			if err := tx.Exec("SELECT pg_advisory_xact_lock(hashtext('hloolmail_schema_migrations'))").Error; err != nil {
				return fmt.Errorf("lock schema migrations: %w", err)
			}
		}
		if err := ensureSchemaMigrations(tx, dialect); err != nil {
			return err
		}
		applied, err := appliedMigrationVersions(tx)
		if err != nil {
			return err
		}
		for _, migration := range migrations {
			if applied[migration.Version] {
				continue
			}
			if sql := strings.TrimSpace(migration.SQL); sql != "" {
				if err := tx.Exec(sql).Error; err != nil {
					return fmt.Errorf("apply migration %s: %w", migration.Path, err)
				}
			}
			if err := tx.Exec(
				"INSERT INTO schema_migrations (version, name) VALUES (?, ?)",
				migration.Version,
				migration.Name,
			).Error; err != nil {
				return fmt.Errorf("record migration %s: %w", migration.Path, err)
			}
		}
		return nil
	})
}

func migrationDialect(db *gorm.DB) string {
	switch strings.ToLower(db.Dialector.Name()) {
	case "postgres", "postgresql":
		return "postgres"
	case "sqlite", "sqlite3":
		return "sqlite"
	default:
		return strings.ToLower(db.Dialector.Name())
	}
}

func readMigrations(migrationFS fs.FS, dialect string) ([]migration, error) {
	entries, err := fs.ReadDir(migrationFS, dialect)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, fmt.Errorf("no migrations for database dialect %q", dialect)
	}
	if err != nil {
		return nil, err
	}

	migrations := make([]migration, 0, len(entries))
	versions := map[uint64]string{}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		fileName := entry.Name()
		if !strings.HasSuffix(fileName, ".up.sql") {
			continue
		}
		versionText, rest, ok := strings.Cut(fileName, "_")
		if !ok {
			return nil, fmt.Errorf("migration %q must be named NNN_name.up.sql", fileName)
		}
		version, err := strconv.ParseUint(versionText, 10, 64)
		if err != nil || version == 0 {
			return nil, fmt.Errorf("migration %q has invalid version %q", fileName, versionText)
		}
		if previous := versions[version]; previous != "" {
			return nil, fmt.Errorf("duplicate migration version %d: %s and %s", version, previous, fileName)
		}
		migrationPath := path.Join(dialect, fileName)
		content, err := fs.ReadFile(migrationFS, migrationPath)
		if err != nil {
			return nil, err
		}
		name := strings.TrimSuffix(rest, ".up.sql")
		versions[version] = fileName
		migrations = append(migrations, migration{
			Version: version,
			Name:    name,
			Path:    migrationPath,
			SQL:     string(content),
		})
	}
	sort.Slice(migrations, func(i, j int) bool {
		return migrations[i].Version < migrations[j].Version
	})
	return migrations, nil
}

func ensureSchemaMigrations(db *gorm.DB, dialect string) error {
	var sql string
	switch dialect {
	case "postgres":
		sql = `
CREATE TABLE IF NOT EXISTS schema_migrations (
	version BIGINT PRIMARY KEY,
	name TEXT NOT NULL,
	applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`
	case "sqlite":
		sql = `
CREATE TABLE IF NOT EXISTS schema_migrations (
	version INTEGER PRIMARY KEY,
	name TEXT NOT NULL,
	applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
)`
	default:
		return fmt.Errorf("unsupported database dialect %q", dialect)
	}
	if err := db.Exec(sql).Error; err != nil {
		return fmt.Errorf("ensure schema_migrations: %w", err)
	}
	return nil
}

func appliedMigrationVersions(db *gorm.DB) (map[uint64]bool, error) {
	rows, err := db.Raw("SELECT version FROM schema_migrations").Rows()
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	applied := map[uint64]bool{}
	for rows.Next() {
		var version uint64
		if err := rows.Scan(&version); err != nil {
			return nil, err
		}
		applied[version] = true
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return applied, nil
}
