import { FormEvent, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, ListChecks, RefreshCw, Share2, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import type { MailboxInfo, PaginatedResponse, ShareLinkAccessLogDTO, ShareLinkDTO } from '../api';
import { api, postJSON } from '../api';
import { useText } from '../locales';
import { copy } from '../lib/clipboard';
import { relativeTime } from '../lib/display';
import { notifySuccess, runDeleteEffect } from '../lib/feedback';
import { useCopyState } from '../hooks/useCopyState';
import { ConfirmModal, DataTable, DialogShell, EmptyState, IconButton, PaginationControls } from '../components/shared';

const SHARE_PER_PAGE = 10;

export function ShareLinksPage() {
  const text = useText();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [logsTarget, setLogsTarget] = useState<ShareLinkDTO | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ShareLinkDTO | null>(null);
  const [rotateTarget, setRotateTarget] = useState<ShareLinkDTO | null>(null);
  const [oneTimeLink, setOneTimeLink] = useState<ShareLinkDTO | null>(null);
  const [dissolveTarget, setDissolveTarget] = useState<HTMLElement | null>(null);
  const links = useQuery({
    queryKey: ['share-links', page],
    queryFn: () => api<PaginatedResponse<ShareLinkDTO>>(`/api/share-links?page=${page}&per_page=${SHARE_PER_PAGE}`),
    retry: false
  });
  const list = links.data?.items || [];

  const deleteLink = useMutation({
    mutationFn: (link: ShareLinkDTO) => api(`/api/share-links/${link.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ['share-links'] });
      notifySuccess(text.shareLinks.deletedToast, { burst: false });
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
              { key: 'target', header: text.shareLinks.target, minWidth: '14rem' },
              { key: 'token', header: text.shareLinks.tokenPrefix, minWidth: '12rem' },
              { key: 'status', header: text.shareLinks.status, align: 'center', width: '7rem' },
              { key: 'shareKey', header: text.shareLinks.shareKeySet, align: 'center', width: '7rem' },
              { key: 'expires', header: text.shareLinks.expiresAt, width: '9rem' },
              { key: 'accesses', header: text.shareLinks.accesses, align: 'right', width: '6rem' },
              { key: 'last', header: text.shareLinks.lastAccessed, width: '8rem' },
              { key: 'actions', header: text.shareLinks.actions, align: 'right', minWidth: '13rem' }
            ]}
            emptyLabel={links.isLoading ? text.common.loading : text.shareLinks.empty}
            rows={list.map((link) => ({
              key: link.id,
              cells: [
                shareTarget(link, text),
                <code className="automation-code">{link.token_prefix}</code>,
                shareStatus(link, text),
                link.key_set ? text.common.yes : text.common.no,
                formatDateTime(link.expires_at, text.shareLinks.noExpiry),
                link.access_count,
                link.last_accessed_at ? relativeTime(link.last_accessed_at) : '-',
                <div className="table-actions" data-share-link-id={link.id}>
                  <IconButton title={text.shareLinks.logs} onClick={() => setLogsTarget(link)}>
                    <ListChecks size={14} />
                  </IconButton>
                  <IconButton title={text.shareLinks.rotate} onClick={() => setRotateTarget(link)} disabled={rotate.isPending}>
                    <RefreshCw size={14} />
                  </IconButton>
                  <IconButton title={text.shareLinks.deleteLink} onClick={() => {
                    const row = document.querySelector(`[data-share-link-id="${link.id}"]`)?.closest('tr') as HTMLElement | null;
                    setDissolveTarget(row);
                    setDeleteTarget(link);
                  }} disabled={deleteLink.isPending}>
                    <Trash2 size={14} />
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
        open={Boolean(deleteTarget)}
        title={text.shareLinks.deleteLink}
        description={text.shareLinks.deleteConfirmDesc}
        danger
        confirmText={text.common.delete}
        cancelText={text.common.cancel}
        onConfirm={async () => {
          const target = deleteTarget;
          const targetEl = dissolveTarget;
          setDeleteTarget(null);
          setDissolveTarget(null);
          await new Promise(r => requestAnimationFrame(r));
          await runDeleteEffect(targetEl);
          if (target) deleteLink.mutate(target);
        }}
        onCancel={() => {
          setDeleteTarget(null);
          setDissolveTarget(null);
        }}
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
  const [mailboxInput, setMailboxInput] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const mailboxInputRef = useRef<HTMLInputElement | null>(null);
  const mailboxes = useQuery({
    queryKey: ['mailboxes', 'share-links-create'],
    queryFn: () => api<PaginatedResponse<MailboxInfo>>('/api/mailboxes?page=1&per_page=50'),
    retry: false
  });
  const mailboxOptions = mailboxes.data?.items || [];
  const create = useMutation({
    mutationFn: async () => {
      const mailboxID = await resolveMailboxID(mailboxInput, mailboxOptions);
      if (!mailboxID) throw new Error(text.shareLinks.mailboxRequired);
      return postJSON<ShareLinkDTO>('/api/share-links', {
        resource_type: 'mailbox',
        mailbox_id: mailboxID,
        expires_at: toRFC3339(expiresAt)
      });
    },
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
    <DialogShell
      as="form"
      className="modal-panel automation-dialog"
      titleId="share-link-create-title"
      descriptionId="share-link-create-desc"
      onClose={onClose}
      onSubmit={submit}
      initialFocusRef={mailboxInputRef}
    >
        <div className="modal-header">
          <div>
            <h2 id="share-link-create-title">{text.shareLinks.createTitle}</h2>
            <p id="share-link-create-desc">{text.shareLinks.createDesc}</p>
          </div>
          <IconButton title={text.common.close} onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        <div className="automation-form">
          <label className="api-key-field">
            {text.shareLinks.mailboxIdOrEmail}
            <input
              ref={mailboxInputRef}
              className="input"
              list="share-mailbox-options"
              value={mailboxInput}
              onChange={(event) => setMailboxInput(event.target.value)}
              placeholder={text.shareLinks.mailboxIdOrEmailPlaceholder}
              required
            />
            <datalist id="share-mailbox-options">
              {mailboxOptions.flatMap((mailbox) => [
                <option key={`${mailbox.id}-email`} value={mailbox.email}>{`#${mailbox.id}`}</option>,
                <option key={`${mailbox.id}-id`} value={String(mailbox.id)}>{mailbox.email}</option>
              ])}
            </datalist>
          </label>
          <label className="api-key-field">
            {text.shareLinks.expiresAt}
            <input className="input" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
          </label>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>{text.common.cancel}</button>
          <button className="btn-primary" disabled={create.isPending || !mailboxInput.trim()}>
            <Share2 size={16} />
            {text.common.create}
          </button>
        </div>
    </DialogShell>
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
    <DialogShell
      className="modal-panel automation-log-modal"
      titleId="share-access-logs-title"
      descriptionId="share-access-logs-desc"
      onClose={onClose}
    >
        <div className="modal-header">
          <div>
            <h2 id="share-access-logs-title">{text.shareLinks.accessLogsTitle}</h2>
            <p id="share-access-logs-desc">{shareTargetText(link, text)}</p>
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
    </DialogShell>
  );
}

