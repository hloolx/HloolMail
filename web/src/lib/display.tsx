import type { Domain, MessageSummary } from '../api';
import { currentText } from '../locales';
import type { Language } from '../store';

export function boolBadge(value?: boolean) {
  const text = currentText();
  return <span className={`status-dot ${value ? 'status-dot-ok' : 'status-dot-bad'}`}>{value ? text.common.yes : text.common.no}</span>;
}

export function domainModeLabel(mode: Domain['mode'], language?: Language) {
  const text = currentText(language);
  return mode === 'public' ? text.domains.modePublic : text.domains.modePrivate;
}

export function domainStatusLabel(domain: Domain, language?: Language) {
  const text = currentText(language);
  if (!domain.active) return text.domains.statusInactive;
  if (domain.mx_verified) return text.domains.statusMxVerified;
  if (domain.last_check_message) return domain.last_check_message;
  return domain.last_mx_check_at ? text.domains.statusMxPending : text.domains.statusPendingCheck;
}

export function domainStatusBadge(domain: Domain, language?: Language) {
  const ok = domain.active && domain.mx_verified;
  return (
    <span className={`status-dot ${ok ? 'status-dot-ok' : 'status-dot-bad'}`} title={domain.last_check_message || domain.last_mx_records || undefined}>
      {domainStatusLabel(domain, language)}
    </span>
  );
}

export function formatDomainExpiry(value?: string, language?: Language) {
  const text = currentText(language);
  if (!value) return text.domains.expiryPendingRefresh;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return text.domains.expiryUnknown;
  const locale = language === 'en-US' ? 'en-US' : 'zh-CN';
  return date.toLocaleDateString(locale);
}

export function formatAPIKeyExpiry(value?: string, language?: Language) {
  const text = currentText(language);
  if (!value) return text.apiKeys.unlimitedShort;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const locale = language === 'en-US' ? 'en-US' : 'zh-CN';
  const formatted = date.toLocaleString(locale);
  return date.getTime() <= Date.now() ? `${text.apiKeys.expired} ${formatted}` : formatted;
}

export function extractCode(message: Pick<MessageSummary, 'subject' | 'preview'> | { subject?: string; preview?: string; text_content?: string }) {
  const body = 'text_content' in message ? message.text_content || '' : '';
  const text = `${message.subject || ''} ${message.preview || ''} ${body}`;
  return text.match(/\b(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{4,10}\b/)?.[0];
}

export function relativeTime(value?: string) {
  const text = currentText();
  if (!value) return '-';
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.floor(diff / 60000));
  if (minutes < 1) return text.time.justNow;
  if (minutes < 60) return `${minutes} ${text.time.minutesAgo}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${text.time.hoursAgo}`;
  return `${Math.floor(hours / 24)} ${text.time.daysAgo}`;
}
