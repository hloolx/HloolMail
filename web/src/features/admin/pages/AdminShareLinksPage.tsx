import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ListChecks, Loader2, RefreshCw, Search, ShieldOff, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import type { AdminShareLinkDTO, PaginatedResponse, ShareLinkAccessLogDTO } from '../../../api';
import { api, postJSON } from '../../../api';
import { useText } from '../../../locales';
import { relativeTime } from '../../../lib/display';
import { queryKeys } from '../../../lib/queryKeys';
import { useTableUrlState } from '../../../hooks/useTableUrlState';
import { ConfirmModal, DataTable, DataTableToolbar, DataTableViewOptions, DialogShell, IconButton, PaginationControls } from '../../../components/shared';
import type { DataTableColumn } from '../../../components/shared';
import { AdminPageFrame } from '../components/AdminPageFrame';
import { queryErrorMessage } from '../utils/adminFormatting';

const ADMIN_SHARE_PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
const ADMIN_SHARE_STATUS_OPTIONS = ['all', 'active', 'revoked', 'expired'] as const;

type AdminShareFilters = {
  status: (typeof ADMIN_SHARE_STATUS_OPTIONS)[number];
};

const DEFAULT_ADMIN_SHARE_FILTERS: AdminShareFilters = {
  status: 'all'
};

export function AdminShareLinksPage() {
  const text = useText();
  return (
    <AdminPageFrame title={text.page['admin-share-links']}>
      <AdminShareLinksPanel />
    </AdminPageFrame>
  );
}

