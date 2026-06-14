import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useReducedMotion } from 'framer-motion';
import { LockKeyhole, Mail, Paperclip, Unlock } from 'lucide-react';
import { toast } from 'sonner';
import type {
  AttachmentMetadata,
  MessageSummary,
  PaginatedResponse,
  PublicSharedLocked,
  PublicSharedMailbox,
  PublicSharedMailboxMessage,
  PublicSharedResponse
} from '../api';
import { ApiError, api } from '../api';
import { buildEmailSrcDoc } from '../lib/emailHtml';
import { extractCode } from '../lib/display';
import { VerificationCodeCopyButton } from '../lib/VerificationCodeCopyButton';
import { useText } from '../locales';
import { EmptyState, LoadingState, SenderBrandAvatar } from '../components/shared';
import { MessageList } from './inbox/MessageList';

const SHARED_MAILBOX_PAGE_SIZE = 12;

export function SharedMessagePage({ token }: { token: string }) {
  const text = useText();
  const [shareKey, setShareKey] = useState('');
  const [mailboxKey, setMailboxKey] = useState(() => shareKeyFromLocation());
  const keyFromURL = useRef(Boolean(mailboxKey));

  const shared = useQuery({
    queryKey: ['shared-resource', token, mailboxKey],
    queryFn: () => api<PublicSharedResponse>(sharedResourcePath(token, mailboxKey)),
    retry: false
  });

  const data = shared.data;
  const statusMessage = errorMessage(shared.error, text);
  const isClearingRejectedKey = Boolean(mailboxKey && isInvalidShareKeyError(shared.error));
  const mailboxNeedsKey = data && isSharedMailbox(data) && !mailboxKey;
  const lockedData = data && isLockedShare(data)
    ? data
    : mailboxNeedsKey
      ? mailboxAsLocked(data)
      : null;

  useEffect(() => {
    if (!keyFromURL.current || !mailboxKey || !data || !isSharedMailbox(data)) return;
    stripShareKeyFromLocation();
    keyFromURL.current = false;
  }, [data, mailboxKey]);

  useEffect(() => {
    if (!mailboxKey || !isInvalidShareKeyError(shared.error)) return;
    stripShareKeyFromLocation();
    keyFromURL.current = false;
    setMailboxKey('');
    toast.error(text.shared.invalidKey);
  }, [mailboxKey, shared.error, text.shared.invalidKey]);

  const submitLockedShare = (event: FormEvent) => {
    event.preventDefault();
    const nextKey = shareKey.trim();
    if (!nextKey) return;
    setMailboxKey(nextKey);
    setShareKey('');
  };

  return (
    <main className="shared-page min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <section className={`shared-shell ${data && isSharedMailbox(data) ? 'shared-mailbox-shell' : ''}`}>
        <div className="shared-brand">
          <span className="shared-brand-mark"><Mail size={18} /></span>
          <span>HLOOL Mail</span>
        </div>
        {shared.isLoading ? (
          <section className="panel shared-panel">
            <LoadingState label={text.shared.loading} />
          </section>
        ) : isClearingRejectedKey ? (
          <section className="panel shared-panel">
            <LoadingState label={text.shared.loading} />
          </section>
        ) : shared.isError ? (
          <section className="panel shared-panel">
            <RetryState label={statusMessage} actionLabel={text.common.retry} onRetry={() => shared.refetch()} />
          </section>
        ) : lockedData ? (
          <LockedShare
            data={lockedData}
            shareKey={shareKey}
            pending={shared.isFetching}
            onShareKeyChange={setShareKey}
            onSubmit={submitLockedShare}
          />
        ) : data && isSharedMailbox(data) ? (
          <SharedMailbox token={token} data={data} accessKey={mailboxKey} />
        ) : (
          <section className="panel shared-panel">
            <EmptyState label={text.shared.notFound} />
          </section>
        )}
      </section>
    </main>
  );
}

