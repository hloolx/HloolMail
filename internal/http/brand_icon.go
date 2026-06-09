package httpapi

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/net/html"
	"golang.org/x/net/idna"
)

const (
	brandIconMaxBytes       = 768 * 1024
	brandIconHTMLMaxBytes   = 240 * 1024
	brandIconPositiveTTL    = 7 * 24 * time.Hour
	brandIconNegativeTTL    = 1 * time.Hour
	brandIconErrorCacheTTL  = 30 * time.Minute
	brandIconResolveTimeout = 12 * time.Second
	brandIconFetchTimeout   = 5 * time.Second
	brandIconCacheMaxItems  = 512
	brandIconUserAgent      = "HloolMail Brand Icon Resolver/1.0"
)

type brandIconPayload struct {
	body        []byte
	contentType string
	source      string
}

type brandIconCandidate struct {
	url    *url.URL
	source string
	score  int
}

type brandIconCacheEntry struct {
	payload   brandIconPayload
	negative  bool
	expiresAt time.Time
	savedAt   time.Time
}

type brandIconMemoryCache struct {
	mu    sync.Mutex
	items map[string]brandIconCacheEntry
}

var (
	defaultBrandIconCache = &brandIconMemoryCache{items: map[string]brandIconCacheEntry{}}
	brandIconHTTPClient   = newBrandIconHTTPClient()
)

func (h *Handler) brandIcon(c *gin.Context) {
	domain, err := normalizeBrandIconDomain(c.Query("domain"))
	if err != nil {
		brandIconError(c, http.StatusBadRequest, "invalid domain")
		return
	}

	if entry, ok := defaultBrandIconCache.get(domain); ok {
		if entry.negative {
			brandIconError(c, http.StatusNotFound, "brand icon not found")
			return
		}
		writeBrandIcon(c, entry.payload)
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), brandIconResolveTimeout)
	defer cancel()

	payload, err := resolveBrandIcon(ctx, domain)
	if err != nil {
		defaultBrandIconCache.setNegative(domain)
		brandIconError(c, http.StatusNotFound, "brand icon not found")
		return
	}

	defaultBrandIconCache.setPositive(domain, payload)
	writeBrandIcon(c, payload)
}

func brandIconError(c *gin.Context, status int, message string) {
	c.Header("Cache-Control", fmt.Sprintf("public, max-age=%d", int(brandIconErrorCacheTTL.Seconds())))
	fail(c, status, message)
}

func writeBrandIcon(c *gin.Context, payload brandIconPayload) {
	c.Header("Cache-Control", fmt.Sprintf("public, max-age=%d, immutable", int(brandIconPositiveTTL.Seconds())))
	c.Header("Cross-Origin-Resource-Policy", "same-origin")
	c.Header("Content-Security-Policy", "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("X-Hloolmail-Brand-Source", payload.source)
	c.Data(http.StatusOK, payload.contentType, payload.body)
}

func (cache *brandIconMemoryCache) get(domain string) (brandIconCacheEntry, bool) {
	cache.mu.Lock()
	defer cache.mu.Unlock()

	entry, ok := cache.items[domain]
	if !ok {
		return brandIconCacheEntry{}, false
	}
	if time.Now().After(entry.expiresAt) {
		delete(cache.items, domain)
		return brandIconCacheEntry{}, false
	}
	return entry, true
}

func (cache *brandIconMemoryCache) setPositive(domain string, payload brandIconPayload) {
	cache.set(domain, brandIconCacheEntry{
		payload:   payload,
		expiresAt: time.Now().Add(brandIconPositiveTTL),
		savedAt:   time.Now(),
	})
}

func (cache *brandIconMemoryCache) setNegative(domain string) {
	cache.set(domain, brandIconCacheEntry{
		negative:  true,
		expiresAt: time.Now().Add(brandIconNegativeTTL),
		savedAt:   time.Now(),
	})
}

func (cache *brandIconMemoryCache) set(domain string, entry brandIconCacheEntry) {
	cache.mu.Lock()
	defer cache.mu.Unlock()

	if cache.items == nil {
		cache.items = map[string]brandIconCacheEntry{}
	}
	cache.items[domain] = entry
	if len(cache.items) <= brandIconCacheMaxItems {
		return
	}

	type cacheItem struct {
		key     string
		savedAt time.Time
	}
	items := make([]cacheItem, 0, len(cache.items))
	for key, value := range cache.items {
		items = append(items, cacheItem{key: key, savedAt: value.savedAt})
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].savedAt.Before(items[j].savedAt)
	})
	for len(cache.items) > brandIconCacheMaxItems && len(items) > 0 {
		delete(cache.items, items[0].key)
		items = items[1:]
	}
}

