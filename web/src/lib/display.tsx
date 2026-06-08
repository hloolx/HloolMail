import type { MouseEvent } from 'react';
import { Check, Copy as CopyIcon } from 'lucide-react';
import type { Domain, MessageSummary } from '../api';
import { useCopyState } from '../hooks/useCopyState';
import { copy as copyText } from './clipboard';
import { currentText, useText } from '../locales';
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

type CodeExtractableMessage = {
  subject?: string | null;
  verification_code?: string | null;
  preview?: string | null;
  text_content?: string | null;
  html_content?: string | null;
};

type CodeCandidate = {
  value: string;
  score: number;
  priority: number;
  sourceOrder: number;
  index: number;
};

const strongCodeKeywords = [
  '验证码',
  '驗證碼',
  '校验码',
  '校驗碼',
  '动态码',
  '動態碼',
  '短信码',
  '安全码',
  '认证码',
  '認證碼',
  '登录码',
  '登入碼',
  '确认码',
  '確認碼',
  '認証コード',
  '인증 코드',
  '인증코드',
  'verification code',
  'security code',
  'login code',
  'auth code',
  'authentication code',
  'confirmation code',
  'confirm code',
  'one-time password',
  'one time password',
  'passcode',
  'otp',
  '2fa',
  'mfa'
];

const weakCodeKeywords = [
  'verification',
  'verify',
  'verified',
  'one-time',
  'one time',
  'code',
  'pin',
  'captcha',
  '校验',
  '验证',
  '驗證',
  '認証',
  '인증'
];

const falsePositiveKeywords = [
  '订单',
  '訂單',
  '订单号',
  '訂單號',
  '单号',
  '單號',
  '运单',
  '運單',
  '快递',
  '物流',
  '发票',
  '發票',
  '手机号',
  '手機號',
  '电话',
  '電話',
  '金额',
  '金額',
  '价格',
  '價格',
  '合计',
  '總計',
  'order',
  'invoice',
  'receipt',
  'tracking',
  'shipment',
  'delivery',
  'phone',
  'mobile',
  'tel',
  'amount',
  'total',
  'price',
  'postal',
  'zip',
  'address',
  'card',
  'issue',
  'pull request',
  'ticket',
  'build',
  'commit'
];

export function extractCode(message: CodeExtractableMessage | Pick<MessageSummary, 'subject' | 'preview'>) {
  const explicitCode = 'verification_code' in message ? normalizeCodeValue(message.verification_code || '') : '';
  if (explicitCode && isCodeShape(explicitCode)) return explicitCode;
  return extractCodeCandidates(message)[0]?.value;
}

export function VerificationCodeCopyButton({ code, compact = false, className = '' }: { code: string; compact?: boolean; className?: string }) {
  const text = useText();
  const [copied, markCopied] = useCopyState();
  const title = copied ? text.common.copied : text.inbox.copyCode;

  const handleCopy = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    void copyText(code, { event }).then((ok) => {
      if (ok) markCopied();
    });
  };

  return (
    <button
      type="button"
      className={`verification-code-copy ${compact ? 'verification-code-copy-compact' : ''} ${className}`.trim()}
      title={title}
      aria-label={`${title}: ${code}`}
      onClick={handleCopy}
    >
      <span className="verification-code-copy-value">{code}</span>
      {copied ? <Check size={compact ? 13 : 15} /> : <CopyIcon size={compact ? 13 : 15} />}
    </button>
  );
}

function extractCodeCandidates(message: CodeExtractableMessage | Pick<MessageSummary, 'subject' | 'preview'>) {
  const sources = [
    { text: 'verification_code' in message ? message.verification_code : '', weight: 36 },
    { text: message.subject, weight: 22 },
    { text: message.preview, weight: 14 },
    { text: 'text_content' in message ? message.text_content : '', weight: 6 },
    { text: 'html_content' in message ? stripHtml(message.html_content) : '', weight: 5 }
  ];
  const byValue = new Map<string, CodeCandidate>();

  sources.forEach((source, sourceOrder) => {
    const text = normalizeCodeText(source.text);
    if (!text) return;
    for (const candidate of candidatesFromText(text, source.weight, sourceOrder)) {
      const existing = byValue.get(candidate.value);
      if (!existing || compareCodeCandidates(candidate, existing) < 0) {
        byValue.set(candidate.value, candidate);
      }
    }
  });

  return [...byValue.values()].sort(compareCodeCandidates);
}

function candidatesFromText(text: string, sourceWeight: number, sourceOrder: number) {
  const candidates: CodeCandidate[] = [];
  const seen = new Set<string>();
  const tokenPattern = /(^|[^A-Za-z0-9])([A-Za-z0-9]{4,10})(?=$|[^A-Za-z0-9])/g;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(text)) !== null) {
    const value = match[2];
    const index = match.index + match[1].length;
    pushCandidate(candidates, seen, text, value, index, sourceWeight, sourceOrder);
  }

  const separatedDigitsPattern = /(^|[^A-Za-z0-9])((?:\d[\s-]*){4,8})(?=$|[^A-Za-z0-9])/g;
  while ((match = separatedDigitsPattern.exec(text)) !== null) {
    const raw = match[2].trim();
    const value = raw.replace(/\D/g, '');
    if (value.length >= 4 && value.length <= 8 && raw !== value) {
      const index = match.index + match[1].length;
      pushCandidate(candidates, seen, text, value, index, sourceWeight - 1, sourceOrder);
    }
  }

  return candidates;
}