function LockedShare({
  data,
  shareKey,
  pending,
  onShareKeyChange,
  onSubmit
}: {
  data: PublicSharedLocked;
  shareKey: string;
  pending: boolean;
  onShareKeyChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const text = useText();
  const title = data.mailbox?.email || text.shared.sharedMailbox;
  const firstMetaValue = data.mailbox?.email || '-';
  const secondMetaValue = formatCount(data.mailbox?.message_count, text.shared.unknownCount);

  return (
    <section className="panel shared-panel shared-lock-panel">
      <div className="shared-lock-icon"><LockKeyhole size={22} /></div>
      <div>
        <h1>{title}</h1>
        <p>{text.shared.keyRequired}</p>
      </div>
      <dl className="shared-meta">
        <div><dt>{text.shared.mailbox}</dt><dd>{firstMetaValue}</dd></div>
        <div><dt>{text.shared.messages}</dt><dd>{secondMetaValue}</dd></div>
      </dl>
      <form className="shared-password-form" onSubmit={onSubmit}>
        <label className="sr-only" htmlFor="shared-key">{text.shared.shareKey}</label>
        <input
          id="shared-key"
          className="input"
          type="text"
          value={shareKey}
          placeholder={text.shared.shareKey}
          autoComplete="off"
          onChange={(event) => onShareKeyChange(event.target.value)}
        />
        <button className="btn-primary" disabled={pending || !shareKey.trim()}>
          <Unlock size={16} />
          {text.shared.unlock}
        </button>
      </form>
    </section>
  );
}

function SharedMailbox({ token, data, accessKey }: { token: string; data: PublicSharedMailbox; accessKey: string }) {
  const text = useText();
  const shouldReduceMotion = useReducedMotion();
  const [page, setPage] = useState(1);
  const [selectedID, setSelectedID] = useState('');
  const [mobileStep, setMobileStep] = useState<'messages' | 'detail'>('messages');
  const emptyPulseIds = useMemo(() => new Set<string>(), []);
  const email = data.mailbox.email;

  const messages = useQuery({
    queryKey: ['shared-mailbox-messages', token, accessKey, page],
    queryFn: () => api<PaginatedResponse<MessageSummary>>(sharedMailboxMessagesPath(token, accessKey, page)),
    retry: false
  });
  const detail = useQuery({
    queryKey: ['shared-mailbox-message', token, accessKey, selectedID],
    queryFn: () => api<PublicSharedMailboxMessage>(sharedMailboxMessagePath(token, selectedID, accessKey)),
    enabled: Boolean(selectedID),
    retry: false
  });

  const items = messages.data?.items || [];
  const total = messages.data?.total ?? data.mailbox.message_count ?? items.length;

  return (
    <div className="shared-mailbox-layout">
      <section className={`panel inbox-column inbox-message-column ${mobileStep !== 'messages' ? 'inbox-drilldown-hidden' : ''}`}>
        <div className="inbox-mobile-stepbar">
          <span>{text.shared.sharedMailbox}</span>
        </div>
        <div className="panel-header inbox-column-header">
          <div className="min-w-0">
            <h2>{text.shared.sharedMailbox}</h2>
            <p className="truncate">{email}</p>
          </div>
        </div>
        <div className="inbox-active-mailbox">
          <code>{email}</code>
        </div>
        {messages.isError ? (
          <EmptyState label={errorMessage(messages.error, text)} />
        ) : (
          <MessageList
            text={text}
            email={email}
            items={items}
            total={total}
            page={messages.data?.page || page}
            totalPages={messages.data?.total_pages || 1}
            selectedID={selectedID}
            pulseIds={emptyPulseIds}
            isLoading={messages.isLoading}
            isFetching={messages.isFetching}
            error={messages.error}
            onRetry={() => messages.refetch()}
            shouldReduceMotion={Boolean(shouldReduceMotion)}
            onSelectMessage={(id) => {
              const nextID = selectedID === id ? '' : id;
              setSelectedID(nextID);
              if (nextID) setMobileStep('detail');
            }}
            onPageChange={(nextPage) => {
              setSelectedID('');
              setPage(nextPage);
              setMobileStep('messages');
            }}
          />
        )}
      </section>

      <div className={`inbox-detail-pane ${mobileStep !== 'detail' ? 'inbox-drilldown-hidden' : ''}`}>
        <SharedMailboxMessageDetail
          message={selectedID ? detail.data : undefined}
          loading={Boolean(selectedID) && detail.isLoading}
          error={detail.error}
          onRetry={() => detail.refetch()}
          onBack={() => setMobileStep('messages')}
        />
      </div>
    </div>
  );
}

function SharedMailboxMessageDetail({
  message,
  loading,
  error,
  onRetry,
  onBack
}: {
  message?: PublicSharedMailboxMessage;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onBack: () => void;
}) {
  const text = useText();
  if (loading) return <aside className="panel mail-detail-panel"><LoadingState label={text.common.loading} /></aside>;
  if (error) {
    return (
      <aside className="panel mail-detail-panel mail-detail-empty">
        <RetryState label={errorMessage(error, text)} actionLabel={text.common.retry} onRetry={onRetry} />
      </aside>
    );
  }
  if (!message) return <aside className="panel mail-detail-panel mail-detail-empty text-sm text-[var(--muted)]">{text.inbox.selectMessage}</aside>;
  const code = extractCode(message);
  const hasHtml = Boolean(message.html_content?.trim());

  return (
    <aside className="panel mail-detail-panel min-h-96">
      <button className="btn-ghost inbox-mobile-back" type="button" onClick={onBack}>
        {text.inbox.backToMessages}
      </button>
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
        <div>{text.shared.to}: {message.recipient}</div>
        <div>{new Date(message.created_at).toLocaleString()}</div>
      </div>
      {code && <div className="message-code-row"><VerificationCodeCopyButton code={code} /></div>}
      {message.attachments?.length > 0 && <AttachmentList attachments={message.attachments} />}
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
        <EmptyState label={text.shared.noContent} />
      )}
    </aside>
  );
}

