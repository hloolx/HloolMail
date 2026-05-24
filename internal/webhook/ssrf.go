package webhook

import (
	"context"
	"fmt"
	"net"
	"net/netip"
	"net/url"
	"strings"
	"time"
)

type Resolver func(ctx context.Context, host string) ([]net.IP, error)

func DefaultResolver(ctx context.Context, host string) ([]net.IP, error) {
	return net.DefaultResolver.LookupIP(ctx, "ip", host)
}

func ValidateEndpointURL(rawURL string) error {
	u, err := parseWebhookURL(rawURL)
	if err != nil {
		return err
	}
	host := normalizedHost(u)
	if ip := net.ParseIP(host); ip != nil {
		return validatePublicIP(ip)
	}
	return validateHostname(host)
}

func ValidateDeliveryURL(ctx context.Context, rawURL string, resolve Resolver) error {
	u, err := parseWebhookURL(rawURL)
	if err != nil {
		return err
	}
	if err := validateURLHost(ctx, u, resolve); err != nil {
		return err
	}
	return nil
}

func validateURLHost(ctx context.Context, u *url.URL, resolve Resolver) error {
	host := normalizedHost(u)
	if ip := net.ParseIP(host); ip != nil {
		return validatePublicIP(ip)
	}
	if err := validateHostname(host); err != nil {
		return err
	}
	if resolve == nil {
		resolve = DefaultResolver
	}
	ips, err := resolve(ctx, host)
	if err != nil {
		return fmt.Errorf("resolve webhook host: %w", err)
	}
	if len(ips) == 0 {
		return fmt.Errorf("webhook host resolved to no addresses")
	}
	for _, ip := range ips {
		if err := validatePublicIP(ip); err != nil {
			return err
		}
	}
	return nil
}

type safeWebhookDialer struct {
	Resolve Resolver
	Dialer  *net.Dialer
}

func (d safeWebhookDialer) DialContext(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, fmt.Errorf("invalid webhook dial address: %w", err)
	}
	host = strings.Trim(host, "[]")
	if err := validateDialHost(ctx, host, d.Resolve); err != nil {
		return nil, err
	}
	dialer := d.Dialer
	if dialer == nil {
		dialer = &net.Dialer{Timeout: 10 * time.Second}
	}
	if ip := net.ParseIP(host); ip != nil {
		return dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
	}
	resolve := d.Resolve
	if resolve == nil {
		resolve = DefaultResolver
	}
	ips, err := resolve(ctx, host)
	if err != nil {
		return nil, fmt.Errorf("resolve webhook host: %w", err)
	}
	if len(ips) == 0 {
		return nil, fmt.Errorf("webhook host resolved to no addresses")
	}
	var lastErr error
	for _, ip := range ips {
		if err := validatePublicIP(ip); err != nil {
			return nil, err
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
	return nil, fmt.Errorf("webhook host resolved to no usable addresses")
}

func validateDialHost(ctx context.Context, host string, resolve Resolver) error {
	u := &url.URL{Scheme: "https", Host: host}
	return validateURLHost(ctx, u, resolve)
}

func parseWebhookURL(rawURL string) (*url.URL, error) {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return nil, fmt.Errorf("url is required")
	}
	u, err := url.Parse(rawURL)
	if err != nil {
		return nil, fmt.Errorf("invalid url")
	}
	if strings.ToLower(u.Scheme) != "https" {
		return nil, fmt.Errorf("webhook url must use https")
	}
	if u.User != nil {
		return nil, fmt.Errorf("webhook url must not include userinfo")
	}
	if u.Hostname() == "" {
		return nil, fmt.Errorf("webhook url host is required")
	}
	return u, nil
}

func normalizedHost(u *url.URL) string {
	return strings.Trim(strings.ToLower(u.Hostname()), "[]")
}

func validateHostname(host string) error {
	switch host {
	case "localhost", "metadata.google.internal":
		return fmt.Errorf("webhook host is not allowed")
	}
	if strings.HasSuffix(host, ".localhost") {
		return fmt.Errorf("webhook host is not allowed")
	}
	return nil
}

func validatePublicIP(ip net.IP) error {
	if ip == nil {
		return fmt.Errorf("invalid webhook host address")
	}
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified() || ip.IsMulticast() {
		return fmt.Errorf("webhook host address is not allowed")
	}
	addr, ok := netip.AddrFromSlice(ip)
	if !ok {
		return fmt.Errorf("invalid webhook host address")
	}
	addr = addr.Unmap()
	for _, prefix := range blockedWebhookIPRanges {
		if prefix.Contains(addr) {
			return fmt.Errorf("webhook host address is not allowed")
		}
	}
	return nil
}

var blockedWebhookIPRanges = mustParseWebhookIPPrefixes([]string{
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

func mustParseWebhookIPPrefixes(raw []string) []netip.Prefix {
	prefixes := make([]netip.Prefix, 0, len(raw))
	for _, value := range raw {
		prefixes = append(prefixes, netip.MustParsePrefix(value))
	}
	return prefixes
}
