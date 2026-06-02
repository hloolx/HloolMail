package httpapi

import (
	"encoding/xml"
	"net/http"
	"net/url"
	"strings"

	"gptmail/internal/config"

	"github.com/gin-gonic/gin"
)

type sitemapURLSet struct {
	XMLName xml.Name     `xml:"urlset"`
	Xmlns   string       `xml:"xmlns,attr"`
	URLs    []sitemapURL `xml:"url"`
}

type sitemapURL struct {
	Loc        string `xml:"loc"`
	ChangeFreq string `xml:"changefreq,omitempty"`
	Priority   string `xml:"priority,omitempty"`
}

func (h *Handler) robotsTXT(c *gin.Context) {
	baseURL := h.publicSiteBaseURL(c)
	lines := robotsTXTLines(h.publicIndexingMode(), baseURL)
	c.Header("Cache-Control", "public, max-age=3600")
	c.Data(http.StatusOK, "text/plain; charset=utf-8", []byte(strings.Join(lines, "\n")))
}

func robotsTXTLines(publicIndexing, baseURL string) []string {
	mode := config.NormalizePublicIndexing(publicIndexing)
	lines := []string{
		"User-agent: *",
	}
	if mode == config.PublicIndexingNone {
		lines = append(lines,
			"Disallow: /",
			"Allow: /robots.txt",
			"Allow: /sitemap.xml",
			"Allow: /assets/",
			"Allow: /favicon.ico",
			"Allow: /brand-logo.svg",
		)
	} else {
		lines = append(lines, apiRobotsLines(mode)...)
		lines = append(lines, spaRobotsDisallowLines()...)
	}
	lines = append(lines, "Sitemap: "+absoluteSiteURL(baseURL, "/sitemap.xml"), "")
	return lines
}

func apiRobotsLines(publicIndexing string) []string {
	lines := []string{"Disallow: /api/"}
	if config.NormalizePublicIndexing(publicIndexing) == config.PublicIndexingDocs {
		lines = append(lines,
			"Allow: /api/health",
			"Allow: /api/version",
			"Allow: /api/docs.md",
			"Allow: /api/skill.md",
			"Allow: /api/openapi.json",
			"Allow: /api/openapi.yaml",
		)
	}
	lines = append(lines, "Disallow: /api/version/check")
	return lines
}

func spaRobotsDisallowLines() []string {
	return []string{
		"Disallow: /yyds/",
		"Disallow: /share/",
		"Disallow: /*?key=",
		"Disallow: /*?api_key=",
		"Disallow: /login",
		"Disallow: /register",
		"Disallow: /install",
		"Disallow: /dashboard",
		"Disallow: /inbox",
		"Disallow: /domain-management",
		"Disallow: /api-keys",
		"Disallow: /webhooks",
		"Disallow: /users",
		"Disallow: /admin",
	}
}

func (h *Handler) sitemapXML(c *gin.Context) {
	baseURL := h.publicSiteBaseURL(c)
	urls := sitemapURLsForIndexing(baseURL, h.publicIndexingMode())
	payload, err := xml.MarshalIndent(sitemapURLSet{
		Xmlns: "http://www.sitemaps.org/schemas/sitemap/0.9",
		URLs:  urls,
	}, "", "  ")
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	data := append([]byte(xml.Header), payload...)
	data = append(data, '\n')
	c.Header("Cache-Control", "public, max-age=3600")
	c.Data(http.StatusOK, "application/xml; charset=utf-8", data)
}

func sitemapURLsForIndexing(baseURL, publicIndexing string) []sitemapURL {
	switch config.NormalizePublicIndexing(publicIndexing) {
	case config.PublicIndexingNone:
		return nil
	case config.PublicIndexingDocs:
		return []sitemapURL{
			{Loc: absoluteSiteURL(baseURL, "/"), ChangeFreq: "weekly", Priority: "1.0"},
			{Loc: absoluteSiteURL(baseURL, "/api/docs.md"), ChangeFreq: "weekly", Priority: "0.8"},
			{Loc: absoluteSiteURL(baseURL, "/api/skill.md"), ChangeFreq: "weekly", Priority: "0.8"},
			{Loc: absoluteSiteURL(baseURL, "/api/openapi.json"), ChangeFreq: "weekly", Priority: "0.7"},
			{Loc: absoluteSiteURL(baseURL, "/api/openapi.yaml"), ChangeFreq: "weekly", Priority: "0.7"},
			{Loc: absoluteSiteURL(baseURL, "/api/version"), ChangeFreq: "weekly", Priority: "0.5"},
			{Loc: absoluteSiteURL(baseURL, "/api/health"), ChangeFreq: "weekly", Priority: "0.5"},
		}
	default:
		return []sitemapURL{
			{Loc: absoluteSiteURL(baseURL, "/"), ChangeFreq: "weekly", Priority: "1.0"},
		}
	}
}

func (h *Handler) publicSiteBaseURL(c *gin.Context) string {
	baseURL := strings.TrimRight(strings.TrimSpace(h.Config.PublicBaseURL), "/")
	if baseURL == "" {
		baseURL = requestBaseURL(c)
	}
	if parsed, err := url.Parse(baseURL); err == nil && parsed.Scheme != "" && parsed.Host != "" {
		if parsed.Path != "" && parsed.Path != "/" {
			parsed.Path = strings.TrimRight(parsed.Path, "/")
		}
		parsed.RawQuery = ""
		parsed.Fragment = ""
		return strings.TrimRight(parsed.String(), "/")
	}
	return strings.TrimRight(requestBaseURL(c), "/")
}

func absoluteSiteURL(baseURL, pathValue string) string {
	parsed, err := url.Parse(baseURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return pathValue
	}
	joinedPath := "/" + strings.TrimLeft(pathValue, "/")
	if parsed.Path != "" && parsed.Path != "/" {
		joinedPath = strings.TrimRight(parsed.Path, "/") + joinedPath
	}
	parsed.Path = joinedPath
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String()
}