func resolveBrandIcon(ctx context.Context, domain string) (brandIconPayload, error) {
	tried := map[string]struct{}{}

	if payload, ok := tryBrandIconCandidates(ctx, bimiBrandIconCandidates(ctx, domain), tried); ok {
		return payload, nil
	}
	if payload, ok := tryBrandIconCandidates(ctx, baseBrandIconCandidates(domain), tried); ok {
		return payload, nil
	}
	if payload, ok := tryBrandIconCandidates(ctx, htmlBrandIconCandidates(ctx, domain), tried); ok {
		return payload, nil
	}
	if !strings.HasPrefix(domain, "www.") {
		if payload, ok := tryBrandIconCandidates(ctx, htmlBrandIconCandidates(ctx, "www."+domain), tried); ok {
			return payload, nil
		}
	}
	return brandIconPayload{}, errors.New("brand icon not found")
}

func tryBrandIconCandidates(ctx context.Context, candidates []brandIconCandidate, tried map[string]struct{}) (brandIconPayload, bool) {
	sort.SliceStable(candidates, func(i, j int) bool {
		return candidates[i].score < candidates[j].score
	})
	for _, candidate := range candidates {
		if candidate.url == nil {
			continue
		}
		key := candidate.url.String()
		if _, exists := tried[key]; exists {
			continue
		}
		tried[key] = struct{}{}
		payload, err := fetchBrandIcon(ctx, candidate)
		if err == nil {
			return payload, true
		}
	}
	return brandIconPayload{}, false
}

func bimiBrandIconCandidates(ctx context.Context, domain string) []brandIconCandidate {
	lookupCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	txts, err := net.DefaultResolver.LookupTXT(lookupCtx, "default._bimi."+domain)
	if err != nil {
		return nil
	}

	candidates := make([]brandIconCandidate, 0, 1)
	for _, txt := range txts {
		if !strings.Contains(strings.ToLower(txt), "v=bimi1") {
			continue
		}
		for _, part := range strings.Split(txt, ";") {
			key, value, ok := strings.Cut(strings.TrimSpace(part), "=")
			if !ok || !strings.EqualFold(strings.TrimSpace(key), "l") {
				continue
			}
			if iconURL := normalizeBrandIconExternalURL(strings.TrimSpace(value), nil); iconURL != nil {
				candidates = append(candidates, brandIconCandidate{url: iconURL, source: "bimi", score: 0})
			}
		}
	}
	return candidates
}

func baseBrandIconCandidates(domain string) []brandIconCandidate {
	values := []string{
		"https://" + domain + "/apple-touch-icon.png",
		"https://" + domain + "/apple-touch-icon-precomposed.png",
		"https://" + domain + "/favicon.ico",
	}
	if !strings.HasPrefix(domain, "www.") {
		values = append(values,
			"https://www."+domain+"/apple-touch-icon.png",
			"https://www."+domain+"/favicon.ico",
		)
	}

	candidates := make([]brandIconCandidate, 0, len(values))
	for index, value := range values {
		iconURL := normalizeBrandIconExternalURL(value, nil)
		if iconURL == nil {
			continue
		}
		source := "favicon"
		if strings.Contains(iconURL.Path, "apple-touch") {
			source = "apple-touch-icon"
		}
		candidates = append(candidates, brandIconCandidate{url: iconURL, source: source, score: index + 10})
	}
	return candidates
}

