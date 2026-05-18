package domain

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"strings"
	"time"

	"gptmail/internal/config"
	"gptmail/internal/models"

	"gorm.io/gorm"
)

type DNSChecker struct {
	DB          *gorm.DB
	Config      config.Config
	ProbeRunner DNSProbeRunner
}

type DNSInstructions struct {
	MX         DNSRecord `json:"mx"`
	WildcardMX DNSRecord `json:"wildcard_mx"`
}

type DNSRecord struct {
	Type     string `json:"type"`
	Name     string `json:"name"`
	Priority int    `json:"priority,omitempty"`
	Value    string `json:"value"`
}

type CheckResult struct {
	Domain            string     `json:"domain"`
	MXVerified        bool       `json:"mx_verified"`
	DNSStatus         string     `json:"dns_status"`
	WildcardChecked   bool       `json:"wildcard_checked"`
	WildcardEnabled   bool       `json:"wildcard_enabled"`
	MXRecords         []string   `json:"mx_records"`
	DNSChecks         []DNSProbe `json:"dns_checks"`
	WildcardDNSChecks []DNSProbe `json:"wildcard_dns_checks,omitempty"`
	NSRecords         []string   `json:"ns_records,omitempty"`
	ARecords          []string   `json:"a_records,omitempty"`
	CheckMessage      string     `json:"check_message"`
	DomainExpiresAt   *time.Time `json:"domain_expires_at,omitempty"`
}

type DNSProbe struct {
	Source        string   `json:"source"`
	Resolver      string   `json:"resolver,omitempty"`
	Authoritative bool     `json:"authoritative"`
	Verified      bool     `json:"verified"`
	MXRecords     []string `json:"mx_records,omitempty"`
	Error         string   `json:"error,omitempty"`
}

const (
	DNSStatusVerified      = "verified"
	DNSStatusPropagating   = "propagating"
	DNSStatusMisconfigured = "misconfigured"
	DNSStatusNotFound      = "not_found"
	DNSStatusError         = "error"
)

var ErrVerificationToken = errors.New("verification token generation failed")

type resolverTarget struct {
	source        string
	address       string
	authoritative bool
}

var verificationRandReader io.Reader = rand.Reader

func NewVerificationToken() (string, error) {
	buf := make([]byte, 24)
	if _, err := io.ReadFull(verificationRandReader, buf); err != nil {
		return "", fmt.Errorf("%w: %v", ErrVerificationToken, err)
	}
	return hex.EncodeToString(buf), nil
}

func Instructions(domainName, expectedMX string) DNSInstructions {
	return DNSInstructions{
		MX: DNSRecord{
			Type:     "MX",
			Name:     "@",
			Priority: 10,
			Value:    ensureDot(expectedMX),
		},
		WildcardMX: DNSRecord{
			Type:     "MX",
			Name:     "*",
			Priority: 10,
			Value:    ensureDot(expectedMX),
		},
	}
}

func (c DNSChecker) Check(ctx context.Context, domainName string) (CheckResult, error) {
	domainName = NormalizeDomain(domainName)
	var d models.Domain
	if err := c.DB.Where("domain = ?", domainName).First(&d).Error; err != nil {
		return CheckResult{}, err
	}
	result := c.lookupWithOptions(ctx, d, c.defaultCheckOptions())
	if c.Config.DevMode && strings.HasSuffix(domainName, ".test") {
		result.MXVerified = true
		result.DNSStatus = DNSStatusVerified
		if d.WildcardRequested || d.WildcardEnabled {
			result.WildcardEnabled = true
			result.WildcardChecked = true
		}
		result.CheckMessage = "开发模式下 .test 域名已自动标记为通过"
	}
	if expiresAt, err := LookupDomainExpiry(ctx, domainName); err == nil {
		result.DomainExpiresAt = expiresAt
	} else if result.CheckMessage == "" {
		result.CheckMessage = "MX 检查完成，但暂时无法查询域名到期时间：" + friendlyDNSError(err)
	}
	if result.CheckMessage == "" {
		result.CheckMessage = buildCheckMessage(result, c.Config.ExpectedMX)
	}
	if err := c.persistCheckResult(d, result); err != nil {
		return result, err
	}
	return result, nil
}

func (c DNSChecker) lookup(ctx context.Context, d models.Domain) CheckResult {
	return c.lookupWithOptions(ctx, d, c.defaultCheckOptions())
}

func (c DNSChecker) CheckWithOptions(ctx context.Context, domainName string, options CheckOptions) (CheckResult, error) {
	domainName = NormalizeDomain(domainName)
	var d models.Domain
	if err := c.DB.Where("domain = ?", domainName).First(&d).Error; err != nil {
		return CheckResult{}, err
	}
	return c.CheckDomain(ctx, d, options)
}