function pushCandidate(candidates: CodeCandidate[], seen: Set<string>, text: string, value: string, index: number, sourceWeight: number, sourceOrder: number) {
  if (seen.has(`${value}:${index}`)) return;
  if (!isCodeShape(value)) return;
  if (isLikelyFalsePositive(text, value, index)) return;

  const numeric = /^\d+$/.test(value);
  const keywordScore = keywordBoost(text, value, index);
  const lengthScore = numeric ? numericLengthScore(value) : alphaNumericLengthScore(value);
  const priority = numeric ? 1 : 0;
  const score = (numeric ? 120 : 72) + sourceWeight + lengthScore + keywordScore;
  candidates.push({ value, score, priority, sourceOrder, index });
  seen.add(`${value}:${index}`);
}

function isCodeShape(value: string) {
  if (!/^[A-Za-z0-9]+$/.test(value) || !/\d/.test(value)) return false;
  if (/^\d+$/.test(value)) return value.length >= 4 && value.length <= 8;
  return value.length >= 4 && value.length <= 12;
}

function isLikelyFalsePositive(text: string, value: string, index: number) {
  const numeric = /^\d+$/.test(value);
  const positiveDistance = nearestKeywordDistance(text, index, value.length, [...strongCodeKeywords, ...weakCodeKeywords]);
  const falsePositiveDistance = nearestKeywordDistance(text, index, value.length, falsePositiveKeywords);
  if (numeric && isYear(value)) return true;
  if (numeric && isYYYYMMDD(value)) return true;
  if (numeric && isPartOfLongSeparatedNumber(text, index, value.length)) return true;
  if (falsePositiveDistance <= 32 && positiveDistance > falsePositiveDistance) return true;
  return false;
}

function keywordBoost(text: string, value: string, index: number) {
  const strongDistance = nearestKeywordDistance(text, index, value.length, strongCodeKeywords);
  const weakDistance = nearestKeywordDistance(text, index, value.length, weakCodeKeywords);
  return proximityScore(strongDistance, 92) + proximityScore(weakDistance, 52);
}

function proximityScore(distance: number, strength: number) {
  if (!Number.isFinite(distance)) return 0;
  if (distance <= 12) return strength;
  if (distance <= 36) return Math.round(strength * 0.72);
  if (distance <= 80) return Math.round(strength * 0.38);
  return 0;
}

function nearestKeywordDistance(text: string, index: number, length: number, keywords: string[]) {
  const lower = text.toLowerCase();
  let nearest = Number.POSITIVE_INFINITY;
  for (const keyword of keywords) {
    let from = 0;
    const needle = keyword.toLowerCase();
    while (from < lower.length) {
      const found = lower.indexOf(needle, from);
      if (found === -1) break;
      const keywordEnd = found + needle.length;
      const distance = index > keywordEnd ? index - keywordEnd : found > index + length ? found - (index + length) : 0;
      nearest = Math.min(nearest, distance);
      from = found + Math.max(1, needle.length);
    }
  }
  return nearest;
}

function numericLengthScore(value: string) {
  if (value.length === 6) return 26;
  if (value.length === 4 || value.length === 5) return 16;
  return 10;
}

function alphaNumericLengthScore(value: string) {
  if (value.length >= 6 && value.length <= 8) return 12;
  return 6;
}

function compareCodeCandidates(left: CodeCandidate, right: CodeCandidate) {
  if (left.priority !== right.priority) return right.priority - left.priority;
  if (left.score !== right.score) return right.score - left.score;
  if (left.sourceOrder !== right.sourceOrder) return left.sourceOrder - right.sourceOrder;
  return left.index - right.index;
}

function isYear(value: string) {
  if (!/^\d{4}$/.test(value)) return false;
  const year = Number(value);
  return year >= 1900 && year <= 2099;
}

function isYYYYMMDD(value: string) {
  if (!/^(19|20)\d{6}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isPartOfLongSeparatedNumber(text: string, index: number, length: number) {
  const start = Math.max(0, index - 16);
  const end = Math.min(text.length, index + length + 16);
  const compactDigits = text.slice(start, end).replace(/[\s().+-]/g, '').match(/\d{9,}/);
  return Boolean(compactDigits);
}

function stripHtml(value?: string | null) {
  if (!value) return '';
  return decodeHtmlEntities(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/(p|div|li|tr|td|th|h[1-6])>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  );
}

function decodeHtmlEntities(value: string) {
  return value.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, body: string) => {
    const lower = body.toLowerCase();
    if (lower === 'amp') return '&';
    if (lower === 'lt') return '<';
    if (lower === 'gt') return '>';
    if (lower === 'quot') return '"';
    if (lower === 'apos') return "'";
    if (lower === 'nbsp') return ' ';
    if (lower.startsWith('#x')) return codePointToString(Number.parseInt(lower.slice(2), 16), entity);
    if (lower.startsWith('#')) return codePointToString(Number.parseInt(lower.slice(1), 10), entity);
    return entity;
  });
}

function codePointToString(codePoint: number, fallback: string) {
  return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : fallback;
}

function normalizeCodeText(value?: string | null) {
  return decodeHtmlEntities(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeCodeValue(value: string) {
  return value.trim().replace(/-/g, '');
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
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ${text.time.daysAgo}`;
  if (days < 30) return `${Math.floor(days / 7)} ${text.time.weeksAgo}`;
  if (days < 365) return `${Math.floor(days / 30)} ${text.time.monthsAgo}`;
  return `${Math.floor(days / 365)} ${text.time.yearsAgo}`;
}