function RetryState({ label, actionLabel, onRetry }: { label: string; actionLabel: string; onRetry: () => void }) {
  return (
    <div className="grid gap-3 place-items-center text-center" role="alert">
      <EmptyState label={label} />
      <button className="btn-secondary btn-sm" type="button" onClick={onRetry}>
        {actionLabel}
      </button>
    </div>
  );
}

export function AttachmentList({ attachments }: { attachments: AttachmentMetadata[] }) {
  const text = useText();
  return (
    <div className="attachment-list" aria-label={text.shared.attachments}>
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

function isLockedShare(data: PublicSharedResponse): data is PublicSharedLocked {
  return Boolean(('locked' in data && data.locked) || ('key_required' in data && data.key_required));
}

function isSharedMailbox(data: PublicSharedResponse): data is PublicSharedMailbox {
  return data.resource_type === 'mailbox' && 'mailbox' in data && !isLockedShare(data);
}

function mailboxAsLocked(data: PublicSharedMailbox): PublicSharedLocked {
  return {
    resource_type: 'mailbox',
    token_prefix: data.token_prefix || '',
    key_required: true,
    locked: true,
    expires_at: data.expires_at,
    mailbox: data.mailbox
  };
}

function sharedResourcePath(token: string, key: string) {
  const params = new URLSearchParams();
  if (key) params.set('key', key);
  return withQuery(`/api/shared/${encodeURIComponent(token)}`, params);
}

function sharedMailboxMessagesPath(token: string, key: string, page: number) {
  const params = new URLSearchParams({
    page: String(page),
    per_page: String(SHARED_MAILBOX_PAGE_SIZE)
  });
  if (key) params.set('key', key);
  return withQuery(`/api/shared/${encodeURIComponent(token)}/messages`, params);
}

function sharedMailboxMessagePath(token: string, messageID: string, key: string) {
  const params = new URLSearchParams();
  if (key) params.set('key', key);
  return withQuery(`/api/shared/${encodeURIComponent(token)}/messages/${encodeURIComponent(messageID)}`, params);
}

function withQuery(path: string, params: URLSearchParams) {
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

function shareKeyFromLocation() {
  if (typeof window === 'undefined') return '';

  const searchKey = new URLSearchParams(window.location.search).get('key');
  if (searchKey) return searchKey;

  const hash = window.location.hash;
  const queryStart = hash.indexOf('?');
  if (queryStart >= 0) return new URLSearchParams(hash.slice(queryStart + 1)).get('key') || '';

  const hashParams = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  return hashParams.get('key') || '';
}

function stripShareKeyFromLocation() {
  if (typeof window === 'undefined') return;

  const searchParams = new URLSearchParams(window.location.search);
  searchParams.delete('key');
  const nextSearch = searchParams.toString();
  let nextHash = window.location.hash;
  const hashQueryStart = nextHash.indexOf('?');
  if (hashQueryStart >= 0) {
    const hashPath = nextHash.slice(0, hashQueryStart);
    const hashParams = new URLSearchParams(nextHash.slice(hashQueryStart + 1));
    hashParams.delete('key');
    const nextHashQuery = hashParams.toString();
    nextHash = hashPath === '#' && !nextHashQuery ? '' : `${hashPath}${nextHashQuery ? `?${nextHashQuery}` : ''}`;
  } else if (nextHash.startsWith('#')) {
    const hashParams = new URLSearchParams(nextHash.slice(1));
    if (hashParams.has('key')) {
      hashParams.delete('key');
      const nextHashQuery = hashParams.toString();
      nextHash = nextHashQuery ? `#${nextHashQuery}` : '';
    }
  }

  window.history.replaceState(
    window.history.state,
    document.title,
    `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${nextHash}`
  );
}

function errorMessage(error: unknown, text: ReturnType<typeof useText>) {
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) return text.shared.invalidKey;
    if (error.status === 410) return text.shared.expiredOrRevoked;
    if (error.status === 404) return text.shared.notFound;
  }
  return error instanceof Error ? error.message : text.shared.notFound;
}

function isInvalidShareKeyError(error: unknown) {
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
}

function formatCount(value: number | undefined, empty: string) {
  if (typeof value !== 'number') return empty;
  return value.toLocaleString();
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
