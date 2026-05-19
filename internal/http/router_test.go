package httpapi

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/gin-gonic/gin"
)

func TestMountFrontendFallsBackToEmbeddedAssets(t *testing.T) {
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	embedded := fstest.MapFS{
		"index.html":    &fstest.MapFile{Data: []byte("embedded index")},
		"assets":        &fstest.MapFile{Mode: fs.ModeDir},
		"assets/app.js": &fstest.MapFile{Data: []byte("console.log('embedded')")},
	}
	mountFrontend(router, filepath.Join(t.TempDir(), "missing"), embedded, true)

	assertFrontendResponse(t, router, "/", http.StatusOK, "embedded index")
	assertFrontendResponse(t, router, "/settings", http.StatusOK, "embedded index")
	assertFrontendResponse(t, router, "/assets/app.js", http.StatusOK, "console.log('embedded')")
	assertFrontendResponse(t, router, "/api/missing", http.StatusNotFound, "api route not found")
}

func TestMountFrontendExternalDirOverridesEmbeddedAssets(t *testing.T) {
	gin.SetMode(gin.ReleaseMode)
	dist := t.TempDir()
	if err := os.WriteFile(filepath.Join(dist, "index.html"), []byte("external index"), 0o644); err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	embedded := fstest.MapFS{
		"index.html": &fstest.MapFile{Data: []byte("embedded index")},
	}
	mountFrontend(router, dist, embedded, true)

	assertFrontendResponse(t, router, "/", http.StatusOK, "external index")
	assertFrontendResponse(t, router, "/settings", http.StatusOK, "external index")
}

func assertFrontendResponse(t *testing.T, router http.Handler, target string, wantStatus int, wantBody string) {
	t.Helper()
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, target, nil)
	router.ServeHTTP(recorder, request)
	if recorder.Code != wantStatus {
		t.Fatalf("%s status = %d, want %d; body: %s", target, recorder.Code, wantStatus, recorder.Body.String())
	}
	if !strings.Contains(recorder.Body.String(), wantBody) {
		t.Fatalf("%s body = %q, want to contain %q", target, recorder.Body.String(), wantBody)
	}
}
