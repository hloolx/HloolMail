import { forwardRef, memo } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown, MailOpen } from 'lucide-react';
import type { MessageSummary } from '../../api';
import { EmptyState, PaginationControls, SenderBrandAvatar } from '../../components/shared';
import { extractCode, relativeTime } from '../../lib/display';
import { VerificationCodeCopyButton } from '../../lib/VerificationCodeCopyButton';
import { formatCount, mailListVariants, mailRowVariants } from './utils';
import type { InboxText } from './types';

type MessageListProps = {
  text: InboxText;
  email: string;
  items: MessageSummary[];
  total: number;
  page: number;
  totalPages: number;
  selectedID: string;
  pulseIds: Set<string>;
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  onRetry: () => void;
  shouldReduceMotion: boolean;
  onSelectMessage: (id: string) => void;
  onPageChange: (page: number) => void;
};

export const MessageList = forwardRef<HTMLDivElement, MessageListProps>(function MessageList({
  text,
  email,
  items,
  total,
  page,
  totalPages,
  selectedID,
  pulseIds,
  isLoading,
  isFetching,
  error,
  onRetry,
  shouldReduceMotion,
  onSelectMessage,
  onPageChange
}, ref) {
  const showInitialSkeleton = Boolean(email && !error && (isLoading || isFetching) && items.length === 0);

  return (
    <div className="inbox-list-section inbox-message-list-section">
      <div className="inbox-section-heading">
        <p>{text.inbox.messages}</p>
        <span>{formatCount(text.inbox.messageCount, total)}</span>
      </div>
      <motion.div
        ref={ref}
        className="mail-list inbox-scroll-list"
        variants={mailListVariants(shouldReduceMotion, items.length)}
        initial="hidden"
        animate="show"
        role="list"
        aria-busy={showInitialSkeleton || undefined}
      >
        {items.map((message) => (
          <MessageRow
            key={message.id}
            text={text}
            message={message}
            expanded={selectedID === message.id}
            pulsing={pulseIds.has(message.id)}
            shouldReduceMotion={shouldReduceMotion}
            onSelect={() => onSelectMessage(selectedID === message.id ? '' : message.id)}
          />
        ))}
        {email && Boolean(error) && <InboxListError label={readErrorMessage(error)} actionLabel={text.common.refresh} onRetry={onRetry} />}
        {showInitialSkeleton && <MessageListSkeleton label={text.common.loading} />}
        {email && !error && !isLoading && !isFetching && items.length === 0 && <EmptyState label={text.inbox.empty} />}
        {!email && <EmptyState label={text.inbox.start} />}
      </motion.div>
      {email && (
        <PaginationControls
          page={page}
          totalPages={totalPages}
          onPageChange={onPageChange}
        />
      )}
    </div>
  );
});

const MESSAGE_LIST_SKELETON_ROWS = [
  { title: '68%', sender: '46%', time: '3.7rem' },
  { title: '78%', sender: '58%', time: '3.1rem' },
  { title: '52%', sender: '40%', time: '4.2rem' },
  { title: '72%', sender: '50%', time: '3.4rem' },
  { title: '60%', sender: '44%', time: '3.9rem' },
  { title: '82%', sender: '56%', time: '3.2rem' }
] as const;

function MessageListSkeleton({ label }: { label: string }) {
  return (
    <div className="mail-list-skeleton">
      <span className="sr-only" role="status" aria-live="polite">{label}</span>
      <div className="mail-list-skeleton-rows" aria-hidden="true">
        {MESSAGE_LIST_SKELETON_ROWS.map((row, index) => (
          <div className="mail-row-card mail-row-skeleton-card" key={`mail-row-skeleton-${index}`}>
            <div className="mail-row mail-row-skeleton">
              <div className="mail-row-summary">
                <span className="mail-skeleton-line mail-skeleton-avatar" />
                <span className="mail-skeleton-stack">
                  <span className="mail-skeleton-line mail-skeleton-title" style={{ width: row.title }} />
                  <span className="mail-skeleton-line mail-skeleton-subtitle" style={{ width: row.sender }} />
                </span>
              </div>
              <div className="mail-row-side mail-row-skeleton-side">
                <span className="mail-skeleton-line mail-skeleton-time" style={{ width: row.time }} />
                <span className="mail-skeleton-line mail-skeleton-icon" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

type MessageRowProps = {
  text: InboxText;
  message: MessageSummary;
  expanded: boolean;
  pulsing: boolean;
  shouldReduceMotion: boolean;
  onSelect: () => void;
};

export const MessageRow = memo(function MessageRow({
  text,
  message,
  expanded,
  pulsing,
  shouldReduceMotion,
  onSelect
}: MessageRowProps) {
  const code = extractCode(message);

  return (
    <motion.div
      variants={mailRowVariants(shouldReduceMotion)}
      className="mail-row-card"
      style={pulsing ? { animation: 'mail-pulse 2.5s ease-out both' } : undefined}
      role="listitem"
    >
      <div className={`mail-row ${expanded ? 'mail-row-active' : ''}`}>
        <button
          type="button"
          className="mail-row-select"
          onClick={onSelect}
          aria-current={expanded ? 'true' : undefined}
        >
          <div className="mail-row-summary">
            <SenderBrandAvatar fromAddress={message.from_address} fromName={message.from_name} size="sm" className="mail-row-avatar" />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {expanded ? <MailOpen size={15} className="shrink-0 text-[var(--focus)]" /> : null}
                <span className="truncate text-sm font-medium">{message.subject || text.common.noSubject}</span>
              </div>
              <div className="truncate text-xs text-[var(--muted)]">
                {message.from_name || message.from_address || 'unknown'}
              </div>
            </div>
          </div>
          <div className="mail-row-side">
            <time className="text-xs text-[var(--muted)]">{relativeTime(message.created_at)}</time>
            <ChevronDown size={15} className={expanded ? 'rotate-180' : ''} />
          </div>
        </button>
        {code && <VerificationCodeCopyButton code={code} compact className="mail-code-pill" />}
      </div>
      {expanded && (
        <motion.div
          className="mail-row-details"
          initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
          animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, height: 'auto' }}
          transition={{ duration: shouldReduceMotion ? 0.08 : 0.18, ease: 'easeOut' }}
        >
          <div className="truncate">{message.recipient}</div>
          {message.preview && <p>{message.preview}</p>}
        </motion.div>
      )}
    </motion.div>
  );
});

function InboxListError({ label, actionLabel, onRetry }: { label: string; actionLabel: string; onRetry: () => void }) {
  return (
    <div className="inbox-list-error" role="alert">
      <span>{label}</span>
      <button className="btn-secondary btn-sm" type="button" onClick={onRetry}>
        {actionLabel}
      </button>
    </div>
  );
}

function readErrorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : 'Request failed';
}
