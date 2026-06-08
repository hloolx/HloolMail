import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useText } from '../../../locales';
import { relativeTime } from '../../../lib/display';
import { queryKeys } from '../../../lib/queryKeys';
import { useAppStore } from '../../../store';
import { useTableUrlState } from '../../../hooks/useTableUrlState';
import { DataTable, PaginationControls } from '../../../components/shared';
import { AdminPageFrame } from '../components/AdminPageFrame';
import { SeverityPill } from '../components/SeverityPill';
import {
  queryErrorMessage,
  quotaReasonLabel,
  quotaSummary
} from '../utils/adminFormatting';
import { useAdminQuotaAlertsQuery } from '../hooks/useAdminQueries';

const QUOTA_ALERT_PAGE_SIZE_OPTIONS = [8, 20, 50] as const;

export function AdminQuotaAlertsPage() {
  const text = useText();
  const queryClient = useQueryClient();
  const setPage = useAppStore((state) => state.setPage);
  const quotaAlertsUrlState = useTableUrlState({
    defaultPageSize: 8,
    pageParam: 'quotaPage',
    pageSizeParam: 'quotaPageSize',
    pageSizeOptions: QUOTA_ALERT_PAGE_SIZE_OPTIONS
  });
  const quotaAlerts = useAdminQuotaAlertsQuery(quotaAlertsUrlState.page, quotaAlertsUrlState.pageSize);
  const quotaPage = quotaAlerts.data;
  const refreshQuotaAlerts = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.quotaAlertsRoot });
  };

  return (
    <AdminPageFrame
      title={text.page['admin-quota-alerts']}
      actions={(
        <button className="btn-secondary" onClick={refreshQuotaAlerts} disabled={quotaAlerts.isFetching} aria-label={text.admin.refresh}>
          <RefreshCw size={16} className={quotaAlerts.isFetching ? 'animate-spin' : ''} aria-hidden="true" />
          {text.admin.refresh}
        </button>
      )}
    >
      <section className="panel admin-table-panel" id="admin-quota-alerts">
        <div className="panel-header admin-panel-header">
          <div>
            <h2>{text.admin.quotaAlerts.title}</h2>
            <p>{text.admin.quotaAlerts.desc}</p>
          </div>
          <button className="btn-ghost" type="button" onClick={() => setPage('users')} aria-label={text.admin.quotaAlerts.goToUsers || text.admin.domainHealth.goToUsers}>
            {text.admin.quotaAlerts.goToUsers || text.admin.domainHealth.goToUsers}
          </button>
        </div>
        <DataTable
          ariaLabel={text.admin.quotaAlerts.title}
          density="compact"
          emptyLabel={text.admin.quotaAlerts.empty}
          loading={quotaAlerts.isLoading}
          loadingLabel={text.common.loading}
          error={quotaAlerts.isError}
          errorLabel={queryErrorMessage(quotaAlerts.error, text.admin.quotaAlerts.empty)}
          retryLabel={text.common.retry}
          onRetry={() => quotaAlerts.refetch()}
          retryPending={quotaAlerts.isFetching}
          columns={[
            { key: 'target', header: text.admin.quotaAlerts.colTarget, minWidth: '12rem' },
            { key: 'severity', header: text.admin.quotaAlerts.colSeverity, align: 'center', width: '8rem' },
            { key: 'usage', header: text.admin.quotaAlerts.colUsage, align: 'right', minWidth: '10rem' },
            { key: 'last-used', header: text.admin.quotaAlerts.colLastUsed, width: '8rem' }
          ]}
          rows={(quotaPage?.items || []).map((alert) => ({
            key: `${alert.kind}-${alert.id}`,
            cells: [
              <div className="admin-domain-cell">
                <b>{alert.label}</b>
                <small>{alert.kind === 'api_key' ? `API Key${alert.owner ? ` / ${alert.owner}` : ''}` : 'User'}</small>
              </div>,
              <SeverityPill severity={alert.severity}>{quotaReasonLabel(alert)}</SeverityPill>,
              quotaSummary(alert),
              relativeTime(alert.last_used_at)
            ]
          }))}
        />
        <PaginationControls
          page={quotaPage?.page || quotaAlertsUrlState.page}
          totalPages={quotaPage?.total_pages || 1}
          onPageChange={quotaAlertsUrlState.setPage}
          rowsPerPage={quotaAlertsUrlState.pageSize}
          rowsPerPageOptions={[...QUOTA_ALERT_PAGE_SIZE_OPTIONS]}
          onRowsPerPageChange={quotaAlertsUrlState.setPageSize}
          rowsPerPageLabel={text.common.rowsPerPage}
        />
      </section>
    </AdminPageFrame>
  );
}
