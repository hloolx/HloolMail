import { Check, Copy } from 'lucide-react';
import type { MessageDetail } from '../api';
import { copy } from '../lib/clipboard';
import { extractCode } from '../lib/display';
import { useCopyState } from '../hooks/useCopyState';
import { useText } from '../locales';
import { EmptyState, IconButton } from '../components/shared';

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

export function MessageDrawer({ message, loading, apiKey }: { message?: MessageDetail; loading: boolean; apiKey: string }) {
  const text = useText();
  const [codeCopied, markCodeCopied] = useCopyState();
  if (loading) return <aside className="panel mail-detail-panel min-h-96">{text.common.loading}</aside>;
  if (!message) return <aside className="panel mail-detail-panel min-h-96 text-sm text-[var(--muted)]">{text.inbox.selectMessage}</aside>;
  const hasHtml = Boolean(message.html_content?.trim());
  return (
    <aside className="panel mail-detail-panel min-h-96">
      <div className="panel-header">
        <div className="min-w-0">
          <h2 className="truncate">{message.subject || text.common.noSubject}</h2>
          <p className="truncate">{message.from_address}</p>
        </div>
        <IconButton title={codeCopied ? text.common.copied : text.inbox.copyCode} onClick={() => { copy(extractCode(message) || message.subject || ''); markCodeCopied(); }}>
          {codeCopied ? <Check size={16} /> : <Copy size={16} />}
        </IconButton>
      </div>
      <div className="mb-3 grid gap-1 text-xs text-[var(--muted)]">
        <div>To: {message.recipient}</div>
        <div>{new Date(message.created_at).toLocaleString()}</div>
      </div>
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
