package domain

import (
	"context"
	"fmt"
	"net"
	"net/netip"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/miekg/dns"
)

type DNSProbeRunner interface {
	CheckMX(ctx context.Context, host string, expectedMX string, options CheckOptions) (CheckResult, error)
}

type CheckOptions struct {
	Resolvers     []string
	Timeout       time.Duration
	MaxConcurrent int
	StrictMX      bool
}

type MiekgDNSProbeRunner struct{}

var dnsLookupIP = func(ctx context.Context, host string) ([]net.IP, error) {
	return net.DefaultResolver.LookupIP(ctx, "ip", host)
}

func DefaultCheckOptions() CheckOptions {
	return CheckOptions{
		Resolvers: []string{
			"1.1.1.1:53",
			"8.8.8.8:53",
			"223.5.5.5:53",
		},
		Timeout:       3500 * time.Millisecond,
		MaxConcurrent: 5,
	}
}

func (r MiekgDNSProbeRunner) CheckMX(ctx context.Context, host string, expectedMX string, options CheckOptions) (CheckResult, error) {
	options = normalizeCheckOptions(options)
	host = NormalizeDomain(host)
	expectedMX = strings.TrimSuffix(strings.ToLower(strings.TrimSpace(expectedMX)), ".")
	targets := resolverTargets(ctx, options.Resolvers, options.Timeout)
	for _, ns := range r.lookupAuthorityServers(ctx, host, options) {
		targets = append(targets, resolverTarget{
			source:        "Authoritative DNS",
			address:       ns,
			authoritative: true,
		})
	}

	probes := r.runMXProbes(ctx, targets, host, expectedMX, options)
	propagation := classifyPropagation(probes)
	return CheckResult{
		Domain:     host,
		MXVerified: propagation.verified,
		DNSStatus:  propagation.status,
		MXRecords:  propagation.records,
		DNSChecks:  probes,
		CheckMessage: buildCheckMessage(CheckResult{
			Domain:     host,
			MXVerified: propagation.verified,
			DNSStatus:  propagation.status,
			MXRecords:  propagation.records,
			DNSChecks:  probes,
		}, expectedMX),
	}, nil
}

func normalizeCheckOptions(options CheckOptions) CheckOptions {
	defaults := DefaultCheckOptions()
	if len(options.Resolvers) == 0 {
		options.Resolvers = defaults.Resolvers
	}
	if options.Timeout <= 0 {
		options.Timeout = defaults.Timeout
	}
	if options.MaxConcurrent <= 0 {
		options.MaxConcurrent = defaults.MaxConcurrent
	}
	if options.MaxConcurrent > len(options.Resolvers)+20 {
		options.MaxConcurrent = len(options.Resolvers) + 20
	}
	if options.MaxConcurrent < 1 {
		options.MaxConcurrent = 1
	}
	return options
}

func resolverTargets(ctx context.Context, resolvers []string, timeout time.Duration) []resolverTarget {
	return resolverTargetsWithSource(ctx, resolvers, timeout, "", false)
}

func resolverTargetsWithSource(ctx context.Context, resolvers []string, timeout time.Duration, source string, authoritative bool) []resolverTarget {
	seen := map[string]bool{}
	targets := make([]resolverTarget, 0, len(resolvers))
	for _, resolver := range resolvers {
		address := normalizeResolverAddress(resolver)
		if address == "" {
			continue
		}
		endpoints, err := publicDNSEndpoints(ctx, address, timeout)
		if err != nil {
			continue
		}
		label := source
		if label == "" {
			label = resolverLabel(address)
		}
		for _, endpoint := range endpoints {
			if seen[endpoint] {
				continue
			}
			seen[endpoint] = true
			targets = append(targets, resolverTarget{
				source:        label,
				address:       endpoint,
				authoritative: authoritative,
			})
		}
	}
	return targets
}

func resolverLabel(address string) string {
	host := strings.TrimSuffix(address, ":53")
	switch host {
	case "1.1.1.1":
		return "Cloudflare 1.1.1.1"
	case "8.8.8.8":
		return "Google 8.8.8.8"
	case "223.5.5.5":
		return "AliDNS 223.5.5.5"
	default:
		return "Resolver " + host
	}
}

func normalizeResolverAddress(value string) string {
	endpoint, err := parseResolverEndpoint(value)
	if err != nil {
		return ""
	}
	return net.JoinHostPort(endpoint.host, endpoint.port)
}

func (r MiekgDNSProbeRunner) runMXProbes(ctx context.Context, targets []resolverTarget, host, expectedMX string, options CheckOptions) []DNSProbe {
	if len(targets) == 0 {
		return nil
	}
	limit := options.MaxConcurrent
	if limit > len(targets) {
		limit = len(targets)
	}
	work := make(chan resolverTarget)
	results := make(chan DNSProbe, len(targets))
	var wg sync.WaitGroup
	for i := 0; i < limit; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for target := range work {
				results <- r.lookupMXProbe(ctx, target, host, expectedMX, options)
			}
		}()
	}