func (c DNSChecker) CheckDomain(ctx context.Context, d models.Domain, options CheckOptions) (CheckResult, error) {
	options = c.mergeCheckOptions(options)
	d.Domain = NormalizeDomain(d.Domain)
	result := c.lookupWithOptions(ctx, d, options)
	if c.Config.DevMode && strings.HasSuffix(d.Domain, ".test") {
		result.MXVerified = true
		result.DNSStatus = DNSStatusVerified
		if d.WildcardRequested || d.WildcardEnabled {
			result.WildcardEnabled = true
			result.WildcardChecked = true
		}
		result.CheckMessage = "Dev mode: .test domains are treated as verified"
	}
	if expiresAt, err := LookupDomainExpiry(ctx, d.Domain); err == nil {
		result.DomainExpiresAt = expiresAt
	} else if result.CheckMessage == "" {
		result.CheckMessage = "MX check finished, but domain expiry lookup failed: " + friendlyDNSError(err)
	}
	if result.CheckMessage == "" {
		result.CheckMessage = buildCheckMessage(result, c.Config.ExpectedMX)
	}
	if err := c.persistCheckResult(d, result); err != nil {
		return result, err
	}
	return result, nil
}

func (c DNSChecker) persistCheckResult(d models.Domain, result CheckResult) error {
	now := time.Now()
	updates := map[string]interface{}{
		"mx_verified":        result.MXVerified,
		"wildcard_enabled":   result.WildcardEnabled,
		"last_mx_check_at":   &now,
		"last_mx_records":    strings.Join(result.MXRecords, ", "),
		"last_check_message": result.CheckMessage,
	}
	if result.WildcardChecked {
		updates["wildcard_requested"] = true
	}
	if result.MXVerified && (!result.WildcardChecked || result.WildcardEnabled) {
		updates["last_healthy_at"] = &now
		updates["last_health_status"] = "healthy"
		updates["mx_auto_retry_enabled"] = false
		updates["mx_auto_retry_next_at"] = nil
	} else {
		updates["last_unhealthy_at"] = &now
		updates["last_health_status"] = "unhealthy"
	}
	if result.DomainExpiresAt != nil {
		updates["domain_expires_at"] = result.DomainExpiresAt
	}
	query := c.DB.Model(&models.Domain{})
	if d.ID != 0 {
		query = query.Where("id = ?", d.ID)
	} else {
		query = query.Where("domain = ?", d.Domain)
	}
	return query.Updates(updates).Error
}

func (c DNSChecker) lookupWithOptions(ctx context.Context, d models.Domain, options CheckOptions) CheckResult {
	result := CheckResult{Domain: d.Domain}
	expected := strings.TrimSuffix(strings.ToLower(c.Config.ExpectedMX), ".")
	propagation := c.lookupPropagationWithOptions(ctx, d.Domain, expected, options)
	result.DNSChecks = propagation.probes
	result.MXRecords = propagation.records
	result.MXVerified = propagation.verified
	result.DNSStatus = propagation.status
	if len(result.MXRecords) == 0 {
		result.NSRecords, result.ARecords = lookupPresence(ctx, d.Domain)
	}

	if d.WildcardRequested || d.WildcardEnabled {
		result.WildcardChecked = true
		wildcardHost := "probe-" + d.VerificationToken + "." + d.Domain
		wildcard := c.lookupPropagationWithOptions(ctx, wildcardHost, expected, options)
		result.WildcardDNSChecks = wildcard.probes
		result.WildcardEnabled = wildcard.verified
		if result.MXVerified && !result.WildcardEnabled {
			result.CheckMessage = "根域 MX 已生效，但随机子域名 MX 还在等待生效"
		}
	}
	return result
}

type propagationResult struct {
	status   string
	verified bool
	records  []string
	probes   []DNSProbe
}

func (c DNSChecker) defaultCheckOptions() CheckOptions {
	options := DefaultCheckOptions()
	options.StrictMX = c.Config.MXStrict
	return options
}

func (c DNSChecker) mergeCheckOptions(options CheckOptions) CheckOptions {
	if len(options.Resolvers) == 0 && options.Timeout <= 0 && options.MaxConcurrent <= 0 {
		options = c.defaultCheckOptions()
	}
	options.StrictMX = c.Config.MXStrict || options.StrictMX
	return normalizeCheckOptions(options)
}

func (c DNSChecker) lookupPropagation(ctx context.Context, host, expected string) propagationResult {
	return c.lookupPropagationWithOptions(ctx, host, expected, c.defaultCheckOptions())
}

