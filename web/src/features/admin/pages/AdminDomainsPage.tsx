import { useQueryClient } from '@tanstack/react-query';
import { Loader2, RefreshCw, Search, ShieldAlert, Trash2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useText } from '../../../locales';
import { formatDomainExpiry } from '../../../lib/display';
import { notifySuccess } from '../../../lib/feedback';
import { queryKeys } from '../../../lib/queryKeys';
import { useAppStore } from '../../../store';
import { useTableUrlState } from '../../../hooks/useTableUrlState';
import { ConfirmModal, DataTable, DataTableToolbar, DataTableViewOptions, PaginationControls } from '../../../components/shared';
import type { DataTableColumn } from '../../../components/shared';
import type { AdminDomainHealth } from '../../../types';
import { AdminPageFrame } from '../components/AdminPageFrame';
import { SeverityPill } from '../components/SeverityPill';
import {
  domainIssueLabel,
  queryErrorMessage
} from '../utils/adminFormatting';
import {
  useAdminDomainHealthQuery,
  useAdminStatsQuery,
  useDeleteAdminDomainMutation,
  useRecheckDomainMutation,
  useUpdateDomainModeMutation
} from '../hooks/useAdminQueries';
import {
  DEFAULT_DOMAIN_HEALTH_FILTERS,
  DOMAIN_HEALTH_MODE_OPTIONS,
  DOMAIN_HEALTH_MX_OPTIONS,
  DOMAIN_HEALTH_PAGE_SIZE_OPTIONS,
  DOMAIN_HEALTH_SEVERITY_OPTIONS,
  DOMAIN_HEALTH_STATUS_OPTIONS,
  type DomainHealthFilters
} from '../services/adminService';