func htmlBrandIconCandidates(ctx context.Context, domain string) []brandIconCandidate {
	home := normalizeBrandIconExternalURL("https://"+domain+"/", nil)
	if home == nil {
		return nil
	}

	body, baseURL, ok := fetchBrandIconHTML(ctx, home)
	if !ok {
		return nil
	}

	root, err := html.Parse(bytes.NewReader(body))
	if err != nil {
		return nil
	}

	pageBase := baseURL
	if href := firstHTMLAttr(root, "base", "href"); href != "" {
		if parsed := normalizeBrandIconExternalURL(href, baseURL); parsed != nil {
			pageBase = parsed
		}
	}

	candidates := make([]brandIconCandidate, 0, 6)
	walkHTML(root, func(node *html.Node) {
		if node.Type != html.ElementNode || !strings.EqualFold(node.Data, "link") {
			return
		}
		rel := htmlAttr(node, "rel")
		if !linkRelIncludesIcon(rel) {
			return
		}
		href := strings.TrimSpace(htmlAttr(node, "href"))
		if href == "" {
			return
		}
		iconURL := normalizeBrandIconExternalURL(href, pageBase)
		if iconURL == nil {
			return
		}
		candidates = append(candidates, brandIconCandidate{
			url:    iconURL,
			source: htmlIconSource(rel),
			score:  htmlIconScore(rel, htmlAttr(node, "sizes"), htmlAttr(node, "type")),
		})
	})
	if len(candidates) > 8 {
		sort.SliceStable(candidates, func(i, j int) bool {
			return candidates[i].score < candidates[j].score
		})
		candidates = candidates[:8]
	}
	return candidates
}

func fetchBrandIconHTML(ctx context.Context, home *url.URL) ([]byte, *url.URL, bool) {
	fetchCtx, cancel := context.WithTimeout(ctx, brandIconFetchTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(fetchCtx, http.MethodGet, home.String(), nil)
	if err != nil {
		return nil, nil, false
	}
	req.Header.Set("Accept", "text/html,application/xhtml+xml;q=0.9,*/*;q=0.2")
	req.Header.Set("User-Agent", brandIconUserAgent)

	resp, err := brandIconHTTPClient.Do(req)
	if err != nil {
		return nil, nil, false
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, nil, false
	}
	if length := resp.ContentLength; length > brandIconHTMLMaxBytes {
		return nil, nil, false
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, brandIconHTMLMaxBytes+1))
	if err != nil || len(body) == 0 || len(body) > brandIconHTMLMaxBytes {
		return nil, nil, false
	}

	contentType := strings.ToLower(resp.Header.Get("Content-Type"))
	if contentType != "" && !strings.Contains(contentType, "html") && !looksLikeHTML(body) {
		return nil, nil, false
	}

	baseURL := resp.Request.URL
	if baseURL == nil {
		baseURL = home
	}
	return body, baseURL, true
}

func fetchBrandIcon(ctx context.Context, candidate brandIconCandidate) (brandIconPayload, error) {
	fetchCtx, cancel := context.WithTimeout(ctx, brandIconFetchTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(fetchCtx, http.MethodGet, candidate.url.String(), nil)
	if err != nil {
		return brandIconPayload{}, err
	}
	req.Header.Set("Accept", "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8")
	req.Header.Set("User-Agent", brandIconUserAgent)

	resp, err := brandIconHTTPClient.Do(req)
	if err != nil {
		return brandIconPayload{}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return brandIconPayload{}, fmt.Errorf("icon status %d", resp.StatusCode)
	}
	if length := resp.ContentLength; length > brandIconMaxBytes {
		return brandIconPayload{}, fmt.Errorf("icon too large")
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, brandIconMaxBytes+1))
	if err != nil {
		return brandIconPayload{}, err
	}
	if len(body) == 0 || len(body) > brandIconMaxBytes {
		return brandIconPayload{}, fmt.Errorf("icon too large")
	}

	contentType := sniffBrandIconType(body, resp.Header.Get("Content-Type"))
	if contentType == "" {
		return brandIconPayload{}, fmt.Errorf("unsupported icon type")
	}

	if contentType == "image/svg+xml" {
		sanitized, ok := sanitizeBrandIconSVG(body)
		if !ok {
			return brandIconPayload{}, fmt.Errorf("unsafe svg")
		}
		body = sanitized
	}

	return brandIconPayload{
		body:        body,
		contentType: contentType,
		source:      candidate.source,
	}, nil
}

