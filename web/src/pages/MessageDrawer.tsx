import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Paperclip, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import type { AttachmentMetadata, MessageDetail, ShareLinkDTO } from '../api';
import { postJSON } from '../api';
import { copy } from '../lib/clipboard';
import { extractCode } from '../lib/display';
import { useCopyState } from '../hooks/useCopyState';
import { useText } from '../locales';
import { EmptyState, IconButton, LoadingState } from '../components/shared';
import { OneTimeLinkCard } from './ShareLinksPage';

function injectApiKeyIntoHtml(html: string, apiKey: string): string {
  if (!apiKey) return html;
  return html.replace(
    /(<a\s[^>]*href\s*=\s*["'])(\/api\/[^"']+)(["'])/gi,
    (_m, prefix, url, suffix) => {
      const sep = url.includes('?') ? '&' : '?';
      return `${prefix}${url}${sep}api_key=${encodeURIComponent(apiKey)}${suffix}`;
    }
  );
}

export function MessageDrawer({ message, loading, apiKey, onBack }: { message?: MessageDetail; loading: boolean; apiKey: string; onBack?: () => void }) {
  const text = useText();
  const queryClient = useQueryClient();
  const [codeCopied, markCodeCopied] = useCopyState();
  const [shareLink, setShareLink] = useState<ShareLinkDTO | null>(null);
  const createShare = useMutation({
    mutationFn: () => postJSON<ShareLinkDTO>('/api/share-links', {
      resource_type: 'message',
      message_id: message?.id
    }),
    onSuccess: (link) => {
      setShareLink(link);
      queryClient.invalidateQueries({ queryKey: ['share-links'] });
      toast.success(text.shareLinks.createdFromInbox);
    },
    onError: (error) => toast.error(error.message)
  });

  useEffect(() => {
    setShareLink(null);
  }, [message?.id]);

  if (loading) return <aside className="panel mail-detail-panel min-h-96"><LoadingState label={text.common.loading} /></aside>;
  if (!message) return <aside className="panel mail-detail-panel min-h-96 text-sm text-[var(--muted)]">{text.inbox.selectMessage}</aside>;
  const hasHtml = Boolean(message.html_content?.trim());
  return (
    <aside className="panel mail-detail-panel min-h-96">
      {onBack && (
        <button className="btn-ghost inbox-mobile-back" type="button" onClick={onBack}>
          {text.inbox.backToMessages}
        </button>
      )}
      <div className="panel-header">
        <div className="min-w-0">
          <h2 className="truncate">{message.subject || text.common.noSubject}</h2>
          <p className="truncate">{message.from_address}</p>
        </div>
        <div className="inline-flex gap-2">
          <IconButton title={text.shareLinks.shareMessage} onClick={() => createShare.mutate()} disabled={createShare.isPending}>
            <Share2 size={16} />
          </IconButton>
          <IconButton title={codeCopied ? text.common.copied : text.inbox.copyCode} onClick={() => { copy(extractCode(message) || message.subject || ''); markCodeCopied(); }}>
            {codeCopied ? <Check size={16} /> : <Copy size={16} />}
          </IconButton>
        </div>
      </div>
      <div className="mb-3 grid gap-1 text-xs text-[var(--muted)]">
        <div>To: {message.recipient}</div>
        <div>{new Date(message.created_at).toLocaleString()}</div>
      </div>
      {shareLink && <OneTimeLinkCard link={shareLink} onClose={() => setShareLink(null)} />}
      {message.attachments && message.attachments.length > 0 && <MessageAttachmentList attachments={message.attachments} />}
      {hasHtml ? (
        <iframe
          className="message-frame"
          title={message.subject || text.common.noSubject}
          sandbox="allow-downloads"
          srcDoc={injectApiKeyIntoHtml(message.html_content || '', apiKey)}
        />
      ) : message.text_content ? (
        <div className="message-rendered-text">{message.text_content}</div>
      ) : (
        <EmptyState label={text.inbox.empty} />
      )}
    </aside>
  );
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
