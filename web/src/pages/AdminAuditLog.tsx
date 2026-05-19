import { useQuery } from '@tanstack/react-query';
import { useState, type Dispatch, type SetStateAction } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { api } from '../api';
import type { AuditLog, AuditLogPage } from '../types';
import { relativeTime } from '../lib/display';
import { currentText, useText } from '../locales';
import { DataTable, InfoTip, PaginationControls } from '../components/shared';

type AuditLogFilters = {
  category: string;
  severity: string;
  action: string;
  targetType: string;
  q: string;
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
];

export function AdminAuditLog() {
  const text = useText();

  const [auditFilters, setAuditFilters] = useState<AuditLogFilters>(() => defaultAuditFilters());
  const [auditPage, setAuditPage] = useState(1);
  const auditPerPage = 20;

  const auditLogs = useQuery({
    queryKey: ['admin-audit-logs', auditFilters, auditPage],
    queryFn: () => api<AuditLogPage>(`/api/admin/audit-logs?${buildAuditLogQuery(auditFilters, auditPage, auditPerPage)}`),
    retry: false,
    staleTime: 30_000
  });

  return (
    <section className="panel" id="admin-audit-logs">
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
        </div>
      </div>
      <div className="admin-audit-filters">
        <label className="admin-audit-search">
          <span>{text.admin.auditLogs.search}</span>
          <div className="admin-audit-search-box">
            <Search size={15} />
            <input
              value={auditFilters.q}
              onChange={(event) => updateAuditFilter(setAuditFilters, setAuditPage, { q: event.target.value })}
              placeholder={text.admin.auditLogs.searchPlaceholder}
            />
          </div>
        </label>
        <label>
          <span>{text.admin.auditLogs.filterCategory}</span>
          <select className="input" value={auditFilters.category} onChange={(event) => updateAuditFilter(setAuditFilters, setAuditPage, { category: event.target.value })}>
            <option value="security">{text.admin.auditLogs.categorySecurity}</option>
            <option value="activity">{text.admin.auditLogs.categoryActivity}</option>
            <option value="system">{text.admin.auditLogs.categorySystem}</option>
            <option value="all">{text.admin.auditLogs.all}</option>
          </select>
        </label>
        <label>
          <span>{text.admin.auditLogs.filterSeverity}</span>
          <select className="input" value={auditFilters.severity} onChange={(event) => updateAuditFilter(setAuditFilters, setAuditPage, { severity: event.target.value })}>
            <option value="all">{text.admin.auditLogs.all}</option>
            <option value="critical">{text.admin.auditLogs.severityCritical}</option>
            <option value="warning">{text.admin.auditLogs.severityWarning}</option>
            <option value="info">{text.admin.auditLogs.severityInfo}</option>
          </select>
        </label>
        <label>
          <span>{text.admin.auditLogs.filterAction}</span>
          <select className="input" value={auditFilters.action} onChange={(event) => updateAuditFilter(setAuditFilters, setAuditPage, { action: event.target.value })}>
            <option value="all">{text.admin.auditLogs.all}</option>
            {auditActionOptions.map((action) => (
              <option key={action} value={action}>{auditActionLabel(action)}</option>
            ))}
          </select>
        </label>
        <label>
          <span>{text.admin.auditLogs.filterTarget}</span>
          <select className="input" value={auditFilters.targetType} onChange={(event) => updateAuditFilter(setAuditFilters, setAuditPage, { targetType: event.target.value })}>
            <option value="all">{text.admin.auditLogs.all}</option>
            <option value="user">{text.admin.auditLogs.targetUser}</option>
            <option value="domain">{text.admin.auditLogs.targetDomain}</option>
            <option value="api_key">{text.admin.auditLogs.targetAPIKey}</option>
            <option value="mailbox">{text.admin.auditLogs.targetMailbox}</option>
            <option value="oauth_provider">{text.admin.auditLogs.targetOAuth}</option>
          </select>
        </label>
      </div>
      <DataTable
        ariaLabel={text.admin.auditLogs.title}
        emptyLabel={text.admin.auditLogs.empty}
        columns={[
          { key: 'created-at', header: text.admin.auditLogs.colTime, width: '8rem' },
          { key: 'event', header: text.admin.auditLogs.colEvent, minWidth: '18rem' },
          { key: 'severity', header: text.admin.auditLogs.colSeverity, align: 'center', width: '8rem' },
          { key: 'actor', header: text.admin.auditLogs.colActor, minWidth: '9rem' },
          { key: 'target', header: text.admin.auditLogs.colTarget, minWidth: '12rem' }
        ]}
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
      {auditLogs.data && auditLogs.data.total_pages > 1 && (
        <div className="admin-audit-pagination">
          <PaginationControls
            page={auditLogs.data.page}
            totalPages={auditLogs.data.total_pages}
            onPageChange={setAuditPage}
          />
        </div>
      )}
    </section>
  );
}

function SeverityPill({ severity, children }: { severity: 'ok' | 'warning' | 'critical'; children: string }) {
  return <span className={`severity-pill severity-${severity}`}>{children}</span>;
}

function defaultAuditFilters(): AuditLogFilters {
  return {
    category: 'security',
    severity: 'all',
    action: 'all',
    targetType: 'all',
    q: ''
  };
}

function updateAuditFilter(
  setFilters: Dispatch<SetStateAction<AuditLogFilters>>,
  setPage: Dispatch<SetStateAction<number>>,
  patch: Partial<AuditLogFilters>
) {
  setFilters((current) => ({ ...current, ...patch }));
  setPage(1);
}

function buildAuditLogQuery(filters: AuditLogFilters, page: number, perPage: number) {
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
  if (filters.q.trim()) {
    params.set('q', filters.q.trim());
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
