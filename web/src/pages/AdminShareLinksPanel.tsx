import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ListChecks, Search, ShieldOff, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import type { AdminShareLinkDTO, PaginatedResponse, ShareLinkAccessLogDTO } from '../api';
import { api, postJSON } from '../api';
import { useText } from '../locales';
import { relativeTime } from '../lib/display';
import { useTableUrlState } from '../hooks/useTableUrlState';
import { DataTable, DataTableToolbar, DataTableViewOptions, DialogShell, EmptyState, IconButton, PaginationControls } from '../components/shared';
import type { DataTableColumn } from '../components/shared';

const ADMIN_SHARE_PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
const ADMIN_SHARE_STATUS_OPTIONS = ['all', 'active', 'revoked', 'expired'] as const;

type AdminShareFilters = {
  status: (typeof ADMIN_SHARE_STATUS_OPTIONS)[number];
};

const DEFAULT_ADMIN_SHARE_FILTERS: AdminShareFilters = {
  status: 'all'
};

export function AdminShareLinksPanel() {
  const text = useText();
  const queryClient = useQueryClient();
  const [logsTarget, setLogsTarget] = useState<AdminShareLinkDTO | null>(null);
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
    queryKey: ['admin-share-links', page, pageSize, search, filters],
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
    mutationFn: (link: AdminShareLinkDTO) => {
      if (!window.confirm(text.admin.shareLinks.revokeConfirm.replace('{target}', shareTargetText(link, text)))) {
        throw new Error('Canceled');
      }
      return postJSON<AdminShareLinkDTO>(`/api/admin/share-links/${link.id}/revoke`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-share-links'] });
      toast.success(text.admin.shareLinks.revokedToast);
    },
    onError: (error) => {
      if (error.message !== 'Canceled') toast.error(error.message);
    }
  });
  const deleteLink = useMutation({
    mutationFn: (link: AdminShareLinkDTO) => {
      if (!window.confirm(text.admin.shareLinks.deleteConfirm.replace('{target}', shareTargetText(link, text)))) {
        throw new Error('Canceled');
      }
      return api(`/api/admin/share-links/${link.id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-share-links'] });
      toast.success(text.admin.shareLinks.deletedToast);
    },
    onError: (error) => {
      if (error.message !== 'Canceled') toast.error(error.message);
    }
  });

  const resultCount = text.admin.shareLinks.resultCount
    .replace('{shown}', String(list.length))
    .replace('{total}', String(links.data?.total ?? 0));

  return (
    <section className="panel admin-table-panel" id="admin-share-links">
      <div className="panel-header admin-panel-header">
        <div>
          <h2>{text.admin.shareLinks.title}</h2>
          <p>{text.admin.shareLinks.desc}</p>
        </div>
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
      {links.isError ? (
        <EmptyState label={links.error.message} />
      ) : (
        <DataTable
          ariaLabel={text.admin.shareLinks.title}
          emptyLabel={links.isLoading ? text.common.loading : text.admin.shareLinks.empty}
          columns={columns}
          hiddenColumnKeys={hiddenColumnKeys}
          onHiddenColumnKeysChange={setHiddenColumnKeys}
          hiddenLabel={text.common.noColumnsSelected}
          showAllColumnsLabel={text.common.showAllColumns}
          rows={list.map((link) => ({
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
                <IconButton title={text.shareLinks.logs} onClick={() => setLogsTarget(link)}>
                  <ListChecks size={14} />
                </IconButton>
                <IconButton title={text.shareLinks.revoke} onClick={() => revoke.mutate(link)} disabled={revoke.isPending || Boolean(link.revoked_at)}>
                  <ShieldOff size={14} />
                </IconButton>
                <IconButton title={text.shareLinks.deleteLink} onClick={() => deleteLink.mutate(link)} disabled={deleteLink.isPending}>
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
        onPageChange={shareUrlState.setPage}
        rowsPerPage={pageSize}
        rowsPerPageOptions={ADMIN_SHARE_PAGE_SIZE_OPTIONS}
        onRowsPerPageChange={shareUrlState.setPageSize}
        rowsPerPageLabel={text.common.rowsPerPage}
      />
      {logsTarget && <AdminShareAccessLogsModal link={logsTarget} onClose={() => setLogsTarget(null)} />}
    </section>
  );
}

function AdminShareAccessLogsModal({ link, onClose }: { link: AdminShareLinkDTO; onClose: () => void }) {
  const text = useText();
  const [page, setPage] = useState(1);
  const logs = useQuery({
    queryKey: ['admin-share-link-access-logs', link.id, page],
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

function buildAdminShareLinksQuery(search: string, filters: AdminShareFilters, page: number, perPage: number) {
  const params = new URLSearchParams({
    page: String(page),
    per_page: String(perPage)
  });
  if (search.trim()) {
    params.set('q', search.trim());
  }
  if (filters.status !== 'all') {
    params.set('status', filters.status);
  }
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