sendLoop:
	for _, target := range targets {
		select {
		case <-ctx.Done():
			break sendLoop
		case work <- target:
		}
	}
	close(work)
	wg.Wait()
	close(results)

	probes := make([]DNSProbe, 0, len(targets))
	for probe := range results {
		probes = append(probes, probe)
	}
	sort.SliceStable(probes, func(i, j int) bool {
		if probes[i].Authoritative != probes[j].Authoritative {
			return !probes[i].Authoritative
		}
		return probes[i].Source < probes[j].Source
	})
	return probes
}

func (r MiekgDNSProbeRunner) lookupMXProbe(ctx context.Context, target resolverTarget, host, expectedMX string, options CheckOptions) DNSProbe {
	probe := DNSProbe{
		Source:        target.source,
		Resolver:      target.address,
		Authoritative: target.authoritative,
	}
	records, err := r.queryMX(ctx, target.address, host, target.authoritative, options.Timeout)
	if err != nil {
		probe.Error = friendlyDNSError(err)
		return probe
	}
	probe.MXRecords = records
	for _, record := range records {
		if strings.TrimSuffix(strings.ToLower(record), ".") == expectedMX {
			probe.Verified = true
			break
		}
	}
	if options.StrictMX && len(records) != 1 {
		probe.Verified = false
	}
	return probe
}

func (r MiekgDNSProbeRunner) queryMX(ctx context.Context, resolver string, host string, authoritative bool, timeout time.Duration) ([]string, error) {
	msg, err := exchangeDNS(ctx, resolver, host, dns.TypeMX, authoritative, timeout)
	if err != nil {
		return nil, err
	}
	records := make([]string, 0)
	for _, answer := range msg.Answer {
		if mx, ok := answer.(*dns.MX); ok {
			records = append(records, strings.TrimSuffix(strings.ToLower(mx.Mx), "."))
		}
	}
	return records, nil
}

func (r MiekgDNSProbeRunner) lookupAuthorityServers(ctx context.Context, host string, options CheckOptions) []string {
	seen := map[string]bool{}
	out := make([]string, 0)
	for _, domainName := range authorityCandidates(host) {
		for _, resolver := range resolverTargets(ctx, options.Resolvers, options.Timeout) {
			records, err := queryNS(ctx, resolver.address, domainName, options.Timeout)
			if err != nil {
				continue
			}
			for _, target := range resolverTargetsWithSource(ctx, records, options.Timeout, "Authoritative DNS", true) {
				if seen[target.address] {
					continue
				}
				seen[target.address] = true
				out = append(out, target.address)
			}
		}
		if len(out) > 0 {
			return out
		}
	}
	return out
}

func authorityCandidates(host string) []string {
	parts := strings.Split(NormalizeDomain(host), ".")
	candidates := make([]string, 0, len(parts))
	for i := 0; i < len(parts)-1; i++ {
		candidates = append(candidates, strings.Join(parts[i:], "."))
	}
	return candidates
}

func queryNS(ctx context.Context, resolver string, host string, timeout time.Duration) ([]string, error) {
	msg, err := exchangeDNS(ctx, resolver, host, dns.TypeNS, false, timeout)
	if err != nil {
		return nil, err
	}
	records := make([]string, 0)
	for _, answer := range msg.Answer {
		if ns, ok := answer.(*dns.NS); ok {
			records = append(records, strings.TrimSuffix(strings.ToLower(ns.Ns), "."))
		}
	}
	return records, nil
}

func exchangeDNS(ctx context.Context, resolver string, host string, qtype uint16, authoritative bool, timeout time.Duration) (*dns.Msg, error) {
	endpoints, err := publicDNSEndpoints(ctx, resolver, timeout)
	if err != nil {
		return nil, err
	}
	if len(endpoints) == 0 {
		return nil, fmt.Errorf("dns resolver resolved to no usable public addresses")
	}
	var lastErr error
	for _, endpoint := range endpoints {
		resp, err := exchangeDNSAtEndpoint(ctx, endpoint, host, qtype, authoritative, timeout)
		if err == nil {
			return resp, nil
		}
		lastErr = err
	}
	if lastErr != nil {
		return nil, lastErr
	}
	return nil, fmt.Errorf("dns resolver resolved to no usable public addresses")
}

func exchangeDNSAtEndpoint(ctx context.Context, resolver string, host string, qtype uint16, authoritative bool, timeout time.Duration) (*dns.Msg, error) {
	msg := new(dns.Msg)
	msg.SetQuestion(dns.Fqdn(host), qtype)
	msg.RecursionDesired = !authoritative

	lookupCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	client := &dns.Client{Net: "udp", Timeout: timeout}
	resp, _, err := client.ExchangeContext(lookupCtx, msg, resolver)
	if err == nil && resp != nil && !resp.Truncated {
		return dnsResponseOrError(resp)
	}

	tcpClient := &dns.Client{Net: "tcp", Timeout: timeout}
	resp, _, tcpErr := tcpClient.ExchangeContext(lookupCtx, msg, resolver)
	if tcpErr != nil {
		if err != nil {
			return nil, err
		}
		return nil, tcpErr
	}
	return dnsResponseOrError(resp)
}

type resolverEndpoint struct {
	host string
	port string
}

