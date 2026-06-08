import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useText } from '../../../locales';
import { queryKeys } from '../../../lib/queryKeys';
import { useAppStore } from '../../../store';
import { AdminPageFrame } from '../components/AdminPageFrame';
import { DashboardOverview } from '../components/DashboardOverview';
import { configRisks } from '../utils/adminFormatting';
import {
  useAdminQuotaAlertsQuery,
  useAdminStatsQuery,
  useAdminTimeseriesQuery,
  useDomainCheckRunsQuery,
  useDomainCheckSettingsQuery
} from '../hooks/useAdminQueries';
import type { AdminTimeseriesRangeValue } from '../services/adminService';

export function AdminOverviewPage() {
  const text = useText();
  const queryClient = useQueryClient();
  const setPage = useAppStore((state) => state.setPage);
  const [dashboardRange, setDashboardRange] = useState<AdminTimeseriesRangeValue>('30');
  const stats = useAdminStatsQuery();
  const timeseries = useAdminTimeseriesQuery(dashboardRange);
  const quotaAlerts = useAdminQuotaAlertsQuery(1, 8);
  const domainCheckSettings = useDomainCheckSettingsQuery();
  const domainCheckRuns = useDomainCheckRunsQuery(1, 10);
  const risks = useMemo(() => stats.data ? configRisks(stats.data) : [], [stats.data]);
  const runRows = domainCheckRuns.data?.runs || domainCheckSettings.data?.recent_runs || [];
  const lastRun = domainCheckSettings.data?.last_run;
  const hasRunningCheck = runRows.some((run) => run.status === 'running') || lastRun?.status === 'running';
  const isRefreshing = stats.isFetching || timeseries.isFetching || quotaAlerts.isFetching || domainCheckSettings.isFetching || domainCheckRuns.isFetching;

  const refreshOverview = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.stats });
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.timeseriesRoot });
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.quotaAlertsRoot });
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.domainCheckSettings });
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.domainCheckRunsRoot });
  };

  return (
    <AdminPageFrame
      title={text.page['admin-overview']}
      actions={(
        <button className="btn-secondary" onClick={refreshOverview} disabled={isRefreshing} aria-label={text.admin.refresh}>
          <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} aria-hidden="true" />
          {text.admin.refresh}
        </button>
      )}
    >
      <DashboardOverview
        stats={stats.data}
        risks={risks}
        statsLoading={stats.isLoading}
        statsError={stats.isError}
        onRetryStats={() => stats.refetch()}
        timeseries={timeseries.data}
        timeseriesLoading={timeseries.isLoading}
        timeseriesError={timeseries.isError}
        onRetryTimeseries={() => timeseries.refetch()}
        range={dashboardRange}
        onRangeChange={setDashboardRange}
        quotaAlertsTotal={quotaAlerts.data?.total ?? 0}
        hasRunningCheck={hasRunningCheck}
        onOpenPage={setPage}
      />
    </AdminPageFrame>
  );
}