export function AdminShareLinksPanel() {
  const text = useText();
  const queryClient = useQueryClient();
  const [logsTarget, setLogsTarget] = useState<AdminShareLinkDTO | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<AdminShareLinkDTO | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminShareLinkDTO | null>(null);
  const [hiddenColumnKeys, setHiddenColumnKeys] = useState<string[]>([]);
  const shareUrlState = useTableUrlState<AdminShareFilters>({
    defaultPageSize: 10,
    defaultSearch: '',
    defaultFilters: DEFAULT_ADMIN_SHARE_FILTERS,
    pageParam: 'sharePage',
    pageSizeParam: 'sharePageSize',
    searchParam: 'shareSearch',
    filterParams: { status: 'shareStatus' },
    filterOptions: { status: ADMIN_SHARE_STATUS_OPTIONS },
    pageSizeOptions: ADMIN_SHARE_PAGE_SIZE_OPTIONS
  });
  const { page, pageSize, search, filters } = shareUrlState;
  const links = useQuery({
    queryKey: queryKeys.admin.shareLinks(page, pageSize, search, filters),
    queryFn: () => api<PaginatedResponse<AdminShareLinkDTO>>(`/api/admin/share-links?${buildAdminShareLinksQuery(search, filters, page, pageSize)}`),
    retry: false,
    staleTime: 30_000
  });
  const list = links.data?.items || [];
  const columns = useMemo<DataTableColumn[]>(() => [
    { key: 'mailbox', header: text.admin.shareLinks.colMailbox, minWidth: '14rem', hideable: false, mobileTitle: true },
    { key: 'owner', header: text.admin.shareLinks.colOwner, minWidth: '13rem', mobileSubtitle: true },
    { key: 'token', header: text.shareLinks.tokenPrefix, minWidth: '12rem', hideable: true },
    { key: 'status', header: text.shareLinks.status, align: 'center', width: '7rem', mobileBadge: true },
    { key: 'shareKey', header: text.shareLinks.shareKeySet, align: 'center', width: '7rem', hideable: true, mobilePriority: 2 },
    { key: 'expires', header: text.shareLinks.expiresAt, width: '9rem', mobilePriority: 1 },
    { key: 'accesses', header: text.shareLinks.accesses, align: 'right', width: '6rem', mobilePriority: 3 },
    { key: 'last', header: text.shareLinks.lastAccessed, width: '8rem', mobilePriority: 4 },
    { key: 'actions', role: 'actions', header: text.shareLinks.actions, align: 'right', width: '7rem', hideable: false }
  ], [text]);

  const revoke = useMutation({
    mutationFn: (link: AdminShareLinkDTO) => postJSON<AdminShareLinkDTO>(`/api/admin/share-links/${link.id}/revoke`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.shareLinksRoot });
      setRevokeTarget(null);
      toast.success(text.admin.shareLinks.revokedToast);
    },
    onError: (error) => {
      toast.error(error.message);
    }
  });
  const deleteLink = useMutation({
    mutationFn: (link: AdminShareLinkDTO) => api(`/api/admin/share-links/${link.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.shareLinksRoot });
      setDeleteTarget(null);
      toast.success(text.admin.shareLinks.deletedToast);
    },
    onError: (error) => {
      toast.error(error.message);
    }
  });

  const resultCount = text.admin.shareLinks.resultCount
    .replace('{shown}', String(list.length))
    .replace('{total}', String(links.data?.total ?? 0));
  const revokingLinkId = revoke.isPending ? revoke.variables?.id : null;
  const deletingLinkId = deleteLink.isPending ? deleteLink.variables?.id : null;

  return (
    <section className="panel admin-table-panel" id="admin-share-links">
      <div className="panel-header admin-panel-header">
        <div>
          <h2>{text.admin.shareLinks.title}</h2>
          <p>{text.admin.shareLinks.desc}</p>
        </div>
        <button className="btn-secondary" type="button" onClick={() => links.refetch()} disabled={links.isFetching}>
          <RefreshCw size={14} className={links.isFetching ? 'animate-spin' : ''} aria-hidden="true" />
          {text.common.refresh}
        </button>
      </div>
      <DataTableToolbar
        className="admin-domain-health-toolbar"
        search={(
          <label className="admin-domain-health-search" aria-label={text.admin.shareLinks.search}>
            <Search size={15} aria-hidden="true" />
            <input
              value={search}
              onChange={(event) => shareUrlState.setSearch(event.target.value, 'replace')}
              placeholder={text.admin.shareLinks.searchPlaceholder}
            />
          </label>
        )}
        filters={(
          <div className="admin-domain-health-filters">
            <select className="input" value={filters.status} aria-label={text.admin.shareLinks.filterStatus} onChange={(event) => shareUrlState.setFilter('status', event.target.value as AdminShareFilters['status'])}>
              <option value="all">{text.admin.shareLinks.filterStatusAll}</option>
              <option value="active">{text.shareLinks.active}</option>
              <option value="revoked">{text.shareLinks.revoked}</option>
              <option value="expired">{text.shareLinks.expired}</option>
            </select>
          </div>
        )}
        state={<span className="admin-domain-health-count">{resultCount}</span>}
        viewOptions={(
          <DataTableViewOptions
            columns={columns}
            hiddenColumnKeys={hiddenColumnKeys}
            onHiddenColumnKeysChange={setHiddenColumnKeys}
            label={text.common.view}
            menuLabel={text.common.toggleColumns}
            resetLabel={text.common.reset}
            emptyLabel={text.common.noToggleColumns}
          />
        )}
      />
      <DataTable
        ariaLabel={text.admin.shareLinks.title}
        emptyLabel={text.admin.shareLinks.empty}
        loading={links.isLoading}
        loadingLabel={text.common.loading}
        error={links.isError}
        errorLabel={queryErrorMessage(links.error, text.admin.shareLinks.empty)}
        retryLabel={text.common.retry}
        onRetry={() => links.refetch()}
        retryPending={links.isFetching}
        columns={columns}
        hiddenColumnKeys={hiddenColumnKeys}
        onHiddenColumnKeysChange={setHiddenColumnKeys}
        hiddenLabel={text.common.noColumnsSelected}
        showAllColumnsLabel={text.common.showAllColumns}
        rows={list.map((link) => {
          const rowPending = revokingLinkId === link.id || deletingLinkId === link.id;
          const target = shareTargetText(link, text);
          return {
            key: link.id,
            cells: [
              shareTarget(link, text),
              ownerTarget(link, text),
              <code className="automation-code">{link.token_prefix}</code>,
              shareStatus(link, text),
              link.key_set ? text.common.yes : text.common.no,
              formatDateTime(link.expires_at, text.shareLinks.noExpiry),
              link.access_count,
              link.last_accessed_at ? relativeTime(link.last_accessed_at) : '-',
              <div className="table-actions" data-share-link-id={link.id}>
                <IconButton title={text.shareLinks.logs} ariaLabel={`${text.shareLinks.logs} ${target}`} onClick={() => setLogsTarget(link)} disabled={rowPending}>
                  <ListChecks size={14} aria-hidden="true" />
                </IconButton>
                <IconButton title={text.shareLinks.revoke} ariaLabel={`${text.shareLinks.revoke} ${target}`} onClick={() => setRevokeTarget(link)} disabled={rowPending || Boolean(link.revoked_at)}>
                  {revokingLinkId === link.id ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <ShieldOff size={14} aria-hidden="true" />}
                </IconButton>
                <IconButton title={text.shareLinks.deleteLink} ariaLabel={`${text.shareLinks.deleteLink} ${target}`} onClick={() => setDeleteTarget(link)} disabled={rowPending}>
                  {deletingLinkId === link.id ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Trash2 size={14} aria-hidden="true" />}
                </IconButton>
              </div>
            ]
          };
        })}
      />
      <PaginationControls
        page={links.data?.page || page}
        totalPages={links.data?.total_pages || 1}
        onPageChange={shareUrlState.setPage}
        rowsPerPage={pageSize}
        rowsPerPageOptions={[...ADMIN_SHARE_PAGE_SIZE_OPTIONS]}
        onRowsPerPageChange={shareUrlState.setPageSize}
        rowsPerPageLabel={text.common.rowsPerPage}
      />
      {logsTarget && <AdminShareAccessLogsModal link={logsTarget} onClose={() => setLogsTarget(null)} />}
      <ConfirmModal
        open={revokeTarget !== null}
        title={text.shareLinks.revoke}
        description={revokeTarget ? text.admin.shareLinks.revokeConfirm.replace('{target}', shareTargetText(revokeTarget, text)) : ''}
        confirmText={text.shareLinks.revoke}
        cancelText={text.common.cancel}
        danger
        confirmLoading={revoke.isPending}
        onConfirm={() => revokeTarget ? revoke.mutateAsync(revokeTarget) : undefined}
        onCancel={() => {
          if (!revoke.isPending) setRevokeTarget(null);
        }}
      />
      <ConfirmModal
        open={deleteTarget !== null}
        title={text.shareLinks.deleteLink}
        description={deleteTarget ? text.admin.shareLinks.deleteConfirm.replace('{target}', shareTargetText(deleteTarget, text)) : ''}
        confirmText={text.shareLinks.deleteLink}
        cancelText={text.common.cancel}
        danger
        confirmLoading={deleteLink.isPending}
        onConfirm={() => deleteTarget ? deleteLink.mutateAsync(deleteTarget) : undefined}
        onCancel={() => {
          if (!deleteLink.isPending) setDeleteTarget(null);
        }}
      />
    </section>
  );
}

function AdminShareAccessLogsModal({ link, onClose }: { link: AdminShareLinkDTO; onClose: () => void }) {
  const text = useText();
  const [page, setPage] = useState(1);
  const logs = useQuery({
    queryKey: queryKeys.admin.shareLinkAccessLogs(link.id, page),
    queryFn: () => api<PaginatedResponse<ShareLinkAccessLogDTO>>(`/api/admin/share-links/${link.id}/access-logs?page=${page}&per_page=20`),
    retry: false
  });
  return (
    <DialogShell
      className="modal-panel automation-log-modal"
      titleId="admin-share-access-logs-title"
      descriptionId="admin-share-access-logs-desc"
      onClose={onClose}
    >
      <div className="modal-header">
        <div>
          <h2 id="admin-share-access-logs-title">{text.shareLinks.accessLogsTitle}</h2>
          <p id="admin-share-access-logs-desc">{shareTargetText(link, text)}</p>
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
          emptyLabel={text.shareLinks.noLogs}
          loading={logs.isLoading}
          loadingLabel={text.common.loading}
          error={logs.isError}
          errorLabel={queryErrorMessage(logs.error, text.shareLinks.noLogs)}
          retryLabel={text.common.retry}
          onRetry={() => logs.refetch()}
          retryPending={logs.isFetching}
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

function buildAdminShareLinksQuery(search: string, filters: AdminShareFilters, page: number, perPage: number) {
  const params = new URLSearchParams({
    page: String(page),
    per_page: String(perPage)
  });
  if (search.trim()) params.set('q', search.trim());
  if (filters.status !== 'all') params.set('status', filters.status);
  return params.toString();
}

function ownerTarget(link: AdminShareLinkDTO, text: ReturnType<typeof useText>) {
  return (
    <div className="admin-domain-cell">
      <b>{link.owner_email || text.admin.shareLinks.ownerUnknown}</b>
      <small>{link.owner_role || `#${link.owner_id}`}</small>
    </div>
  );
}

function shareTarget(link: AdminShareLinkDTO, text: ReturnType<typeof useText>) {
  return (
    <div className="admin-domain-cell">
      <b>{shareTargetText(link, text)}</b>
      <small>{link.mailbox_id ? `#${link.mailbox_id}` : '-'}</small>
    </div>
  );
}

function shareTargetText(link: AdminShareLinkDTO, text: ReturnType<typeof useText>) {
  if (link.resource_type === 'mailbox') {
    return link.mailbox_email || (link.mailbox_id ? `${text.shareLinks.mailbox} #${link.mailbox_id}` : text.shareLinks.mailbox);
  }
  return text.shareLinks.unsupportedResource;
}

function shareStatus(link: AdminShareLinkDTO, text: ReturnType<typeof useText>) {
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
