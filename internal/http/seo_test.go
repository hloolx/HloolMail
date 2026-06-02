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
			DevMode:        true,
			PublicBaseURL:  "https://mail.example.com/base/",
			PublicIndexing: config.PublicIndexingDocs,
			FrontendDist:   t.TempDir(),
		},
	})

	robots := httptest.NewRecorder()
	router.ServeHTTP(robots, httptest.NewRequest(http.MethodGet, "/robots.txt", nil))
	if robots.Code != http.StatusOK {
		t.Fatalf("robots status = %d, want %d; body: %s", robots.Code, http.StatusOK, robots.Body.String())
	}
	for _, want := range []string{
		"User-agent: *",
		"Disallow: /api/",
		"Allow: /api/health",
		"Allow: /api/version",
		"Allow: /api/docs.md",
		"Allow: /api/skill.md",
		"Allow: /api/openapi.json",
		"Allow: /api/openapi.yaml",
		"Disallow: /api/version/check",
		"Disallow: /share/",
		"Disallow: /*?key=",
		"Disallow: /*?api_key=",
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
		"<loc>https://mail.example.com/base/api/skill.md</loc>",
		"<loc>https://mail.example.com/base/api/openapi.json</loc>",
		"<loc>https://mail.example.com/base/api/openapi.yaml</loc>",
		"<loc>https://mail.example.com/base/api/version</loc>",
		"<loc>https://mail.example.com/base/api/health</loc>",
	} {
		if !strings.Contains(sitemap.Body.String(), want) {
			t.Fatalf("sitemap.xml missing %q in:\n%s", want, sitemap.Body.String())
		}
	}
	for _, forbidden := range []string{
		"<loc>https://mail.example.com/base/terms</loc>",
		"<loc>https://mail.example.com/base/privacy</loc>",
		"<loc>https://mail.example.com/base/api/version/check</loc>",
	} {
		if strings.Contains(sitemap.Body.String(), forbidden) {
			t.Fatalf("sitemap.xml should not include %q before those routes have standalone HTML:\n%s", forbidden, sitemap.Body.String())
		}
	}
}

func TestSEOFilesDefaultLandingIndexing(t *testing.T) {
	router := NewRouter(&Handler{
		Config: config.Config{
			DevMode:       true,
			PublicBaseURL: "https://mail.example.com",
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
		"Disallow: /api/",
		"Disallow: /share/",
		"Disallow: /dashboard",
		"Sitemap: https://mail.example.com/sitemap.xml",
	} {
		if !strings.Contains(robots.Body.String(), want) {
			t.Fatalf("robots.txt missing %q in:\n%s", want, robots.Body.String())
		}
	}
	for _, forbidden := range []string{
		"Allow: /api/docs.md",
		"Allow: /api/health",
	} {
		if strings.Contains(robots.Body.String(), forbidden) {
			t.Fatalf("robots.txt should not include %q in landing mode:\n%s", forbidden, robots.Body.String())
		}
	}

	sitemap := httptest.NewRecorder()
	router.ServeHTTP(sitemap, httptest.NewRequest(http.MethodGet, "/sitemap.xml", nil))
	if sitemap.Code != http.StatusOK {
		t.Fatalf("sitemap status = %d, want %d; body: %s", sitemap.Code, http.StatusOK, sitemap.Body.String())
	}
	if !strings.Contains(sitemap.Body.String(), "<loc>https://mail.example.com/</loc>") {
		t.Fatalf("sitemap.xml missing landing page:\n%s", sitemap.Body.String())
	}
	for _, forbidden := range []string{
		"<loc>https://mail.example.com/api/docs.md</loc>",
		"<loc>https://mail.example.com/api/openapi.json</loc>",
		"<loc>https://mail.example.com/api/version</loc>",
		"<loc>https://mail.example.com/api/health</loc>",
	} {
		if strings.Contains(sitemap.Body.String(), forbidden) {
			t.Fatalf("sitemap.xml should not include %q in landing mode:\n%s", forbidden, sitemap.Body.String())
		}
	}
}

func TestSEOFilesPublicIndexingNone(t *testing.T) {
	router := NewRouter(&Handler{
		Config: config.Config{
			DevMode:        true,
			PublicBaseURL:  "https://mail.example.com",
			PublicIndexing: config.PublicIndexingNone,
			FrontendDist:   t.TempDir(),
		},
	})

	robots := httptest.NewRecorder()
	router.ServeHTTP(robots, httptest.NewRequest(http.MethodGet, "/robots.txt", nil))
	if robots.Code != http.StatusOK {
		t.Fatalf("robots status = %d, want %d; body: %s", robots.Code, http.StatusOK, robots.Body.String())
	}
	for _, want := range []string{
		"User-agent: *",
		"Disallow: /",
		"Allow: /robots.txt",
		"Allow: /sitemap.xml",
		"Allow: /assets/",
		"Allow: /favicon.ico",
		"Allow: /brand-logo.svg",
		"Sitemap: https://mail.example.com/sitemap.xml",
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
	if strings.Contains(sitemap.Body.String(), "<loc>") {
		t.Fatalf("sitemap.xml should not include indexable URLs in none mode:\n%s", sitemap.Body.String())
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
