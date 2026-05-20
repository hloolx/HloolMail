import { FormEvent, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, KeyRound, ListChecks, RefreshCw, Share2, X } from 'lucide-react';
import { toast } from 'sonner';
import type { PaginatedResponse, ShareLinkAccessLogDTO, ShareLinkDTO } from '../api';
import { api, postJSON } from '../api';
import { useText } from '../locales';
import { copy } from '../lib/clipboard';
import { relativeTime } from '../lib/display';
import { useCopyState } from '../hooks/useCopyState';
import { ConfirmModal, DataTable, EmptyState, IconButton, PaginationControls } from '../components/shared';

const SHARE_PER_PAGE = 10;

export function ShareLinksPage() {
  const text = useText();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [logsTarget, setLogsTarget] = useState<ShareLinkDTO | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ShareLinkDTO | null>(null);
  const [rotateTarget, setRotateTarget] = useState<ShareLinkDTO | null>(null);
  const [oneTimeLink, setOneTimeLink] = useState<ShareLinkDTO | null>(null);
  const links = useQuery({
    queryKey: ['share-links', page],
    queryFn: () => api<PaginatedResponse<ShareLinkDTO>>(`/api/share-links?page=${page}&per_page=${SHARE_PER_PAGE}`),
    retry: false
  });
  const list = links.data?.items || [];

  const revoke = useMutation({
    mutationFn: (link: ShareLinkDTO) => postJSON<ShareLinkDTO>(`/api/share-links/${link.id}/revoke`, {}),
    onSuccess: () => {
      setRevokeTarget(null);
      queryClient.invalidateQueries({ queryKey: ['share-links'] });
      toast.success(text.shareLinks.revokedToast);
    },
    onError: (error) => toast.error(error.message)
  });
  const rotate = useMutation({
    mutationFn: (link: ShareLinkDTO) => postJSON<ShareLinkDTO>(`/api/share-links/${link.id}/rotate-token`, {}),
    onSuccess: (data) => {
      setRotateTarget(null);
      setOneTimeLink(data);
      queryClient.invalidateQueries({ queryKey: ['share-links'] });
      toast.success(text.shareLinks.tokenRotated);
    },
    onError: (error) => toast.error(error.message)
  });

  return (
    <div className="grid gap-4">
      <section className="panel">
        <div className="panel-header api-key-panel-header">
          <div>
            <h2>{text.shareLinks.title}</h2>
            <p>{links.data?.total ?? 0} {text.shareLinks.count}</p>
          </div>
          <button className="btn-primary" onClick={() => setCreateOpen(true)}>
            <Share2 size={16} />
            {text.shareLinks.createButton}
          </button>
        </div>
        <p className="api-key-helper">{text.shareLinks.desc}</p>
        {oneTimeLink && <OneTimeLinkCard link={oneTimeLink} onClose={() => setOneTimeLink(null)} />}
        {links.isError ? (
          <EmptyState label={links.error.message} />
        ) : (
          <DataTable
            ariaLabel={text.shareLinks.title}
            columns={[
              { key: 'message', header: text.shareLinks.message, minWidth: '14rem' },
              { key: 'token', header: text.shareLinks.tokenPrefix, minWidth: '12rem' },
              { key: 'status', header: text.shareLinks.status, align: 'center', width: '7rem' },
              { key: 'password', header: text.shareLinks.passwordSet, align: 'center', width: '7rem' },
              { key: 'expires', header: text.shareLinks.expiresAt, width: '9rem' },
              { key: 'accesses', header: text.shareLinks.accesses, align: 'right', width: '6rem' },
              { key: 'last', header: text.shareLinks.lastAccessed, width: '8rem' },
              { key: 'actions', header: text.shareLinks.actions, align: 'right', minWidth: '13rem' }
            ]}
            emptyLabel={links.isLoading ? text.common.loading : text.shareLinks.empty}
            rows={list.map((link) => ({
              key: link.id,
              cells: [
                <span className="automation-primary-cell">{link.message_id || '-'}</span>,
                <code className="automation-code">{link.token_prefix}</code>,
                shareStatus(link, text),
                link.password_set ? text.common.yes : text.common.no,
                formatDateTime(link.expires_at, text.shareLinks.noExpiry),
                link.access_count,
                link.last_accessed_at ? relativeTime(link.last_accessed_at) : '-',
                <div className="table-actions">
                  <IconButton title={text.shareLinks.logs} onClick={() => setLogsTarget(link)}>
                    <ListChecks size={14} />
                  </IconButton>
                  <IconButton title={text.shareLinks.rotate} onClick={() => setRotateTarget(link)} disabled={rotate.isPending}>
                    <RefreshCw size={14} />
                  </IconButton>
                  <IconButton title={text.shareLinks.revoke} onClick={() => setRevokeTarget(link)} disabled={Boolean(link.revoked_at) || revoke.isPending}>
                    <X size={14} />
                  </IconButton>
                </div>
              ]
            }))}
          />
        )}
        <PaginationControls
          page={links.data?.page || page}
          totalPages={links.data?.total_pages || 1}
          onPageChange={setPage}
        />
      </section>

      {createOpen && (
        <CreateShareLinkDialog
          onClose={() => setCreateOpen(false)}
          onCreated={(link) => {
            setOneTimeLink(link);
            setCreateOpen(false);
            queryClient.invalidateQueries({ queryKey: ['share-links'] });
          }}
        />
      )}
      {logsTarget && <ShareAccessLogsModal link={logsTarget} onClose={() => setLogsTarget(null)} />}
      <ConfirmModal
        open={Boolean(revokeTarget)}
        title={text.shareLinks.revoke}
        description={text.shareLinks.revokeConfirmDesc}
        danger
        confirmText={text.shareLinks.revoke}
        cancelText={text.common.cancel}
        onConfirm={() => revokeTarget && revoke.mutate(revokeTarget)}
        onCancel={() => setRevokeTarget(null)}
      />
      <ConfirmModal
        open={Boolean(rotateTarget)}
        title={text.shareLinks.rotate}
        description={text.shareLinks.rotateConfirmDesc}
        confirmText={text.shareLinks.rotate}
        cancelText={text.common.cancel}
        onConfirm={() => rotateTarget && rotate.mutate(rotateTarget)}
        onCancel={() => setRotateTarget(null)}
      />
    </div>
  );
}

function CreateShareLinkDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (link: ShareLinkDTO) => void }) {
  const text = useText();
  const [messageId, setMessageId] = useState('');
  const [password, setPassword] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const create = useMutation({
    mutationFn: () => postJSON<ShareLinkDTO>('/api/share-links', {
      resource_type: 'message',
      message_id: messageId.trim(),
      password: password.trim(),
      expires_at: toRFC3339(expiresAt)
    }),
    onSuccess: (data) => {
      toast.success(text.shareLinks.createdToast);
      onCreated(data);
    },
    onError: (error) => toast.error(error.message)
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <div className="modal-backdrop">
      <form className="modal-panel automation-dialog" onSubmit={submit}>
        <div className="modal-header">
          <div>
            <h2>{text.shareLinks.createTitle}</h2>
            <p>{text.shareLinks.createDesc}</p>
          </div>
          <IconButton title={text.common.close} onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        <div className="automation-form">
          <label className="api-key-field">
            {text.shareLinks.messageId}
            <input className="input" value={messageId} onChange={(event) => setMessageId(event.target.value)} placeholder={text.shareLinks.messageIdPlaceholder} required />
          </label>
          <label className="api-key-field">
            {text.shareLinks.password}
            <input className="input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={text.shareLinks.passwordPlaceholder} />
          </label>
          <label className="api-key-field">
            {text.shareLinks.expiresAt}
            <input className="input" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
          </label>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>{text.common.cancel}</button>
          <button className="btn-primary" disabled={create.isPending || !messageId.trim()}>
            <Share2 size={16} />
            {text.common.create}
          </button>
        </div>
      </form>
    </div>
  );
}

export function OneTimeLinkCard({ link, onClose }: { link: ShareLinkDTO; onClose?: () => void }) {
  const text = useText();
  const [copied, markCopied] = useCopyState();
  const shareURL = useMemo(() => publicShareURL(link), [link]);
  if (!shareURL) return null;
  return (
    <div className="one-time-secret-card">
      <div className="min-w-0">
        <strong>{text.shareLinks.oneTimeTitle}</strong>
        <p>{text.shareLinks.oneTimeHint}</p>
        <code>{shareURL}</code>
      </div>
      <button className="btn-secondary" onClick={() => { copy(shareURL); markCopied(); }}>
        {copied ? <Check size={16} /> : <Copy size={16} />}
        {copied ? text.common.copied : text.shareLinks.copyLink}
      </button>
      {onClose && (
        <IconButton title={text.common.close} onClick={onClose}>
          <X size={14} />
        </IconButton>
      )}
    </div>
  );
}

function ShareAccessLogsModal({ link, onClose }: { link: ShareLinkDTO; onClose: () => void }) {
  const text = useText();
  const [page, setPage] = useState(1);
  const logs = useQuery({
    queryKey: ['share-link-access-logs', link.id, page],
    queryFn: () => api<PaginatedResponse<ShareLinkAccessLogDTO>>(`/api/share-links/${link.id}/access-logs?page=${page}&per_page=20`),
    retry: false
  });
  return (
    <div className="modal-backdrop">
      <section className="modal-panel automation-log-modal">
        <div className="modal-header">
          <div>
            <h2>{text.shareLinks.accessLogsTitle}</h2>
            <p>{link.message_id}</p>
          </div>
          <IconButton title={text.common.close} onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        <div className="automation-modal-body">
          <DataTable
            ariaLabel={text.shareLinks.accessLogsTitle}
            density="compact"
            columns={[
              { key: 'time', header: text.shareLinks.created, width: '9rem' },
              { key: 'success', header: text.shareLinks.status, align: 'center', width: '6rem' },
              { key: 'ip', header: text.shareLinks.ip, minWidth: '8rem' },
              { key: 'reason', header: text.shareLinks.reason, minWidth: '9rem' },
              { key: 'ua', header: text.shareLinks.userAgent, minWidth: '16rem' }
            ]}
            emptyLabel={logs.isLoading ? text.common.loading : text.shareLinks.noLogs}
            rows={(logs.data?.items || []).map((log) => ({
              key: log.id,
              cells: [
                relativeTime(log.created_at),
                log.success ? <span className="status-pill status-ok">{text.shareLinks.success}</span> : <span className="status-pill status-bad">{text.shareLinks.failure}</span>,
                log.ip || '-',
                log.failure_reason || '-',
                { content: <span className="automation-muted-cell">{log.user_agent || '-'}</span>, title: log.user_agent || undefined }
              ]
            }))}
          />
          <PaginationControls page={logs.data?.page || page} totalPages={logs.data?.total_pages || 1} onPageChange={setPage} />
        </div>
      </section>
    </div>
  );
}

export function publicShareURL(link: ShareLinkDTO) {
  if (link.share_url) {
    return link.share_url.startsWith('/') ? `${window.location.origin}${link.share_url}` : link.share_url;
  }
  if (!link.token) return '';
  return `${window.location.origin}/share/${encodeURIComponent(link.token)}`;
}

function shareStatus(link: ShareLinkDTO, text: ReturnType<typeof useText>) {
  if (link.revoked_at) return <span className="status-pill status-bad">{text.shareLinks.revoked}</span>;
  if (link.expires_at && new Date(link.expires_at).getTime() <= Date.now()) return <span className="status-pill status-warn">{text.shareLinks.expired}</span>;
  return <span className="status-pill status-ok">{text.shareLinks.active}</span>;
}

function formatDateTime(value: string | undefined, empty: string) {
  if (!value) return empty;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
}

function toRFC3339(value: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString();
}
