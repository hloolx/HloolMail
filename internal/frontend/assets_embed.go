//go:build embed_frontend

package frontend

import (
	"embed"
	"io/fs"
)

//go:embed dist
var embedded embed.FS

func Embedded() (fs.FS, bool) {
	dist, err := fs.Sub(embedded, "dist")
	if err != nil {
		return nil, false
	}
	return dist, true
}
