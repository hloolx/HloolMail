import { FormEvent, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, ListChecks, Loader2, RefreshCw, Share2, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import type { MailboxInfo, PaginatedResponse, ShareLinkAccessLogDTO, ShareLinkDTO } from '../api';
import { api, postJSON } from '../api';
import { useText } from '../locales';
import { copy } from '../lib/clipboard';
import { relativeTime } from '../lib/display';
import { notifySuccess, runDeleteEffect } from '../lib/feedback';
import { useCopyState } from '../hooks/useCopyState';
import { useTableUrlState } from '../hooks/useTableUrlState';
import { ConfirmModal, DataTable, DataTableToolbar, DataTableViewOptions, DialogShell, EmptyState, IconButton, PaginationControls } from '../components/shared';
import type { DataTableColumn } from '../components/shared';
import { MailboxList } from './inbox/MailboxList';
import { MAILBOX_PAGE_SIZE } from './inbox/utils';
import '../styles/admin.css';
import '../styles/automation.css';
import '../styles/inbox.css';

const SHARE_PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

export function ShareLinksPage() {
  const text = useText();
  const queryClient = useQueryClient();
  const { page, setPage, pageSize, setPageSize } = useTableUrlState({
    defaultPageSize: 10,
    pageSizeOptions: SHARE_PAGE_SIZE_OPTIONS
  });
  const [hiddenColumnKeys, setHiddenColumnKeys] = useState<string[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [logsTarget, setLogsTarget] = useState<ShareLinkDTO | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ShareLinkDTO | null>(null);
  const [rotateTarget, setRotateTarget] = useState<ShareLinkDTO | null>(null);
  const [oneTimeLink, setOneTimeLink] = useState<ShareLinkDTO | null>(null);
  const [dissolveTarget, setDissolveTarget] = useState<HTMLElement | null>(null);
  const links = useQuery({
    queryKey: ['share-links', page, pageSize],
    queryFn: () => api<PaginatedResponse<ShareLinkDTO>>(`/api/share-links?page=${page}&per_page=${pageSize}`),
    retry: false
  });
  const list = links.data?.items || [];
  const shareLinkColumns = useMemo<DataTableColumn[]>(() => [
    { key: 'target', header: text.shareLinks.target, minWidth: '14rem', mobileTitle: true },
    { key: 'token', header: text.shareLinks.tokenPrefix, minWidth: '12rem', hideable: true, mobileSubtitle: true },
    { key: 'status', header: text.shareLinks.status, align: 'center', width: '7rem', hideable: true, mobileBadge: true },
    { key: 'shareKey', header: text.shareLinks.shareKeySet, align: 'center', width: '7rem', hideable: true, mobilePriority: 2 },
    { key: 'expires', header: text.shareLinks.expiresAt, width: '9rem', mobilePriority: 1 },
    { key: 'accesses', header: text.shareLinks.accesses, align: 'right', width: '6rem', mobilePriority: 3 },
    { key: 'last', header: text.shareLinks.lastAccessed, width: '8rem', mobilePriority: 4 },
    { key: 'actions', role: 'actions', header: text.shareLinks.actions, align: 'right', width: '7rem', hideable: false }
  ], [text]);
  const deleteLink = useMutation({
    mutationFn: (link: ShareLinkDTO) => api(`/api/share-links/${link.id}`, { method: 'DELETE' })
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
  const deletingLinkId = deleteLink.isPending ? deleteLink.variables?.id : null;
  const rotatingLinkId = rotate.isPending ? rotate.variables?.id : null;

  return (
    <div className="admin-table-page share-links-page">
      <div className="admin-table-page-header">
        <div className="admin-table-page-title">
          <h1>{text.shareLinks.title}</h1>
          <p>{text.shareLinks.desc}</p>
        </div>
        <button className="btn-primary admin-table-page-primary" onClick={() => setCreateOpen(true)}>
            <Share2 size={16} />
            {text.shareLinks.createButton}
        </button>
      </div>

      <section className="panel admin-table-panel">
        {oneTimeLink && <OneTimeLinkCard link={oneTimeLink} onClose={() => setOneTimeLink(null)} />}
        <DataTableToolbar
          className="share-links-toolbar"
          state={(
            <div className="admin-table-toolbar-copy">
              <h2>{text.shareLinks.title}</h2>
              <p>{links.data?.total ?? 0} {text.shareLinks.count}</p>
            </div>
          )}
          viewOptions={(
            <DataTableViewOptions
              columns={shareLinkColumns}
              hiddenColumnKeys={hiddenColumnKeys}
              onHiddenColumnKeysChange={setHiddenColumnKeys}
              label={text.common.view}
              menuLabel={text.common.toggleColumns}
              resetLabel={text.common.reset}
              emptyLabel={text.common.noToggleColumns}
            />
          )}
        />
        {links.isError ? (
          <EmptyState label={links.error.message} />
        ) : (
          <DataTable
            ariaLabel={text.shareLinks.title}
            columns={shareLinkColumns}
            hiddenColumnKeys={hiddenColumnKeys}
            onHiddenColumnKeysChange={setHiddenColumnKeys}
            hiddenLabel={text.common.noColumnsSelected}
            showAllColumnsLabel={text.common.showAllColumns}
            emptyLabel={text.shareLinks.empty}
            loading={links.isLoading}
            loadingLabel={text.common.loading}
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
                  <IconButton title={text.shareLinks.rotate} onClick={() => setRotateTarget(link)} disabled={rotatingLinkId === link.id}>
                    {rotatingLinkId === link.id ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  </IconButton>
                  <IconButton title={text.shareLinks.deleteLink} onClick={(event) => {
                    const row = (event.currentTarget as HTMLElement).closest('tr, .data-table-mobile-card') as HTMLElement | null;
                    setDissolveTarget(row);
                    setDeleteTarget(link);
                  }} disabled={deletingLinkId === link.id}>
                    {deletingLinkId === link.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
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
          rowsPerPage={pageSize}
          rowsPerPageOptions={SHARE_PAGE_SIZE_OPTIONS}
          onRowsPerPageChange={setPageSize}
          rowsPerPageLabel={text.common.rowsPerPage}
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
        confirmLoading={deleteLink.isPending}
        onConfirm={async () => {
          const target = deleteTarget;
          const targetEl = dissolveTarget;
          if (!target || deleteLink.isPending) return;
          try {
            await deleteLink.mutateAsync(target);
          } catch (error) {
            toast.error(error instanceof Error ? error.message : text.shareLinks.deleteConfirmDesc);
            return;
          }
          setDeleteTarget(null);
          setDissolveTarget(null);
          await new Promise(r => requestAnimationFrame(r));
          await runDeleteEffect(targetEl);
          queryClient.invalidateQueries({ queryKey: ['share-links'] });
          notifySuccess(text.shareLinks.deletedToast, { burst: false });
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
        confirmLoading={rotate.isPending}
        onConfirm={() => rotateTarget ? rotate.mutateAsync(rotateTarget) : undefined}
        onCancel={() => setRotateTarget(null)}
      />
    </div>
  );
}

function CreateShareLinkDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (link: ShareLinkDTO) => void }) {
  const text = useText();
  const [selectedMailbox, setSelectedMailbox] = useState<MailboxInfo | null>(null);
  const [manualMailboxID, setManualMailboxID] = useState('');
  const [mailboxSearch, setMailboxSearch] = useState('');
  const mailboxQuery = useDeferredValue(mailboxSearch.trim());
  const [mailboxPage, setMailboxPage] = useState(1);
  const [expiresAt, setExpiresAt] = useState('');
  const mailboxSearchRef = useRef<HTMLInputElement | null>(null);
  const mailboxes = useQuery({
    queryKey: ['mailboxes', 'share-links-create', mailboxQuery, mailboxPage],
    queryFn: () => {
      const params = new URLSearchParams({
        scope: 'own',
        page: String(mailboxPage),
        per_page: String(MAILBOX_PAGE_SIZE)
      });
      if (mailboxQuery) params.set('q', mailboxQuery);
      return api<PaginatedResponse<MailboxInfo>>(`/api/mailboxes?${params.toString()}`);
    },
    retry: false
  });
  const create = useMutation({
    mutationFn: async () => {
      const manualID = manualMailboxID.trim() ? parseMailboxID(manualMailboxID) : 0;
      if (manualMailboxID.trim() && !manualID) throw new Error(text.shareLinks.mailboxIDInvalid);
      const mailboxID = manualID || selectedMailbox?.id || 0;
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

  useEffect(() => {
    setMailboxPage(1);
  }, [mailboxQuery]);

  useEffect(() => {
    if (mailboxes.data && mailboxes.data.page !== mailboxPage) {
      setMailboxPage(mailboxes.data.page);
    }
  }, [mailboxes.data, mailboxPage]);

  const mailboxItems = mailboxes.data?.items || [];
  const hasManualMailboxID = Boolean(manualMailboxID.trim());
  const canCreate = Boolean(selectedMailbox || hasManualMailboxID);

  return (
    <DialogShell
      as="form"
      className="modal-panel automation-dialog share-link-create-dialog"
      titleId="share-link-create-title"
      descriptionId="share-link-create-desc"
      onClose={onClose}
      onSubmit={submit}
      initialFocusRef={mailboxSearchRef}
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
          <div className="share-mailbox-picker">
            <MailboxList
              text={text}
              items={mailboxItems}
              selectedEmail={!hasManualMailboxID ? selectedMailbox?.email || '' : ''}
              search={mailboxSearch}
              searchInputRef={mailboxSearchRef}
              total={mailboxes.data?.total ?? mailboxItems.length}
              page={mailboxes.data?.page || mailboxPage}
              totalPages={mailboxes.data?.total_pages || 1}
              isLoading={mailboxes.isLoading}
              error={mailboxes.error}
              showWhenEmpty
              emptyLabel={text.shareLinks.mailboxPickerEmpty}
              searchEmptyLabel={text.shareLinks.mailboxPickerSearchEmpty}
              onRetry={() => mailboxes.refetch()}
              onSearchChange={setMailboxSearch}
              onPageChange={setMailboxPage}
              onSelectMailbox={(mailbox) => {
                setSelectedMailbox(mailbox);
                setManualMailboxID('');
              }}
            />
            {selectedMailbox && !hasManualMailboxID && (
              <div className="share-mailbox-selected">
                <span>{text.shareLinks.selectedMailbox}</span>
                <code>{selectedMailbox.email}</code>
              </div>
            )}
          </div>
          <label className="api-key-field share-mailbox-manual">
            {text.shareLinks.manualMailboxId}
            <input
              className="input"
              inputMode="numeric"
              value={manualMailboxID}
              onChange={(event) => {
                setManualMailboxID(event.target.value);
                if (event.target.value.trim()) setSelectedMailbox(null);
              }}
              placeholder={text.shareLinks.manualMailboxIdPlaceholder}
            />
          </label>
          <label className="api-key-field">
            {text.shareLinks.expiresAt}
            <input className="input" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
          </label>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>{text.common.cancel}</button>
          <button className="btn-primary" disabled={create.isPending || !canCreate}>
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

function publicShareURL(link: ShareLinkDTO) {
  if (link.access_url) {
    return link.access_url.startsWith('/') ? `${window.location.origin}${link.access_url}` : link.access_url;
  }
  if (link.share_url) {
    return link.share_url.startsWith('/') ? `${window.location.origin}${link.share_url}` : link.share_url;
  }
  if (link.token && link.access_key) {
    return `${window.location.origin}/share/${encodeURIComponent(link.token)}#key=${encodeURIComponent(link.access_key)}`;
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
  const detail = link.resource_type === 'mailbox' && link.mailbox_id ? `#${link.mailbox_id}` : '';
  return (
    <div className="admin-domain-cell">
      <b>{shareTargetText(link, text)}</b>
      {detail && <small>{detail}</small>}
    </div>
  );
}

function shareTargetText(link: ShareLinkDTO, text: ReturnType<typeof useText>) {
  if (link.resource_type === 'mailbox') {
    return link.mailbox_email || (link.mailbox_id ? `${text.shareLinks.mailbox} #${link.mailbox_id}` : text.shareLinks.mailbox);
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

function parseMailboxID(value: string) {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const parsed = Number(trimmed);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
  }
  return 0;
}
