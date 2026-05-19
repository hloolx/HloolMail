//go:build !embed_frontend

package frontend

import "io/fs"

func Embedded() (fs.FS, bool) {
	return nil, false
}