func parseResolverEndpoint(value string) (resolverEndpoint, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return resolverEndpoint{}, fmt.Errorf("empty resolver")
	}
	if strings.HasSuffix(value, ".") {
		value = strings.TrimSuffix(value, ".")
	}
	if host, port, err := net.SplitHostPort(value); err == nil {
		return cleanResolverEndpoint(host, port)
	}
	host := strings.Trim(value, "[]")
	if addr, err := netip.ParseAddr(host); err == nil {
		return resolverEndpoint{host: addr.String(), port: "53"}, nil
	}
	if strings.Contains(value, ":") {
		return resolverEndpoint{}, fmt.Errorf("invalid resolver address")
	}
	return cleanResolverEndpoint(value, "53")
}

func cleanResolverEndpoint(host, port string) (resolverEndpoint, error) {
	host = strings.TrimSpace(strings.Trim(host, "[]"))
	host = strings.TrimSuffix(strings.ToLower(host), ".")
	if host == "" {
		return resolverEndpoint{}, fmt.Errorf("empty resolver host")
	}
	port = strings.TrimSpace(port)
	n, err := strconv.Atoi(port)
	if err != nil || n < 1 || n > 65535 {
		return resolverEndpoint{}, fmt.Errorf("invalid resolver port")
	}
	return resolverEndpoint{host: host, port: strconv.Itoa(n)}, nil
}

func publicDNSEndpoints(ctx context.Context, resolver string, timeout time.Duration) ([]string, error) {
	endpoint, err := parseResolverEndpoint(resolver)
	if err != nil {
		return nil, err
	}
	if blockedDNSHostname(endpoint.host) {
		return nil, fmt.Errorf("dns resolver host is not allowed")
	}
	if ip := net.ParseIP(endpoint.host); ip != nil {
		addr, err := publicDNSAddr(ip)
		if err != nil {
			return nil, err
		}
		return []string{net.JoinHostPort(addr.String(), endpoint.port)}, nil
	}
	lookupCtx := ctx
	cancel := func() {}
	if timeout > 0 {
		lookupCtx, cancel = context.WithTimeout(ctx, timeout)
	}
	defer cancel()

	ips, err := dnsLookupIP(lookupCtx, endpoint.host)
	if err != nil {
		return nil, fmt.Errorf("resolve dns resolver host: %w", err)
	}
	seen := map[netip.Addr]bool{}
	out := make([]string, 0, len(ips))
	for _, ip := range ips {
		addr, err := publicDNSAddr(ip)
		if err != nil {
			continue
		}
		if seen[addr] {
			continue
		}
		seen[addr] = true
		out = append(out, net.JoinHostPort(addr.String(), endpoint.port))
	}
	sort.Strings(out)
	if len(out) == 0 {
		return nil, fmt.Errorf("dns resolver resolved to no usable public addresses")
	}
	return out, nil
}

func blockedDNSHostname(host string) bool {
	switch host {
	case "localhost", "metadata.google.internal":
		return true
	}
	return strings.HasSuffix(host, ".localhost")
}

func publicDNSAddr(ip net.IP) (netip.Addr, error) {
	if ip == nil {
		return netip.Addr{}, fmt.Errorf("invalid dns resolver address")
	}
	addr, ok := netip.AddrFromSlice(ip)
	if !ok {
		return netip.Addr{}, fmt.Errorf("invalid dns resolver address")
	}
	addr = addr.Unmap()
	if !addr.IsGlobalUnicast() {
		return netip.Addr{}, fmt.Errorf("dns resolver address is not allowed")
	}
	for _, prefix := range blockedDNSResolverIPRanges {
		if prefix.Contains(addr) {
			return netip.Addr{}, fmt.Errorf("dns resolver address is not allowed")
		}
	}
	return addr, nil
}

var blockedDNSResolverIPRanges = mustParseDNSResolverIPPrefixes([]string{
	"0.0.0.0/8",
	"10.0.0.0/8",
	"100.64.0.0/10",
	"127.0.0.0/8",
	"169.254.0.0/16",
	"172.16.0.0/12",
	"192.0.0.0/24",
	"192.0.2.0/24",
	"192.88.99.0/24",
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
	"64:ff9b:1::/48",
	"100::/64",
	"2001::/23",
	"2001:2::/48",
	"2001:db8::/32",
	"2002::/16",
	"fc00::/7",
	"fe80::/10",
	"ff00::/8",
})

func mustParseDNSResolverIPPrefixes(raw []string) []netip.Prefix {
	prefixes := make([]netip.Prefix, 0, len(raw))
	for _, value := range raw {
		prefixes = append(prefixes, netip.MustParsePrefix(value))
	}
	return prefixes
}

func dnsResponseOrError(resp *dns.Msg) (*dns.Msg, error) {
	if resp == nil {
		return nil, fmt.Errorf("empty dns response")
	}
	switch resp.Rcode {
	case dns.RcodeSuccess, dns.RcodeNameError:
		return resp, nil
	default:
		return nil, fmt.Errorf("dns rcode %s", dns.RcodeToString[resp.Rcode])
	}
}
