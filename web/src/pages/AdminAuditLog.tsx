import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { api } from '../api';
import type { AuditLog, AuditLogPage } from '../types';
import { relativeTime } from '../lib/display';
import { currentText, useText } from '../locales';
import { useTableUrlState } from '../hooks/useTableUrlState';
import { DataTable, DataTableViewOptions, InfoTip, PaginationControls } from '../components/shared';
import type { DataTableColumn } from '../components/shared';

type AuditLogFilters = {
  category: string;
  severity: string;
  action: string;
  targetType: string;
};

const auditActionOptions = [
  'api_key.reveal',
  'api_key.delete',
  'api_key.create',
  'api_key.patch',
  'user.delete',
  'user.patch',
  'user.create',
  'domain.delete',
  'domain.patch',
  'domain.request',
  'oauth_provider.patch',
  'domain_check_settings.patch',
  'mailbox.create',
  'mailbox.reuse',
  'mailbox.delete',
  'oauth.login',
  'domain_check_run.create'
] as const;

const AUDIT_PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
const AUDIT_CATEGORY_OPTIONS = ['security', 'activity', 'system', 'all'] as const;
const AUDIT_SEVERITY_OPTIONS = ['all', 'critical', 'warning', 'info'] as const;
const AUDIT_TARGET_OPTIONS = ['all', 'user', 'domain', 'api_key', 'mailbox', 'oauth_provider'] as const;

export function AdminAuditLog() {
  const text = useText();
  const {
    page: auditPage,
    setPage: setAuditPage,
    pageSize: auditPerPage,
    setPageSize: setAuditPerPage,
    search: auditSearch,
    setSearch: setAuditSearch,
    filters: auditFilters,
    setFilter: setAuditFilter
  } = useTableUrlState<AuditLogFilters>({
    defaultPageSize: 20,
    defaultSearch: '',
    defaultFilters: defaultAuditFilters(),
    filterOptions: {
      category: AUDIT_CATEGORY_OPTIONS,
      severity: AUDIT_SEVERITY_OPTIONS,
      action: ['all', ...auditActionOptions],
      targetType: AUDIT_TARGET_OPTIONS
    },
    filterParams: {
      targetType: 'target_type'
    },
    pageSizeOptions: AUDIT_PAGE_SIZE_OPTIONS
  });
  const [hiddenColumnKeys, setHiddenColumnKeys] = useState<string[]>([]);

  const auditLogs = useQuery({
    queryKey: ['admin-audit-logs', auditFilters, auditSearch, auditPage, auditPerPage],
    queryFn: () => api<AuditLogPage>(`/api/admin/audit-logs?${buildAuditLogQuery(auditFilters, auditSearch, auditPage, auditPerPage)}`),
    retry: false,
    staleTime: 30_000
  });
  const columns = useMemo<DataTableColumn[]>(() => [
    { key: 'created-at', header: text.admin.auditLogs.colTime, width: '8rem', mobileSubtitle: true },
    { key: 'event', header: text.admin.auditLogs.colEvent, minWidth: '18rem', hideable: false, mobileTitle: true },
    { key: 'severity', header: text.admin.auditLogs.colSeverity, align: 'center', width: '8rem', mobileBadge: true },
    { key: 'actor', header: text.admin.auditLogs.colActor, minWidth: '9rem', mobilePriority: 1 },
    { key: 'target', header: text.admin.auditLogs.colTarget, minWidth: '12rem', mobilePriority: 2 }
  ], [text]);

  return (
    <section className="panel admin-table-panel" id="admin-audit-logs">
      <div className="panel-header admin-panel-header">
        <div>
          <h2>{text.admin.auditLogs.title}<InfoTip text={text.admin.auditLogs.desc} /></h2>
        </div>
        <div className="table-actions">
          <button
            className="btn-secondary"
            type="button"
            onClick={() => auditLogs.refetch()}
            disabled={auditLogs.isFetching}
          >
            <RefreshCw size={14} className={auditLogs.isFetching ? 'animate-spin' : ''} />
            {text.common.refresh}
          </button>
          <DataTableViewOptions
            columns={columns}
            hiddenColumnKeys={hiddenColumnKeys}
            onHiddenColumnKeysChange={setHiddenColumnKeys}
            label={text.common.view}
            menuLabel={text.common.toggleColumns}
            resetLabel={text.common.reset}
            emptyLabel={text.common.noToggleColumns}
          />
        </div>
      </div>
      <div className="admin-audit-filters">
        <label className="admin-audit-search">
          <span>{text.admin.auditLogs.search}</span>
          <div className="admin-audit-search-box">
            <Search size={15} />
            <input
              value={auditSearch}
              onChange={(event) => setAuditSearch(event.target.value, 'replace')}
              placeholder={text.admin.auditLogs.searchPlaceholder}
            />
          </div>
        </label>
        <label>
          <span>{text.admin.auditLogs.filterCategory}</span>
          <select className="input" value={auditFilters.category} onChange={(event) => setAuditFilter('category', event.target.value)}>
            <option value="security">{text.admin.auditLogs.categorySecurity}</option>
            <option value="activity">{text.admin.auditLogs.categoryActivity}</option>
            <option value="system">{text.admin.auditLogs.categorySystem}</option>
            <option value="all">{text.admin.auditLogs.all}</option>
          </select>
        </label>
        <label>
          <span>{text.admin.auditLogs.filterSeverity}</span>
          <select className="input" value={auditFilters.severity} onChange={(event) => setAuditFilter('severity', event.target.value)}>
            <option value="all">{text.admin.auditLogs.all}</option>
            <option value="critical">{text.admin.auditLogs.severityCritical}</option>
            <option value="warning">{text.admin.auditLogs.severityWarning}</option>
            <option value="info">{text.admin.auditLogs.severityInfo}</option>
          </select>
        </label>
        <label>
          <span>{text.admin.auditLogs.filterAction}</span>
          <select className="input" value={auditFilters.action} onChange={(event) => setAuditFilter('action', event.target.value)}>
            <option value="all">{text.admin.auditLogs.all}</option>
            {auditActionOptions.map((action) => (
              <option key={action} value={action}>{auditActionLabel(action)}</option>
            ))}
          </select>
        </label>
        <label>
          <span>{text.admin.auditLogs.filterTarget}</span>
          <select className="input" value={auditFilters.targetType} onChange={(event) => setAuditFilter('targetType', event.target.value)}>
            <option value="all">{text.admin.auditLogs.all}</option>
            <option value="user">{text.admin.auditLogs.targetUser}</option>
            <option value="domain">{text.admin.auditLogs.targetDomain}</option>
            <option value="api_key">{text.admin.auditLogs.targetAPIKey}</option>
            <option value="mailbox">{text.admin.auditLogs.targetMailbox}</option>
            <option value="oauth_provider">{text.admin.auditLogs.targetOAuth}</option>
          </select>
        </label>
      </div>
      {auditLogs.isError && (
        <TableQueryError
          label={auditLogs.error instanceof Error && auditLogs.error.message ? auditLogs.error.message : text.admin.auditLogs.empty}
          actionLabel={text.common.retry}
          isFetching={auditLogs.isFetching}
          onRetry={() => auditLogs.refetch()}
        />
      )}
      <DataTable
        ariaLabel={text.admin.auditLogs.title}
        emptyLabel={auditLogs.isLoading ? text.common.loading : text.admin.auditLogs.empty}
        columns={columns}
        hiddenColumnKeys={hiddenColumnKeys}
        onHiddenColumnKeysChange={setHiddenColumnKeys}
        hiddenLabel={text.common.noColumnsSelected}
        showAllColumnsLabel={text.common.showAllColumns}
        rows={(auditLogs.data?.items || []).map((log) => ({
          key: log.id,
          cells: [
            relativeTime(log.created_at),
            <div className="admin-audit-event">
              <b>{auditActionLabel(log.action)}</b>
              <small>
                {auditCategoryLabel(log.category)}
                {' · '}
                <code>{log.action}</code>
                {log.metadata ? ` · ${log.metadata}` : ''}
              </small>
            </div>,
            <SeverityPill severity={auditSeverityLevel(log.severity)}>{auditSeverityLabel(log.severity)}</SeverityPill>,
            log.actor || '-',
            <span className="admin-log-target">{log.target || '-'}{log.target && <InfoTip text={log.target} />}</span>
          ]
        }))}
      />
      <div className="admin-audit-pagination">
        <PaginationControls
          page={auditLogs.data?.page || auditPage}
          totalPages={auditLogs.data?.total_pages || 1}
          onPageChange={setAuditPage}
          rowsPerPage={auditPerPage}
          rowsPerPageOptions={AUDIT_PAGE_SIZE_OPTIONS}
          onRowsPerPageChange={setAuditPerPage}
          rowsPerPageLabel={text.common.rowsPerPage}
        />
      </div>
    </section>
  );
}