func normalizeBrandIconDomain(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", fmt.Errorf("domain is required")
	}
	if strings.Contains(value, "@") || strings.ContainsAny(value, "/\\?#:") {
		return "", fmt.Errorf("domain must not include address or URL syntax")
	}
	return normalizeBrandIconHostname(value)
}

func normalizeBrandIconExternalURL(value string, base *url.URL) *url.URL {
	value = strings.TrimSpace(value)
	if value == "" || strings.HasPrefix(strings.ToLower(value), "data:") {
		return nil
	}
	parsed, err := url.Parse(value)
	if err != nil {
		return nil
	}
	if base != nil {
		parsed = base.ResolveReference(parsed)
	}
	if parsed.Scheme != "https" && parsed.Scheme != "http" {
		return nil
	}
	if parsed.User != nil || parsed.Hostname() == "" {
		return nil
	}
	host, err := normalizeBrandIconHostname(parsed.Hostname())
	if err != nil {
		return nil
	}
	port := parsed.Port()
	if port != "" && port != "80" && port != "443" {
		return nil
	}
	parsed.Host = host
	if port != "" {
		parsed.Host = net.JoinHostPort(host, port)
	}
	parsed.User = nil
	parsed.Fragment = ""
	return parsed
}

func normalizeBrandIconHostname(value string) (string, error) {
	host := strings.Trim(strings.ToLower(strings.TrimSpace(value)), ".")
	if host == "" || len(host) > 253 {
		return "", fmt.Errorf("invalid host")
	}
	if ip := net.ParseIP(host); ip != nil {
		return "", fmt.Errorf("ip hosts are not allowed")
	}
	ascii, err := idna.Lookup.ToASCII(host)
	if err != nil {
		return "", err
	}
	ascii = strings.Trim(strings.ToLower(ascii), ".")
	if ascii == "" || len(ascii) > 253 {
		return "", fmt.Errorf("invalid host")
	}
	if isBlockedBrandIconHost(ascii) || strings.Contains(ascii, "..") {
		return "", fmt.Errorf("blocked host")
	}
	labels := strings.Split(ascii, ".")
	if len(labels) < 2 {
		return "", fmt.Errorf("host must include a public suffix")
	}
	for _, label := range labels {
		if !validBrandIconLabel(label) {
			return "", fmt.Errorf("invalid host label")
		}
	}
	tld := labels[len(labels)-1]
	if !validBrandIconTLD(tld) {
		return "", fmt.Errorf("invalid host suffix")
	}
	return ascii, nil
}

func validBrandIconLabel(label string) bool {
	if label == "" || len(label) > 63 || strings.HasPrefix(label, "-") || strings.HasSuffix(label, "-") {
		return false
	}
	for _, r := range label {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' {
			continue
		}
		return false
	}
	return true
}

func validBrandIconTLD(label string) bool {
	if len(label) < 2 || len(label) > 63 {
		return false
	}
	if strings.HasPrefix(label, "xn--") {
		return true
	}
	for _, r := range label {
		if r < 'a' || r > 'z' {
			return false
		}
	}
	return true
}

func isBlockedBrandIconHost(host string) bool {
	switch host {
	case "localhost", "local", "metadata.google.internal":
		return true
	default:
		return strings.HasSuffix(host, ".localhost") || strings.HasSuffix(host, ".local")
	}
}

func newBrandIconHTTPClient() *http.Client {
	return &http.Client{
		Transport: &http.Transport{
			DialContext:           safeBrandIconDialer{Dialer: &net.Dialer{Timeout: 5 * time.Second}}.DialContext,
			ForceAttemptHTTP2:     true,
			MaxIdleConns:          80,
			IdleConnTimeout:       60 * time.Second,
			TLSHandshakeTimeout:   5 * time.Second,
			ResponseHeaderTimeout: 5 * time.Second,
		},
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 4 {
				return errors.New("too many redirects")
			}
			if req == nil || req.URL == nil || normalizeBrandIconExternalURL(req.URL.String(), nil) == nil {
				return errors.New("unsafe redirect")
			}
			return nil
		},
	}
}

type safeBrandIconDialer struct {
	Dialer *net.Dialer
}

