package domain

import (
	"net/url"
	"strings"
	"testing"
)

func TestRDAPDomainURLEncodesDomainPathSegment(t *testing.T) {
	domainName := "example.com/../../admin?x=1#frag"
	got := rdapDomainURL(domainName)

	parsed, err := url.Parse(got)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Scheme != "https" || parsed.Host != "rdap.org" {
		t.Fatalf("unexpected RDAP URL origin: %s", got)
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" {
		t.Fatalf("domain escaped into query or fragment: %s", got)
	}
	if strings.Contains(parsed.EscapedPath(), "/../") || strings.Contains(parsed.EscapedPath(), "?") || strings.Contains(parsed.EscapedPath(), "#") {
		t.Fatalf("domain was not encoded as one path segment: %s", got)
	}

	encodedDomain := strings.TrimPrefix(parsed.EscapedPath(), "/domain/")
	decodedDomain, err := url.PathUnescape(encodedDomain)
	if err != nil {
		t.Fatal(err)
	}
	if decodedDomain != domainName {
		t.Fatalf("decoded domain = %q, want %q", decodedDomain, domainName)
	}
}
