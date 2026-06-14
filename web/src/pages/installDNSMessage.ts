import type { InstallDNSCheckResult } from '../api';
import type { useText } from '../locales';

export function installDNSMessage(result: InstallDNSCheckResult, text: ReturnType<typeof useText>) {
  if (result.verified) return text.install.dnsPassed;
  if (result.message && result.message !== 'DNS records are not ready yet') return result.message;
  return text.install.dnsNotReady;
}