export function AdminDomainsPage() {
  const text = useText();
  const language = useAppStore((state) => state.language);
  const queryClient = useQueryClient();
  const feedbackOriginRef = useRef<HTMLElement | null>(null);
  const [hiddenColumnKeys, setHiddenColumnKeys] = useState<string[]>([]);
  const [modeTarget, setModeTarget] = useState<{ domain: AdminDomainHealth; mode: AdminDomainHealth['mode'] } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminDomainHealth | null>(null);
  const domainHealthUrlState = useTableUrlState<DomainHealthFilters>({
    defaultPageSize: 20,
    defaultSearch: '',
    defaultFilters: DEFAULT_DOMAIN_HEALTH_FILTERS,
    pageParam: 'healthPage',
    pageSizeParam: 'healthPageSize',
    searchParam: 'domainSearch',
    filterParams: {
      mode: 'domainMode',
      status: 'domainStatus',
      mx: 'domainMx',
      severity: 'domainSeverity'
    },
    filterOptions: {
      mode: DOMAIN_HEALTH_MODE_OPTIONS,
      status: DOMAIN_HEALTH_STATUS_OPTIONS,
      mx: DOMAIN_HEALTH_MX_OPTIONS,
      severity: DOMAIN_HEALTH_SEVERITY_OPTIONS
    },
    pageSizeOptions: DOMAIN_HEALTH_PAGE_SIZE_OPTIONS
  });
  const stats = useAdminStatsQuery();
  const domainHealth = useAdminDomainHealthQuery(
    domainHealthUrlState.filters,
    domainHealthUrlState.search,
    domainHealthUrlState.page,
    domainHealthUrlState.pageSize
  );

  const invalidateDomainAdminQueries = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.domainHealthRoot });
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.stats });
    queryClient.invalidateQueries({ queryKey: queryKeys.domains.all });
    queryClient.invalidateQueries({ queryKey: queryKeys.domains.available });
    queryClient.invalidateQueries({ queryKey: queryKeys.userOnboarding });
  };

  const recheckDomain = useRecheckDomainMutation({
    onSuccess: () => {
      invalidateDomainAdminQueries();
      notifySuccess(text.admin.domainHealth.recheckDone, { origin: feedbackOriginRef.current });
      feedbackOriginRef.current = null;
    },
    onError: (error) => {
      feedbackOriginRef.current = null;
      toast.error(error.message);
    }
  });

  const updateDomainMode = useUpdateDomainModeMutation({
    onSuccess: (_, variables) => {
      invalidateDomainAdminQueries();
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.auditLogsRoot });
      setModeTarget(null);
      const message = variables.mode === 'private'
        ? text.admin.domainHealth.makePrivateDone
        : text.admin.domainHealth.makePublicDone;
      notifySuccess(message, { origin: feedbackOriginRef.current });
      feedbackOriginRef.current = null;
    },
    onError: (error) => {
      feedbackOriginRef.current = null;
      toast.error(error.message);
    }
  });

  const deleteDomain = useDeleteAdminDomainMutation({
    onSuccess: () => {
      invalidateDomainAdminQueries();
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.auditLogsRoot });
      setDeleteTarget(null);
      notifySuccess(text.admin.domainHealth.deleteDone, { origin: feedbackOriginRef.current });
      feedbackOriginRef.current = null;
    },
    onError: (error) => {
      feedbackOriginRef.current = null;
      toast.error(error.message);
    }
  });

  const columns = useMemo<DataTableColumn[]>(() => [
    { key: 'domain', header: text.admin.domainHealth.colDomain, minWidth: '14rem', hideable: false, mobileTitle: true },
    { key: 'owner', header: text.admin.domainHealth.colOwner, minWidth: '12rem', mobileSubtitle: true },
    { key: 'status', header: text.admin.domainHealth.colStatus, align: 'center', width: '8rem', mobileBadge: true },
    { key: 'mode', header: text.admin.domainHealth.colMode, width: '10rem', mobilePriority: 1 },
    { key: 'expires', header: text.admin.domainHealth.colExpires, width: '8rem', mobilePriority: 3 },
    { key: 'mailboxes', header: text.admin.domainHealth.colMailboxes, align: 'right', width: '7rem', mobilePriority: 2 },
    { key: 'messages', header: text.admin.domainHealth.colMessages, align: 'right', width: '7rem', mobilePriority: 2 },
    { key: 'actions', role: 'actions', header: text.admin.domainHealth.colActions, align: 'right', minWidth: '14rem', hideable: false }
  ], [text]);

  const healthPage = domainHealth.data;
  const healthItems = healthPage?.items || [];
  const resultCount = text.admin.domainHealth.resultCount
    .replace('{shown}', String(healthItems.length))
    .replace('{total}', String(healthPage?.total ?? 0));
  const recheckingDomainId = recheckDomain.isPending ? recheckDomain.variables?.id : null;
  const changingModeDomainId = updateDomainMode.isPending ? updateDomainMode.variables?.domain.id : null;
  const deletingDomainId = deleteDomain.isPending ? deleteDomain.variables?.id : null;
  const isRefreshing = stats.isFetching || domainHealth.isFetching;

  const refreshDomains = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.domainHealthRoot });
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.stats });
  };

  return (
    <AdminPageFrame
      title={text.page['admin-domains']}
      actions={(
        <button className="btn-secondary" onClick={refreshDomains} disabled={isRefreshing} aria-label={text.admin.refresh}>
          <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} aria-hidden="true" />
          {text.admin.refresh}
        </button>
      )}
    >
      <section className="panel admin-table-panel" id="admin-domain-health">
        <div className="panel-header admin-panel-header">
          <div>
            <h2>{text.admin.domainHealth.title}</h2>
            <p>{text.admin.domainHealth.desc.replace('{failed}', String(stats.data?.failed_domains ?? 0)).replace('{stale}', String(stats.data?.stale_domains ?? 0))}</p>
          </div>
        </div>
        <DataTableToolbar
          className="admin-domain-health-toolbar"
          search={(
            <label className="admin-domain-health-search" aria-label={text.admin.domainHealth.search}>
              <Search size={15} aria-hidden="true" />
              <input
                value={domainHealthUrlState.search}
                onChange={(event) => domainHealthUrlState.setSearch(event.target.value, 'replace')}
                placeholder={text.admin.domainHealth.searchPlaceholder}
              />
            </label>
          )}
          filters={(
            <div className="admin-domain-health-filters">
              <select className="input" value={domainHealthUrlState.filters.mode} aria-label={text.admin.domainHealth.filterMode} onChange={(event) => domainHealthUrlState.setFilter('mode', event.target.value)}>
                <option value="all">{text.admin.domainHealth.filterModeAll}</option>
                <option value="public">{text.domains.modePublic}</option>
                <option value="private">{text.domains.modePrivate}</option>
              </select>
              <select className="input" value={domainHealthUrlState.filters.status} aria-label={text.admin.domainHealth.filterStatus} onChange={(event) => domainHealthUrlState.setFilter('status', event.target.value)}>
                <option value="all">{text.admin.domainHealth.filterStatusAll}</option>
                <option value="active">{text.domains.enabled}</option>
                <option value="inactive">{text.domains.inactive}</option>
              </select>
              <select className="input" value={domainHealthUrlState.filters.mx} aria-label={text.admin.domainHealth.filterMx} onChange={(event) => domainHealthUrlState.setFilter('mx', event.target.value)}>
                <option value="all">{text.admin.domainHealth.filterMxAll}</option>
                <option value="verified">{text.admin.domainHealth.mxVerified}</option>
                <option value="failed">{text.admin.domainHealth.mxFailed}</option>
                <option value="wildcard_failed">{text.admin.domainHealth.mxWildcardFailed}</option>
                <option value="unchecked">{text.admin.domainHealth.mxUnchecked}</option>
                <option value="stale">{text.admin.domainHealth.mxStale}</option>
              </select>
              <select className="input" value={domainHealthUrlState.filters.severity} aria-label={text.admin.domainHealth.filterSeverity} onChange={(event) => domainHealthUrlState.setFilter('severity', event.target.value)}>
                <option value="all">{text.admin.domainHealth.filterSeverityAll}</option>
                <option value="critical">{text.admin.domainHealth.severityCritical}</option>
                <option value="warning">{text.admin.domainHealth.severityWarning}</option>
                <option value="ok">{text.admin.domainHealth.severityOk}</option>
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
        {stats.isError && (
          <div className="admin-risk admin-risk-warning" role="alert">
            <ShieldAlert size={16} />
            <span><small>{queryErrorMessage(stats.error, text.admin.dashboard.statsError)}</small></span>
          </div>
        )}
        <DataTable
          ariaLabel={text.admin.domainHealth.title}
          emptyLabel={text.admin.domainHealth.empty}
          loading={domainHealth.isLoading}
          loadingLabel={text.common.loading}
          error={domainHealth.isError}
          errorLabel={queryErrorMessage(domainHealth.error, text.admin.domainHealth.empty)}
          retryLabel={text.common.retry}
          onRetry={() => domainHealth.refetch()}
          retryPending={domainHealth.isFetching}
          columns={columns}
          hiddenColumnKeys={hiddenColumnKeys}
          onHiddenColumnKeysChange={setHiddenColumnKeys}
          hiddenLabel={text.common.noColumnsSelected}
          showAllColumnsLabel={text.common.showAllColumns}
          rows={healthItems.map((domain) => {
            const rowPending = recheckingDomainId === domain.id || changingModeDomainId === domain.id || deletingDomainId === domain.id;
            return {
              key: domain.id,
              cells: [
                <div className="admin-domain-cell">
                  <b>{domain.domain}</b>
                  <small>{domain.last_check_message || domain.last_mx_records || '-'}</small>
                </div>,
                domain.owner_email || text.admin.domainHealth.ownerUnknown,
                <SeverityPill severity={domain.severity}>{domainIssueLabel(domain.issue)}</SeverityPill>,
                <DomainModeControl
                  domain={domain}
                  pending={changingModeDomainId === domain.id}
                  disabled={rowPending}
                  onChange={(mode, origin) => {
                    feedbackOriginRef.current = origin;
                    setModeTarget({ domain, mode });
                  }}
                />,
                formatDomainExpiry(domain.domain_expires_at, language),
                String(domain.mailbox_count ?? domain.mailbox_created_count ?? 0),
                String(domain.message_count ?? 0),
                <div className="table-actions">
                  <button className="btn-ghost" type="button" onClick={(event) => {
                    feedbackOriginRef.current = event.currentTarget;
                    recheckDomain.mutate(domain);
                  }} disabled={rowPending} aria-label={`${text.admin.domainHealth.recheck} ${domain.domain}`}>
                    {recheckingDomainId === domain.id ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}
                    {text.admin.domainHealth.recheck}
                  </button>
                  <button className="btn-ghost" type="button" onClick={(event) => {
                    feedbackOriginRef.current = event.currentTarget;
                    setDeleteTarget(domain);
                  }} disabled={rowPending} aria-label={`${text.admin.domainHealth.delete} ${domain.domain}`}>
                    {deletingDomainId === domain.id ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Trash2 size={14} aria-hidden="true" />}
                    {text.admin.domainHealth.delete}
                  </button>
                </div>
              ]
            };
          })}
        />
        <PaginationControls
          page={healthPage?.page || domainHealthUrlState.page}
          totalPages={healthPage?.total_pages || 1}
          onPageChange={domainHealthUrlState.setPage}
          rowsPerPage={domainHealthUrlState.pageSize}
          rowsPerPageOptions={[...DOMAIN_HEALTH_PAGE_SIZE_OPTIONS]}
          onRowsPerPageChange={domainHealthUrlState.setPageSize}
          rowsPerPageLabel={text.common.rowsPerPage}
        />
      </section>
      <ConfirmModal
        open={modeTarget !== null}
        title={modeTarget?.mode === 'private' ? text.domains.modePrivate : text.domains.modePublic}
        description={modeTarget
          ? (modeTarget.mode === 'private' ? text.admin.domainHealth.privateConfirm : text.admin.domainHealth.publicConfirm).replace('{domain}', modeTarget.domain.domain)
          : ''}
        confirmText={modeTarget?.mode === 'private' ? text.domains.modePrivate : text.domains.modePublic}
        cancelText={text.common.cancel}
        confirmLoading={updateDomainMode.isPending}
        onConfirm={() => modeTarget ? updateDomainMode.mutateAsync({ domain: modeTarget.domain, mode: modeTarget.mode }) : undefined}
        onCancel={() => {
          if (updateDomainMode.isPending) return;
          feedbackOriginRef.current = null;
          setModeTarget(null);
        }}
      />
      <ConfirmModal
        open={deleteTarget !== null}
        title={text.admin.domainHealth.delete}
        description={deleteTarget ? text.admin.domainHealth.deleteConfirm.replace('{domain}', deleteTarget.domain) : ''}
        confirmText={text.admin.domainHealth.delete}
        cancelText={text.common.cancel}
        danger
        confirmLoading={deleteDomain.isPending}
        onConfirm={() => deleteTarget ? deleteDomain.mutateAsync(deleteTarget) : undefined}
        onCancel={() => {
          if (deleteDomain.isPending) return;
          feedbackOriginRef.current = null;
          setDeleteTarget(null);
        }}
      />
    </AdminPageFrame>
  );
}

function DomainModeControl({
  domain,
  pending,
  disabled,
  onChange
}: {
  domain: AdminDomainHealth;
  pending: boolean;
  disabled: boolean;
  onChange: (mode: AdminDomainHealth['mode'], origin: HTMLElement) => void;
}) {
  const text = useText();
  return (
    <div className="segmented-control admin-domain-mode-control" aria-busy={pending ? 'true' : undefined}>
      <button
        type="button"
        className={`segment-choice ${domain.mode === 'private' ? 'segment-choice-active' : ''}`}
        disabled={disabled || domain.mode === 'private'}
        onClick={(event) => onChange('private', event.currentTarget)}
      >
        {text.domains.modePrivate}
      </button>
      <button
        type="button"
        className={`segment-choice ${domain.mode === 'public' ? 'segment-choice-active' : ''}`}
        disabled={disabled || domain.mode === 'public'}
        onClick={(event) => onChange('public', event.currentTarget)}
      >
        {text.domains.modePublic}
      </button>
    </div>
  );
}