func (c DNSChecker) lookupPropagationWithOptions(ctx context.Context, host, expected string, options CheckOptions) propagationResult {
	runner := c.ProbeRunner
	if runner == nil {
		runner = MiekgDNSProbeRunner{}
	}
	result, err := runner.CheckMX(ctx, host, expected, options)
	if err != nil {
		return propagationResult{
			status: DNSStatusError,
			probes: []DNSProbe{{
				Source: "DNS",
				Error:  friendlyDNSError(err),
			}},
		}
	}
	return propagationResult{
		status:   result.DNSStatus,
		verified: result.MXVerified,
		records:  result.MXRecords,
		probes:   result.DNSChecks,
	}
}

func (c DNSChecker) lookupPropagationLegacy(ctx context.Context, host, expected string) propagationResult {
	targets := []resolverTarget{
		{source: "服务器默认 DNS"},
		{source: "Cloudflare 1.1.1.1", address: "1.1.1.1"},
		{source: "Google 8.8.8.8", address: "8.8.8.8"},
		{source: "阿里 DNS 223.5.5.5", address: "223.5.5.5"},
	}
	for _, ns := range c.lookupAuthorityServers(ctx, host) {
		targets = append(targets, resolverTarget{source: "权威 DNS", address: ns, authoritative: true})
	}

	probes := make([]DNSProbe, 0, len(targets))
	for _, target := range targets {
		probes = append(probes, c.lookupMXProbe(ctx, target, host, expected))
	}
	return classifyPropagation(probes)
}

func (c DNSChecker) lookupMXProbe(ctx context.Context, target resolverTarget, host, expected string) DNSProbe {
	probe := DNSProbe{
		Source:        target.source,
		Resolver:      target.address,
		Authoritative: target.authoritative,
	}
	resolver := net.DefaultResolver
	if target.address != "" {
		resolver = dnsResolver(target.address)
	}
	lookupCtx, cancel := context.WithTimeout(ctx, 3500*time.Millisecond)
	defer cancel()
	mxRecords, err := resolver.LookupMX(lookupCtx, host)
	if err != nil {
		probe.Error = friendlyDNSError(err)
		return probe
	}
	for _, mx := range mxRecords {
		host := strings.TrimSuffix(strings.ToLower(mx.Host), ".")
		probe.MXRecords = append(probe.MXRecords, host)
		if host == expected {
			probe.Verified = true
		}
	}
	if c.Config.MXStrict && len(mxRecords) != 1 {
		probe.Verified = false
	}
	return probe
}

func (c DNSChecker) lookupAuthorityServers(ctx context.Context, host string) []string {
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	parts := strings.Split(NormalizeDomain(host), ".")
	var domains []string
	for i := 0; i < len(parts)-1; i++ {
		domains = append(domains, strings.Join(parts[i:], "."))
	}
	resolvers := []*net.Resolver{
		net.DefaultResolver,
		dnsResolver("1.1.1.1"),
		dnsResolver("8.8.8.8"),
		dnsResolver("223.5.5.5"),
	}
	seen := map[string]bool{}
	var out []string
	for _, domainName := range domains {
		for _, resolver := range resolvers {
			lookupCtx, cancel := context.WithTimeout(ctx, 2500*time.Millisecond)
			nsRecords, err := resolver.LookupNS(lookupCtx, domainName)
			cancel()
			if err != nil {
				continue
			}
			for _, ns := range nsRecords {
				host := strings.TrimSuffix(strings.ToLower(ns.Host), ".")
				if host == "" || seen[host] {
					continue
				}
				seen[host] = true
				out = append(out, host)
			}
		}
		if len(out) > 0 {
			return out
		}
	}
	return out
}

func dnsResolver(server string) *net.Resolver {
	dialer := &net.Dialer{Timeout: 3500 * time.Millisecond}
	return &net.Resolver{
		PreferGo: true,
		Dial: func(ctx context.Context, network, address string) (net.Conn, error) {
			return dialer.DialContext(ctx, network, net.JoinHostPort(server, "53"))
		},
	}
}

