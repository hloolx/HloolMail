package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"gptmail/internal/config"
)

func TestSEOFilesUseConfiguredPublicBaseURL(t *testing.T) {
	router := NewRouter(&Handler{
		Config: config.Config{
			DevMode:       true,
			PublicBaseURL: "https://mail.example.com/base/",
			FrontendDist:  t.TempDir(),
		},
	})

	robots := httptest.NewRecorder()
	router.ServeHTTP(robots, httptest.NewRequest(http.MethodGet, "/robots.txt", nil))
	if robots.Code != http.StatusOK {
		t.Fatalf("robots status = %d, want %d; body: %s", robots.Code, http.StatusOK, robots.Body.String())
	}
	for _, want := range []string{
		"User-agent: *",
		"Disallow: /api/auth",
		"Disallow: /share/",
		"Sitemap: https://mail.example.com/base/sitemap.xml",
	} {
		if !strings.Contains(robots.Body.String(), want) {
			t.Fatalf("robots.txt missing %q in:\n%s", want, robots.Body.String())
		}
	}

	sitemap := httptest.NewRecorder()
	router.ServeHTTP(sitemap, httptest.NewRequest(http.MethodGet, "/sitemap.xml", nil))
	if sitemap.Code != http.StatusOK {
		t.Fatalf("sitemap status = %d, want %d; body: %s", sitemap.Code, http.StatusOK, sitemap.Body.String())
	}
	for _, want := range []string{
		`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
		"<loc>https://mail.example.com/base/</loc>",
		"<loc>https://mail.example.com/base/api/docs.md</loc>",
	} {
		if !strings.Contains(sitemap.Body.String(), want) {
			t.Fatalf("sitemap.xml missing %q in:\n%s", want, sitemap.Body.String())
		}
	}
	for _, forbidden := range []string{
		"<loc>https://mail.example.com/base/terms</loc>",
		"<loc>https://mail.example.com/base/privacy</loc>",
	} {
		if strings.Contains(sitemap.Body.String(), forbidden) {
			t.Fatalf("sitemap.xml should not include %q before those routes have standalone HTML:\n%s", forbidden, sitemap.Body.String())
		}
	}
}

func TestSEOFilesFallbackToRequestOrigin(t *testing.T) {
	router := NewRouter(&Handler{
		Config: config.Config{
			DevMode:      true,
			FrontendDist: t.TempDir(),
		},
	})

	request := httptest.NewRequest(http.MethodGet, "/sitemap.xml", nil)
	request.Host = "request.example.test"
	request.Header.Set("X-Forwarded-Proto", "https")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("sitemap status = %d, want %d; body: %s", response.Code, http.StatusOK, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "<loc>https://request.example.test/</loc>") {
		t.Fatalf("sitemap.xml did not use request origin:\n%s", response.Body.String())
	}
}
