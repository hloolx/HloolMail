import type { InstallDNSCheckResult } from '../api';
import { useText } from '../locales';

export function DNSCheckDetails({ result, text }: { result: InstallDNSCheckResult; text: ReturnType<typeof useText> }) {
  return (
    <div className="install-dns-result">
      <div className={result.verified ? 'install-dns-ok' : 'install-dns-bad'}>{installDNSMessage(result, text)}</div>
      {result.address_check && (
        <DNSLine
          label={text.install.aRecordCheck}
          ok={result.address_check.verified}
          value={result.address_check.addresses?.length ? result.address_check.addresses.join(', ') : result.address_check.error || text.install.noAddrRecords}
        />
      )}
      {result.mx_check && (
        <DNSLine
          label={text.install.rootMXCheck}
          ok={result.mx_check.mx_verified}
          value={result.mx_check.mx_records?.length ? result.mx_check.mx_records.join(', ') : result.mx_check.check_message || text.install.noMXFound}
        />
      )}
      {result.wildcard_check && (
        <DNSLine
          label={text.install.wildcardMXCheck}
          ok={result.wildcard_check.mx_verified}
          value={result.wildcard_check.mx_records?.length ? result.wildcard_check.mx_records.join(', ') : result.wildcard_check.check_message || text.install.noMXFound}
        />
      )}
    </div>
  );
}

function DNSLine({ label, ok, value }: { label: string; ok: boolean; value: string }) {
  return (
    <div className="install-dns-line">
      <span className={ok ? 'install-dot-ok' : 'install-dot-bad'} />
      <strong>{label}</strong>
      <code>{value}</code>
    </div>
  );
}

export function installDNSMessage(result: InstallDNSCheckResult, text: ReturnType<typeof useText>) {
  if (result.verified) return text.install.dnsPassed;
  if (result.message && result.message !== 'DNS records are not ready yet') return result.message;
  return text.install.dnsNotReady;
}