func (d safeBrandIconDialer) DialContext(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, fmt.Errorf("invalid icon dial address: %w", err)
	}
	host = strings.Trim(host, "[]")
	if port != "80" && port != "443" {
		return nil, fmt.Errorf("icon port is not allowed")
	}

	dialer := d.Dialer
	if dialer == nil {
		dialer = &net.Dialer{Timeout: 5 * time.Second}
	}
	if ip := net.ParseIP(host); ip != nil {
		if err := validateBrandIconPublicIP(ip); err != nil {
			return nil, err
		}
		return dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
	}
	if _, err := normalizeBrandIconHostname(host); err != nil {
		return nil, err
	}

	ips, err := net.DefaultResolver.LookupIP(ctx, "ip", host)
	if err != nil {
		return nil, fmt.Errorf("resolve icon host: %w", err)
	}
	if len(ips) == 0 {
		return nil, fmt.Errorf("icon host resolved to no addresses")
	}

	var lastErr error
	for _, ip := range ips {
		if err := validateBrandIconPublicIP(ip); err != nil {
			lastErr = err
			continue
		}
		conn, err := dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
		if err == nil {
			return conn, nil
		}
		lastErr = err
	}
	if lastErr != nil {
		return nil, lastErr
	}
	return nil, fmt.Errorf("icon host resolved to no usable addresses")
}

func validateBrandIconPublicIP(ip net.IP) error {
	if ip == nil {
		return fmt.Errorf("invalid icon host address")
	}
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified() || ip.IsMulticast() {
		return fmt.Errorf("icon host address is not allowed")
	}
	addr, ok := netip.AddrFromSlice(ip)
	if !ok {
		return fmt.Errorf("invalid icon host address")
	}
	addr = addr.Unmap()
	for _, prefix := range blockedBrandIconIPRanges {
		if prefix.Contains(addr) {
			return fmt.Errorf("icon host address is not allowed")
		}
	}
	return nil
}

var blockedBrandIconIPRanges = mustParseBrandIconIPPrefixes([]string{
	"0.0.0.0/8",
	"10.0.0.0/8",
	"100.64.0.0/10",
	"127.0.0.0/8",
	"169.254.0.0/16",
	"172.16.0.0/12",
	"192.0.0.0/24",
	"192.0.2.0/24",
	"192.168.0.0/16",
	"198.18.0.0/15",
	"198.51.100.0/24",
	"203.0.113.0/24",
	"224.0.0.0/4",
	"240.0.0.0/4",
	"::/128",
	"::1/128",
	"::ffff:0:0/96",
	"64:ff9b::/96",
	"100::/64",
	"2001::/23",
	"2001:db8::/32",
	"fc00::/7",
	"fe80::/10",
	"ff00::/8",
})

func mustParseBrandIconIPPrefixes(raw []string) []netip.Prefix {
	prefixes := make([]netip.Prefix, 0, len(raw))
	for _, value := range raw {
		prefixes = append(prefixes, netip.MustParsePrefix(value))
	}
	return prefixes
}

func sniffBrandIconType(body []byte, declared string) string {
	if len(body) < 4 {
		return ""
	}
	if bytes.HasPrefix(body, []byte{0x89, 'P', 'N', 'G'}) {
		return "image/png"
	}
	if bytes.HasPrefix(body, []byte{0xff, 0xd8}) {
		return "image/jpeg"
	}
	if bytes.HasPrefix(body, []byte("GIF87a")) || bytes.HasPrefix(body, []byte("GIF89a")) {
		return "image/gif"
	}
	if len(body) >= 12 && bytes.Equal(body[:4], []byte("RIFF")) && bytes.Equal(body[8:12], []byte("WEBP")) {
		return "image/webp"
	}
	if bytes.HasPrefix(body, []byte{0x00, 0x00, 0x01, 0x00}) || bytes.HasPrefix(body, []byte{0x00, 0x00, 0x02, 0x00}) {
		return "image/x-icon"
	}
	trimmed := bytes.TrimSpace(body)
	if len(trimmed) > 0 {
		prefix := strings.ToLower(string(trimmed[:min(len(trimmed), 256)]))
		if strings.HasPrefix(prefix, "<svg") || strings.Contains(prefix, "<svg") {
			return "image/svg+xml"
		}
		if strings.HasPrefix(prefix, "<!doctype html") || strings.HasPrefix(prefix, "<html") {
			return ""
		}
	}

	mediaType, _, err := mime.ParseMediaType(strings.ToLower(strings.TrimSpace(declared)))
	if err != nil {
		return ""
	}
	switch mediaType {
	case "image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp", "image/x-icon", "image/vnd.microsoft.icon":
		if mediaType == "image/jpg" {
			return "image/jpeg"
		}
		if mediaType == "image/vnd.microsoft.icon" {
			return "image/x-icon"
		}
		return mediaType
	default:
		return ""
	}
}

