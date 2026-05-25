package httpapi

import (
	"encoding/xml"
	"net/http"
	"net/url"
	"strings"

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
	lines := []string{
		"User-agent: *",
		"Disallow: /api/auth",
		"Disallow: /api/install",
		"Disallow: /api/oauth",
		"Disallow: /api/shared/",
		"Disallow: /api/email",
		"Disallow: /api/emails",
		"Disallow: /api/mailboxes",
		"Disallow: /api/domains",
		"Disallow: /api/stats",
		"Disallow: /api/inbox-stream",
		"Disallow: /api/notification",
		"Disallow: /api/announcement",
		"Disallow: /api/share-links",
		"Disallow: /api/webhooks",
		"Disallow: /api/api-keys",
		"Disallow: /api/user",
		"Disallow: /api/users",
		"Disallow: /api/admin",
		"Disallow: /api/generate-email",
		"Disallow: /api/version/check",
		"Disallow: /share/",
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
		"Sitemap: " + absoluteSiteURL(baseURL, "/sitemap.xml"),
		"",
	}
	c.Header("Cache-Control", "public, max-age=3600")
	c.Data(http.StatusOK, "text/plain; charset=utf-8", []byte(strings.Join(lines, "\n")))
}

func (h *Handler) sitemapXML(c *gin.Context) {
	baseURL := h.publicSiteBaseURL(c)
	urls := []sitemapURL{
		{Loc: absoluteSiteURL(baseURL, "/"), ChangeFreq: "weekly", Priority: "1.0"},
		{Loc: absoluteSiteURL(baseURL, "/api/docs.md"), ChangeFreq: "weekly", Priority: "0.8"},
	}
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
