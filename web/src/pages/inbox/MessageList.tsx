import { forwardRef } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown, MailOpen } from 'lucide-react';
import type { MessageSummary } from '../../api';
import { EmptyState, PaginationControls } from '../../components/shared';
import { extractCode, relativeTime, VerificationCodeCopyButton } from '../../lib/display';
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
  shouldReduceMotion,
  onSelectMessage,
  onPageChange
}, ref) {
  return (
    <div className="inbox-list-section inbox-message-list-section">
      <div className="inbox-section-heading">
        <p>{text.inbox.messages}</p>
        <span>{formatCount(text.inbox.messageCount, total)}</span>
      </div>
      <motion.div ref={ref} className="mail-list inbox-scroll-list" variants={mailListVariants(shouldReduceMotion, items.length)} initial="hidden" animate="show" role="list">
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
        {email && (isLoading || isFetching) && items.length === 0 && <EmptyState label={text.common.loading} />}
        {email && !isLoading && !isFetching && items.length === 0 && <EmptyState label={text.inbox.empty} />}
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

type MessageRowProps = {
  text: InboxText;
  message: MessageSummary;
  expanded: boolean;
  pulsing: boolean;
  shouldReduceMotion: boolean;
  onSelect: () => void;
};

export function MessageRow({
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
          aria-expanded={expanded}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {expanded ? <MailOpen size={15} className="shrink-0 text-[var(--focus)]" /> : null}
              <span className="truncate text-sm font-medium">{message.subject || text.common.noSubject}</span>
            </div>
            <div className="truncate text-xs text-[var(--muted)]">
              {message.from_address || 'unknown'}
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
}
