import { Paperclip } from 'lucide-react';
import type { AttachmentMetadata, MessageDetail } from '../api';
import { extractCode, VerificationCodeCopyButton } from '../lib/display';
import { buildEmailSrcDoc } from '../lib/emailHtml';
import { useText } from '../locales';
import { EmptyState, LoadingState, SenderBrandAvatar } from '../components/shared';

export function MessageDrawer({
  message,
  loading,
  error,
  onBack,
  onRetry
}: {
  message?: MessageDetail;
  loading: boolean;
  error?: unknown;
  onBack?: () => void;
  onRetry?: () => void;
}) {
  const text = useText();

  if (loading) return <aside className="panel mail-detail-panel"><LoadingState label={text.common.loading} /></aside>;
  if (error) return <MessageDetailError label={readErrorMessage(error)} actionLabel={text.common.retry} onRetry={onRetry} />;
  if (!message) return <aside className="panel mail-detail-panel mail-detail-empty text-sm text-[var(--muted)]">{text.inbox.selectMessage}</aside>;
  const code = extractCode(message);
  const hasHtml = Boolean(message.html_content?.trim());
  return (
    <aside className="panel mail-detail-panel min-h-96">
      {onBack && (
        <button className="btn-ghost inbox-mobile-back" type="button" onClick={onBack}>
          {text.inbox.backToMessages}
        </button>
      )}
      <div className="panel-header">
        <div className="mail-detail-title-row">
          <SenderBrandAvatar fromAddress={message.from_address} fromName={message.from_name} size="lg" className="mail-detail-avatar" />
          <div className="min-w-0">
            <h2 className="truncate">{message.subject || text.common.noSubject}</h2>
            <p className="truncate">{message.from_name || message.from_address}</p>
          </div>
        </div>
      </div>
      <div className="mb-3 grid gap-1 text-xs text-[var(--muted)]">
        <div>To: {message.recipient}</div>
        <div>{new Date(message.created_at).toLocaleString()}</div>
      </div>
      {code && <div className="message-code-row"><VerificationCodeCopyButton code={code} /></div>}
      {message.attachments && message.attachments.length > 0 && <MessageAttachmentList attachments={message.attachments} />}
      {hasHtml ? (
        <iframe
          className="message-frame"
          title={`${text.inbox.messages}: ${message.subject || text.common.noSubject}`}
          aria-label={`${text.inbox.messages}: ${message.subject || text.common.noSubject}`}
          sandbox="allow-downloads"
          referrerPolicy="no-referrer"
          srcDoc={buildEmailSrcDoc(message.html_content || '')}
        />
      ) : message.text_content ? (
        <div className="message-rendered-text">{message.text_content}</div>
      ) : (
        <EmptyState label={text.inbox.empty} />
      )}
    </aside>
  );
}

function MessageDetailError({ label, actionLabel, onRetry }: { label: string; actionLabel: string; onRetry?: () => void }) {
  return (
    <aside className="panel mail-detail-panel mail-detail-empty">
      <div className="grid gap-3 place-items-center text-center">
        <EmptyState label={label} />
        {onRetry && (
          <button className="btn-secondary btn-sm" type="button" onClick={onRetry}>
            {actionLabel}
          </button>
        )}
      </div>
    </aside>
  );
}

function readErrorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : 'Request failed';
}

function MessageAttachmentList({ attachments }: { attachments: AttachmentMetadata[] }) {
  const text = useText();
  return (
    <div className="attachment-list mb-3" aria-label={text.shared.attachments}>
      {attachments.map((attachment) => (
        <div className="attachment-row" key={attachment.id}>
          <span className="attachment-name">
            <Paperclip size={14} />
            <span>{attachment.filename || `${text.shared.attachment} ${attachment.sequence}`}</span>
          </span>
          <span className="text-xs text-[var(--muted)]">{formatBytes(attachment.size_bytes)}</span>
        </div>
      ))}
    </div>
  );
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let next = value;
  let unit = 0;
  while (next >= 1024 && unit < units.length - 1) {
    next /= 1024;
    unit += 1;
  }
  return `${next >= 10 || unit === 0 ? next.toFixed(0) : next.toFixed(1)} ${units[unit]}`;
}