func classifyPropagation(probes []DNSProbe) propagationResult {
	authoritySeen := false
	authorityVerified := false
	authorityHasRecords := false
	recursiveVerified := false
	recursiveHasMismatch := false
	anyRecords := false
	var preferred []string
	for _, probe := range probes {
		if len(probe.MXRecords) > 0 {
			anyRecords = true
			if preferred == nil {
				preferred = probe.MXRecords
			}
		}
		if probe.Authoritative {
			if probe.Error == "" {
				authoritySeen = true
			}
			if len(probe.MXRecords) > 0 && preferred == nil {
				preferred = probe.MXRecords
			}
			if len(probe.MXRecords) > 0 {
				authorityHasRecords = true
			}
			if probe.Verified {
				authorityVerified = true
				preferred = probe.MXRecords
			}
			continue
		}
		if probe.Verified {
			recursiveVerified = true
			if preferred == nil {
				preferred = probe.MXRecords
			}
		}
		if probe.Error == "" && len(probe.MXRecords) > 0 && !probe.Verified {
			recursiveHasMismatch = true
		}
	}
	status := DNSStatusError
	verified := false
	switch {
	case authorityVerified:
		verified = true
		if recursiveHasMismatch {
			status = DNSStatusPropagating
		} else {
			status = DNSStatusVerified
		}
	case authoritySeen && authorityHasRecords:
		status = DNSStatusMisconfigured
	case authoritySeen:
		status = DNSStatusNotFound
	case recursiveVerified:
		verified = true
		status = DNSStatusPropagating
	case anyRecords:
		status = DNSStatusMisconfigured
	default:
		status = DNSStatusNotFound
	}
	return propagationResult{status: status, verified: verified, records: preferred, probes: probes}
}

func lookupPresence(ctx context.Context, domainName string) ([]string, []string) {
	var nsRecords []string
	if records, err := net.DefaultResolver.LookupNS(ctx, domainName); err == nil {
		for _, ns := range records {
			nsRecords = append(nsRecords, strings.TrimSuffix(ns.Host, "."))
		}
	}
	var aRecords []string
	if records, err := net.DefaultResolver.LookupHost(ctx, domainName); err == nil {
		aRecords = append(aRecords, records...)
	}
	return nsRecords, aRecords
}

func mxLookupFailureMessage(err error, result CheckResult, expectedMX string) string {
	if len(result.NSRecords) > 0 || len(result.ARecords) > 0 {
		return fmt.Sprintf("域名 DNS 可以查询到，但没有查询到 MX 记录。请添加 MX 记录：主机记录 @，优先级 10，记录值 %s", expectedMX)
	}
	return "MX 查询失败：" + friendlyDNSError(err)
}

func ensureDot(value string) string {
	value = strings.TrimSpace(value)
	if strings.HasSuffix(value, ".") {
		return value
	}
	return value + "."
}

func buildCheckMessage(result CheckResult, expectedMX string) string {
	expectedMX = strings.TrimSuffix(strings.ToLower(expectedMX), ".")
	if result.MXVerified && result.WildcardChecked && !result.WildcardEnabled {
		return "根域 MX 已生效，但随机子域名 MX 还未生效"
	}
	switch result.DNSStatus {
	case DNSStatusVerified:
		return "MX 已生效，权威 DNS 与公共解析器都已指向收信服务"
	case DNSStatusPropagating:
		if result.MXVerified {
			return "权威 DNS 已生效，部分公共 DNS 仍在传播或缓存旧记录"
		}
		return "部分公共 DNS 已看到正确 MX，但权威 DNS 暂时无法确认，请稍后重试"
	case DNSStatusMisconfigured:
		if len(result.MXRecords) > 0 {
			return fmt.Sprintf("MX 未生效：当前 MX 为 %s，没有指向 %s", strings.Join(result.MXRecords, ", "), expectedMX)
		}
	case DNSStatusNotFound:
		return fmt.Sprintf("MX 未生效：没有查询到 MX 记录。请添加 MX 记录：主机记录 @，优先级 10，记录值 %s", expectedMX)
	case DNSStatusError:
		return "MX 查询失败：服务器暂时无法完成 DNS 查询，请稍后再试"
	}
	if result.MXVerified {
		return "MX 已生效，当前域名可以收信"
	}
	return fmt.Sprintf("MX 未生效：没有查询到指向 %s 的 MX 记录", expectedMX)
}

func friendlyDNSError(err error) string {
	if err == nil {
		return ""
	}
	var dnsErr *net.DNSError
	if errors.As(err, &dnsErr) {
		if dnsErr.IsTimeout {
			return "服务器 DNS 查询超时，请稍后再试，或检查服务器 DNS 解析器是否可用"
		}
		if dnsErr.IsNotFound {
			return "没有查询到对应记录。域名可能还没配置这类 DNS 记录，或解析还没有传播完成"
		}
	}
	text := err.Error()
	if strings.Contains(text, "no such host") {
		return "没有查询到对应记录。域名可能还没配置这类 DNS 记录，或解析还没有传播完成"
	}
	if strings.Contains(text, "i/o timeout") || strings.Contains(text, "timeout") {
		return "服务器 DNS 查询超时，请稍后再试，或检查服务器 DNS 解析器是否可用"
	}
	if strings.Contains(text, "rdap status 404") {
		return "RDAP 没有返回该域名信息，可能是后缀不支持、注册局暂不可用，或域名信息未公开"
	}
	return "查询失败：" + text
}