function SeverityPill({ severity, children }: { severity: 'ok' | 'warning' | 'critical'; children: string }) {
  return <span className={`severity-pill severity-${severity}`}>{children}</span>;
}

function TableQueryError({
  label,
  actionLabel,
  isFetching,
  onRetry
}: {
  label: string;
  actionLabel: string;
  isFetching: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="grid gap-3 rounded-lg border border-[var(--bad)]/30 bg-[var(--bad)]/5 p-3" role="alert">
      <div className="grid min-h-24 place-items-center rounded-lg border border-dashed border-[var(--border)] text-sm text-[var(--bad)]">
        {label}
      </div>
      <button className="btn-secondary btn-sm justify-self-center" type="button" onClick={onRetry} disabled={isFetching}>
        <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
        {actionLabel}
      </button>
    </div>
  );
}

function defaultAuditFilters(): AuditLogFilters {
  return {
    category: 'security',
    severity: 'all',
    action: 'all',
    targetType: 'all'
  };
}

function buildAuditLogQuery(filters: AuditLogFilters, search: string, page: number, perPage: number) {
  const params = new URLSearchParams({
    page: String(page),
    per_page: String(perPage)
  });
  if (filters.category !== 'all') {
    params.set('category', filters.category);
  }
  if (filters.severity !== 'all') {
    params.set('severity', filters.severity);
  }
  if (filters.action !== 'all') {
    params.set('action', filters.action);
  }
  if (filters.targetType !== 'all') {
    params.set('target_type', filters.targetType);
  }
  if (search.trim()) {
    params.set('q', search.trim());
  }
  return params.toString();
}

function auditActionLabel(action: string) {
  return currentText().admin.auditLogs.actions[action] || action;
}

function auditCategoryLabel(category: AuditLog['category']) {
  const text = currentText().admin.auditLogs;
  const labels: Record<string, string> = {
    security: text.categorySecurity,
    activity: text.categoryActivity,
    system: text.categorySystem
  };
  return labels[category] || category;
}

function auditSeverityLabel(severity: AuditLog['severity']) {
  const text = currentText().admin.auditLogs;
  const labels: Record<string, string> = {
    critical: text.severityCritical,
    warning: text.severityWarning,
    info: text.severityInfo
  };
  return labels[severity] || severity;
}

function auditSeverityLevel(severity: AuditLog['severity']): 'ok' | 'warning' | 'critical' {
  if (severity === 'critical') return 'critical';
  if (severity === 'warning') return 'warning';
  return 'ok';
}
