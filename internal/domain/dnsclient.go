package domain

import (
	"context"
	"fmt"
	"sort"
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
	targets := resolverTargets(options.Resolvers)
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

func resolverTargets(resolvers []string) []resolverTarget {
	seen := map[string]bool{}
	targets := make([]resolverTarget, 0, len(resolvers))
	for _, resolver := range resolvers {
		address := normalizeResolverAddress(resolver)
		if address == "" || seen[address] {
			continue
		}
		seen[address] = true
		targets = append(targets, resolverTarget{
			source:  resolverLabel(address),
			address: address,
		})
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
	value = strings.TrimSpace(strings.TrimSuffix(value, "."))
	if value == "" {
		return ""
	}
	if strings.Contains(value, ":") {
		return value
	}
	return value + ":53"
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
		for _, resolver := range resolverTargets(options.Resolvers) {
			records, err := queryNS(ctx, resolver.address, domainName, options.Timeout)
			if err != nil {
				continue
			}
			for _, record := range records {
				address := normalizeResolverAddress(record)
				if address == "" || seen[address] {
					continue
				}
				seen[address] = true
				out = append(out, address)
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
	resolver = normalizeResolverAddress(resolver)
	if resolver == "" {
		return nil, fmt.Errorf("empty resolver")
	}
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
