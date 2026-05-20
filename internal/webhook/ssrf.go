package webhook

import (
	"context"
	"fmt"
	"net"
	"net/url"
	"strings"
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
	if ip4 := ip.To4(); ip4 != nil {
		if ip4[0] == 169 && ip4[1] == 254 {
			return fmt.Errorf("webhook host address is not allowed")
		}
	}
	return nil
}
