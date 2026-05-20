import { Inbox, ShieldAlert } from 'lucide-react';
import type { MailboxStats } from '../../api';
import type { InboxText } from './types';

type MailboxStatsBarProps = {
  text: InboxText;
  stats?: MailboxStats;
};

export function MailboxStatsBar({ text, stats }: MailboxStatsBarProps) {
  if (!stats) return null;

  return (
    <div className="grid gap-1 rounded-lg border border-[var(--border)] bg-[var(--soft)] p-3 text-sm">
      <div className="flex items-center gap-2">
        <Inbox size={14} className="text-[var(--muted)]" />
        <span>
          {stats.public_mailbox_daily_limit > 0
            ? text.inbox.publicMailboxStats
                .replace('{today}', String(stats.public_mailbox_today))
                .replace('{dailyLimit}', String(stats.public_mailbox_daily_limit))
                .replace('{total}', String(stats.public_mailbox_created))
            : text.inbox.publicMailboxNoLimit
                .replace('{today}', String(stats.public_mailbox_today))
                .replace('{total}', String(stats.public_mailbox_created))
          }
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Inbox size={14} className="text-[var(--muted)]" />
        <span>{text.inbox.privateMailboxStats.replace('{total}', String(stats.private_mailbox_created))}</span>
      </div>
      {stats.require_public_domain && !stats.has_public_domain && (
        <div className="flex items-center gap-2 text-[var(--bad)]">
          <ShieldAlert size={14} />
          <span>{text.inbox.requirePublicDomainHint}</span>
        </div>
      )}
    </div>
  );
}
