package httpapi

import (
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestNormalizeBrandIconDomain(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		want    string
		wantErr bool
	}{
		{name: "plain", input: "OpenAI.COM.", want: "openai.com"},
		{name: "idn", input: "\u4f8b\u5b50.\u516c\u53f8.cn", want: "xn--fsqu00a.xn--55qx5d.cn"},
		{name: "address rejected", input: "team@openai.com", wantErr: true},
		{name: "url rejected", input: "https://openai.com", wantErr: true},
		{name: "localhost rejected", input: "localhost", wantErr: true},
		{name: "ip rejected", input: "127.0.0.1", wantErr: true},
		{name: "bad label rejected", input: "-openai.com", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := normalizeBrandIconDomain(tt.input)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("normalizeBrandIconDomain(%q) err = nil, want error", tt.input)
				}
				return
			}
			if err != nil {
				t.Fatalf("normalizeBrandIconDomain(%q) err = %v", tt.input, err)
			}
			if got != tt.want {
				t.Fatalf("normalizeBrandIconDomain(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestNormalizeBrandIconExternalURLRejectsUnsafeTargets(t *testing.T) {
	base := normalizeBrandIconExternalURL("https://example.com/path/", nil)
	if base == nil {
		t.Fatal("base URL was not normalized")
	}

	tests := []string{
		"ftp://example.com/favicon.ico",
		"https://127.0.0.1/favicon.ico",
		"https://localhost/favicon.ico",
		"https://example.com:8443/favicon.ico",
		"data:image/svg+xml,<svg/>",
	}

	for _, input := range tests {
		if got := normalizeBrandIconExternalURL(input, base); got != nil {
			t.Fatalf("normalizeBrandIconExternalURL(%q) = %s, want nil", input, got)
		}
	}

	got := normalizeBrandIconExternalURL("../icon.png#fragment", base)
	if got == nil {
		t.Fatal("relative icon URL was rejected")
	}
	if got.String() != "https://example.com/icon.png" {
		t.Fatalf("relative icon URL = %s, want https://example.com/icon.png", got)
	}
}

func TestBrandIconSafetyHelpers(t *testing.T) {
	if err := validateBrandIconPublicIP(net.ParseIP("8.8.8.8")); err != nil {
		t.Fatalf("public IP rejected: %v", err)
	}
	for _, value := range []string{"127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "fc00::1"} {
		if err := validateBrandIconPublicIP(net.ParseIP(value)); err == nil {
			t.Fatalf("private IP %s accepted", value)
		}
	}

	if got := sniffBrandIconType([]byte{0x89, 'P', 'N', 'G', '\r', '\n'}, "text/plain"); got != "image/png" {
		t.Fatalf("png sniff = %q", got)
	}
	if got := sniffBrandIconType([]byte("<svg viewBox=\"0 0 1 1\"></svg>"), "text/plain"); got != "image/svg+xml" {
		t.Fatalf("svg sniff = %q", got)
	}
	if _, ok := sanitizeBrandIconSVG([]byte(`<svg><script>alert(1)</script></svg>`)); ok {
		t.Fatal("script SVG was accepted")
	}
	if _, ok := sanitizeBrandIconSVG([]byte(`<svg><path fill="url(#a)"/></svg>`)); !ok {
		t.Fatal("local paint server SVG was rejected")
	}
}

func TestBrandIconRouteIsPublicImageResource(t *testing.T) {
	defaultBrandIconCache = &brandIconMemoryCache{items: map[string]brandIconCacheEntry{
		"openai.com": {
			payload: brandIconPayload{
				body:        []byte{0x89, 'P', 'N', 'G', '\r', '\n'},
				contentType: "image/png",
				source:      "test",
			},
			expiresAt: time.Now().Add(time.Hour),
			savedAt:   time.Now(),
		},
	}}
	t.Cleanup(func() {
		defaultBrandIconCache = &brandIconMemoryCache{items: map[string]brandIconCacheEntry{}}
	})

	router := NewRouter(&Handler{})
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/brand-icon?domain=openai.com", nil)
	request.Header.Set("X-API-Key", "invalid-key")
	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", recorder.Code, recorder.Body.String())
	}
	if contentType := recorder.Header().Get("Content-Type"); !strings.HasPrefix(contentType, "image/png") {
		t.Fatalf("content-type = %q, want image/png", contentType)
	}
	if cacheControl := recorder.Header().Get("Cache-Control"); !strings.Contains(cacheControl, "max-age=604800") {
		t.Fatalf("cache-control = %q, want 7 day cache", cacheControl)
	}
}
