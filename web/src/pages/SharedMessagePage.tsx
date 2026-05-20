import { FormEvent, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { LockKeyhole, Mail, Paperclip, Unlock } from 'lucide-react';
import { toast } from 'sonner';
import type { AttachmentMetadata, PublicSharedMessage, PublicSharedResponse } from '../api';
import { ApiError, api, postJSON } from '../api';
import { useText } from '../locales';
import { EmptyState, LoadingState } from '../components/shared';

export function SharedMessagePage({ token }: { token: string }) {
  const text = useText();
  const [password, setPassword] = useState('');
  const [unlocked, setUnlocked] = useState<PublicSharedMessage | null>(null);
  const shared = useQuery({
    queryKey: ['shared-message', token],
    queryFn: () => api<PublicSharedResponse>(`/api/shared/${encodeURIComponent(token)}`),
    retry: false
  });
  const unlock = useMutation({
    mutationFn: () => postJSON<PublicSharedResponse>(`/api/shared/${encodeURIComponent(token)}/access`, { password }),
    onSuccess: (data) => {
      if (isSharedMessage(data)) {
        setUnlocked(data);
        setPassword('');
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : text.shared.invalidPassword);
    }
  });

  const data = unlocked || shared.data;
  const statusMessage = errorMessage(shared.error, text);

  return (
    <main className="shared-page min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <section className="shared-shell">
        <div className="shared-brand">
          <span className="shared-brand-mark"><Mail size={18} /></span>
          <span>HLOOL Mail</span>
        </div>
        {shared.isLoading ? (
          <section className="panel shared-panel">
            <LoadingState label={text.shared.loading} />
          </section>
        ) : shared.isError ? (
          <section className="panel shared-panel">
            <EmptyState label={statusMessage} />
          </section>
        ) : data && isLockedShare(data) ? (
          <LockedShare
            data={data}
            password={password}
            pending={unlock.isPending}
            onPasswordChange={setPassword}
            onSubmit={(event) => {
              event.preventDefault();
              unlock.mutate();
            }}
          />
        ) : data && isSharedMessage(data) ? (
          <SharedMessage data={data} />
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
  password,
  pending,
  onPasswordChange,
  onSubmit
}: {
  data: Extract<PublicSharedResponse, { password_required: true }>;
  password: string;
  pending: boolean;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const text = useText();
  return (
    <section className="panel shared-panel shared-lock-panel">
      <div className="shared-lock-icon"><LockKeyhole size={22} /></div>
      <div>
        <h1>{data.message.subject || text.common.noSubject}</h1>
        <p>{text.shared.passwordRequired}</p>
      </div>
      <dl className="shared-meta">
        <div><dt>{text.shared.from}</dt><dd>{data.message.from_name || data.message.from_address}</dd></div>
        <div><dt>{text.shared.to}</dt><dd>{data.message.recipient}</dd></div>
      </dl>
      <form className="shared-password-form" onSubmit={onSubmit}>
        <label className="sr-only" htmlFor="shared-password">{text.shared.password}</label>
        <input
          id="shared-password"
          className="input"
          type="password"
          value={password}
          placeholder={text.shared.password}
          autoComplete="current-password"
          onChange={(event) => onPasswordChange(event.target.value)}
        />
        <button className="btn-primary" disabled={pending || !password.trim()}>
          <Unlock size={16} />
          {text.shared.unlock}
        </button>
      </form>
    </section>
  );
}

function SharedMessage({ data }: { data: PublicSharedMessage }) {
  const text = useText();
  const hasHtml = Boolean(data.html_content?.trim());
  return (
    <article className="panel shared-panel">
      <header className="shared-message-header">
        <div className="min-w-0">
          <h1>{data.subject || text.common.noSubject}</h1>
          <p>{new Date(data.created_at).toLocaleString()}</p>
        </div>
      </header>
      <dl className="shared-meta">
        <div><dt>{text.shared.from}</dt><dd>{data.from_name || data.from_address}</dd></div>
        <div><dt>{text.shared.to}</dt><dd>{data.recipient}</dd></div>
      </dl>
      {data.attachments?.length > 0 && <AttachmentList attachments={data.attachments} />}
      {hasHtml ? (
        <iframe
          className="message-frame"
          title={data.subject || text.common.noSubject}
          sandbox="allow-downloads"
          srcDoc={data.html_content || ''}
        />
      ) : data.text_content ? (
        <div className="message-rendered-text">{data.text_content}</div>
      ) : (
        <EmptyState label={text.shared.noContent} />
      )}
    </article>
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

function isLockedShare(data: PublicSharedResponse): data is Extract<PublicSharedResponse, { password_required: true }> {
  return 'password_required' in data && data.password_required;
}

function isSharedMessage(data: PublicSharedResponse): data is PublicSharedMessage {
  return 'id' in data && 'from_address' in data;
}

function errorMessage(error: unknown, text: ReturnType<typeof useText>) {
  if (error instanceof ApiError) {
    if (error.status === 410) return text.shared.expiredOrRevoked;
    if (error.status === 404) return text.shared.notFound;
  }
  return error instanceof Error ? error.message : text.shared.notFound;
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
