package migrations

import "embed"

// FS contains SQL migrations grouped by GORM dialect name.
//
//go:embed sqlite/*.sql postgres/*.sql
var FS embed.FS
