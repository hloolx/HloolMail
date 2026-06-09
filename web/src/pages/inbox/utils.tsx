import type { Variants } from 'framer-motion';
import type { DomainAvailability, PublicDomainItem } from '../../api';
import { ApiError } from '../../api';
import type { Language } from '../../store';
import { domainModeLabel } from '../../lib/display';

export const MAILBOX_PAGE_SIZE = 8;
export const EMAIL_PAGE_SIZE = 8;
export const MAX_GENERATE_EMAIL_CONFLICT_RETRIES = 3;

export const mailListVariants = (reduce: boolean, itemCount: number): Variants => ({
  hidden: {},
  show: {
    transition: {
      staggerChildren: reduce || itemCount > 40 ? 0 : 0.03
    }
  }
});

export const mailRowVariants = (reduce: boolean): Variants => ({
  hidden: reduce ? { opacity: 0 } : { opacity: 0, y: 8 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: reduce ? 0.08 : 0.22, ease: 'easeOut' }
  }
});

export function domainAvailabilityGroups(data?: DomainAvailability) {
  if (!data) return { publicDomains: [] as PublicDomainItem[], privateDomains: [] as PublicDomainItem[] };
  if (data.public_domains || data.private_domains) {
    return {
      publicDomains: normalizeDomainItems(data.public_domains || []),
      privateDomains: normalizeDomainItems(data.private_domains || [])
    };
  }
  return {
    publicDomains: normalizeDomainItems((data.domains || []).map((domain) => ({ domain, mode: 'public' as const }))),
    privateDomains: [] as PublicDomainItem[]
  };
}

function normalizeDomainItems(domains: PublicDomainItem[]) {
  const seen = new Set<string>();
  const out: PublicDomainItem[] = [];
  domains.forEach((item) => {
    const original = item.domain.trim().toLowerCase();
    const wildcardInput = original.startsWith('*.') || original.startsWith('*');
    const domain = original.replace(/^\*\./, '').replace(/^\*/, '').replace(/\.+$/, '');
    if (!domain || seen.has(domain)) return;
    seen.add(domain);
    out.push({
      ...item,
      domain,
      root_ready: wildcardInput && item.root_ready === undefined ? false : item.root_ready,
      wildcard_ready: wildcardInput && item.wildcard_ready === undefined ? true : item.wildcard_ready,
      wildcard_pattern: item.wildcard_pattern || (wildcardInput ? `*.${domain}` : undefined),
      capabilities: normalizedCapabilities(item.capabilities, wildcardInput)
    });
  });
  return out;
}

function normalizedCapabilities(capabilities: string[] | undefined, wildcardInput: boolean) {
  const set = new Set(capabilities || []);
  if (wildcardInput) set.add('subdomain_mailbox');
  return set.size ? Array.from(set) : undefined;
}

export function renderDomainOptions(domains: PublicDomainItem[], label: string, language: Language) {
  if (!domains.length) return null;
  return (
    <optgroup label={label}>
      {domains.map((domain) => (
        <option key={domain.id ?? domain.domain} value={domain.domain}>
          {domain.domain} - {domainModeLabel(domain.mode, language)}
        </option>
      ))}
    </optgroup>
  );
}

export function formatCount(template: string, count: number) {
  return template.replace('{count}', new Intl.NumberFormat().format(count));
}

export const isConflictError = (error: Error) => error instanceof ApiError && error.status === 409;