export function publicShareURL(link: ShareLinkDTO) {
  if (link.access_url) {
    return link.access_url.startsWith('/') ? `${window.location.origin}${link.access_url}` : link.access_url;
  }
  if (link.share_url) {
    return link.share_url.startsWith('/') ? `${window.location.origin}${link.share_url}` : link.share_url;
  }
  if (link.token && link.access_key) {
    return `${window.location.origin}/share/${encodeURIComponent(link.token)}?key=${encodeURIComponent(link.access_key)}`;
  }
  if (!link.token) return '';
  return `${window.location.origin}/share/${encodeURIComponent(link.token)}`;
}

function shareStatus(link: ShareLinkDTO, text: ReturnType<typeof useText>) {
  if (link.revoked_at) return <span className="status-pill status-bad">{text.shareLinks.revoked}</span>;
  if (link.expires_at && new Date(link.expires_at).getTime() <= Date.now()) return <span className="status-pill status-warn">{text.shareLinks.expired}</span>;
  return <span className="status-pill status-ok">{text.shareLinks.active}</span>;
}

function shareTarget(link: ShareLinkDTO, text: ReturnType<typeof useText>) {
  return <span className="automation-primary-cell">{shareTargetText(link, text)}</span>;
}

function shareTargetText(link: ShareLinkDTO, text: ReturnType<typeof useText>) {
  if (link.resource_type === 'mailbox') {
    return link.mailbox_id ? `${text.shareLinks.mailbox} #${link.mailbox_id}` : text.shareLinks.mailbox;
  }
  return text.shareLinks.unsupportedResource;
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

async function resolveMailboxID(value: string, mailboxes: MailboxInfo[]) {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const parsed = Number(trimmed);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
  }
  const localMatch = findMailboxByEmail(trimmed, mailboxes);
  if (localMatch) return localMatch.id;
  if (!trimmed.includes('@')) return 0;

  const params = new URLSearchParams({
    q: trimmed,
    page: '1',
    per_page: '50'
  });
  const result = await api<PaginatedResponse<MailboxInfo>>(`/api/mailboxes?${params.toString()}`);
  return findMailboxByEmail(trimmed, result.items || [])?.id || 0;
}

function findMailboxByEmail(email: string, mailboxes: MailboxInfo[]) {
  return mailboxes.find((mailbox) => mailbox.email.toLowerCase() === email.toLowerCase());
}
