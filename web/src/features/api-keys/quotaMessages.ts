import type { useText } from '../../locales';
import type { MailboxStats, User } from './types';

type Text = ReturnType<typeof useText>;

export type ApiKeyMailboxNotice = {
  key: 'public-domain-requirement' | 'public-mailbox-quota';
  tone: 'info' | 'warning';
  message: string;
};

export function buildApiKeyHelperMessages(text: Text, user: User, stats?: MailboxStats) {
  const messages = [
    user.role === 'admin' ? text.apiKeys.adminDesc : text.apiKeys.userDesc,
    text.apiKeys.quotaScopeDesc
  ];
  const limit = apiKeyPublicMailboxDailyLimit(stats);

  if (stats?.require_public_domain) {
    messages.push(
      stats.has_public_domain
        ? text.apiKeys.requirePublicDomainReadyShort
        : text.apiKeys.requirePublicDomainMissingShort
    );
  }
  if (stats && limit > 0) {
    messages.push(formatPublicMailboxQuota(text.apiKeys.publicMailboxQuotaUsageShort, stats.public_mailbox_today, limit));
  }
  return messages;
}

export function buildApiKeyCreatedNotices(text: Text, stats?: MailboxStats): ApiKeyMailboxNotice[] {
  if (!stats) return [];

  const notices: ApiKeyMailboxNotice[] = [];
  const limit = apiKeyPublicMailboxDailyLimit(stats);

  if (stats.require_public_domain) {
    notices.push({
      key: 'public-domain-requirement',
      tone: stats.has_public_domain ? 'info' : 'warning',
      message: stats.has_public_domain
        ? text.apiKeys.requirePublicDomainReady
        : text.apiKeys.requirePublicDomainMissing
    });
  }
  if (limit > 0) {
    notices.push({
      key: 'public-mailbox-quota',
      tone: 'info',
      message: formatPublicMailboxQuota(text.apiKeys.publicMailboxQuotaUsage, stats.public_mailbox_today, limit)
    });
  }

  return notices;
}

function apiKeyPublicMailboxDailyLimit(stats?: MailboxStats) {
  return stats?.api_key_public_mailbox_daily_limit ?? stats?.public_mailbox_daily_limit ?? 0;
}

function formatPublicMailboxQuota(template: string, today: number, limit: number) {
  return template
    .replace('{today}', String(today))
    .replace('{limit}', String(limit));
}