func sanitizeBrandIconSVG(body []byte) ([]byte, bool) {
	if len(body) > brandIconMaxBytes {
		return nil, false
	}
	text := string(body)
	lowered := strings.ToLower(text)
	blockedFragments := []string{
		"<script",
		"<foreignobject",
		"<iframe",
		"<object",
		"<embed",
		"<audio",
		"<video",
		"<image",
		"javascript:",
		"data:",
	}
	for _, fragment := range blockedFragments {
		if strings.Contains(lowered, fragment) {
			return nil, false
		}
	}
	if svgEventAttrPattern.MatchString(lowered) || svgExternalHrefPattern.MatchString(lowered) || svgExternalURLPattern.MatchString(lowered) {
		return nil, false
	}
	return []byte(text), true
}

var (
	svgEventAttrPattern    = regexp.MustCompile(`\son[a-z0-9_-]+\s*=`)
	svgExternalHrefPattern = regexp.MustCompile(`(?:xlink:)?href\s*=\s*["']\s*(?:https?:|//|[^#])`)
	svgExternalURLPattern  = regexp.MustCompile(`url\(\s*['"]?\s*(?:https?:|//|[^#])`)
)

func looksLikeHTML(body []byte) bool {
	trimmed := bytes.TrimSpace(body)
	prefix := strings.ToLower(string(trimmed[:min(len(trimmed), 128)]))
	return strings.HasPrefix(prefix, "<!doctype html") || strings.HasPrefix(prefix, "<html") || strings.Contains(prefix, "<head")
}

func firstHTMLAttr(root *html.Node, tagName string, attrName string) string {
	var value string
	walkHTML(root, func(node *html.Node) {
		if value != "" || node.Type != html.ElementNode || !strings.EqualFold(node.Data, tagName) {
			return
		}
		value = htmlAttr(node, attrName)
	})
	return value
}

func walkHTML(node *html.Node, visit func(*html.Node)) {
	if node == nil {
		return
	}
	visit(node)
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		walkHTML(child, visit)
	}
}

func htmlAttr(node *html.Node, name string) string {
	for _, attr := range node.Attr {
		if strings.EqualFold(attr.Key, name) {
			return attr.Val
		}
	}
	return ""
}

func linkRelIncludesIcon(rel string) bool {
	for _, token := range strings.Fields(strings.ToLower(rel)) {
		if token == "icon" || token == "apple-touch-icon" || token == "apple-touch-icon-precomposed" || token == "shortcut" || token == "mask-icon" {
			return true
		}
	}
	return strings.Contains(strings.ToLower(rel), "icon")
}

func htmlIconSource(rel string) string {
	rel = strings.ToLower(rel)
	if strings.Contains(rel, "apple") {
		return "apple-touch-icon"
	}
	return "html-icon"
}

func htmlIconScore(rel string, sizes string, iconType string) int {
	score := 50
	rel = strings.ToLower(rel)
	iconType = strings.ToLower(iconType)
	switch {
	case strings.Contains(rel, "apple-touch-icon"):
		score = 20
	case strings.Contains(rel, "shortcut"):
		score = 35
	case strings.Contains(rel, "icon"):
		score = 30
	}
	if strings.Contains(iconType, "svg") {
		score += 3
	}
	if strings.Contains(sizes, "180x180") || strings.Contains(sizes, "192x192") || strings.Contains(sizes, "512x512") {
		score -= 5
	}
	return score
}
