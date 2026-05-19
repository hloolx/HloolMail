import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle, Globe2, Inbox, MailPlus } from 'lucide-react';
import type { AppNotification, DomainAvailability, PublicDomainItem, User } from '../api';
import { api } from '../api';
import type { Stats, TimeseriesStats } from '../types';
import { useText } from '../locales';
import { useAppStore } from '../store';
import { DataTable, EmptyState, Metric, PaginationControls } from '../components/shared';
import type { DataTableColumn, DataTableRow } from '../components/shared/DataTable';
import { LineChart } from '../components/charts/LineChart';

export function Dashboard({ user }: { user: User }) {
  const { setPage } = useAppStore();
  const text = useText();
  const [domainPage, setDomainPage] = useState(1);
  const pageSize = 10;

  const stats = useQuery({
    queryKey: ['stats'],
    queryFn: () => api<Stats>('/api/stats'),
    staleTime: 30_000,
  });

  const timeseries = useQuery({
    queryKey: ['stats-timeseries'],
    queryFn: () => api<TimeseriesStats>('/api/stats/timeseries'),
    staleTime: 30_000,
  });

  const domains = useQuery({
    queryKey: ['domains-available'],
    queryFn: () => api<DomainAvailability>('/api/domains/available'),
    staleTime: 30_000,
  });

  const notifications = useQuery({
    queryKey: ['notifications-dashboard'],
    queryFn: () => api<AppNotification[]>('/api/notifications?unread=true&limit=5'),
    retry: false,
  });

  const publicDomains: PublicDomainItem[] = domains.data && 'public_domains' in domains.data ? domains.data.public_domains : [];
  const urgentNotifications = (notifications.data || []).filter(
    (item) => item.type === 'MX_FAILED' || item.type === 'DOMAIN_EXPIRING' || item.type === 'DOMAIN_EXPIRED',
  );
  const totalPages = Math.max(1, Math.ceil(publicDomains.length / pageSize));
  const pagedDomains = publicDomains.slice((domainPage - 1) * pageSize, domainPage * pageSize);

  const domainColumns: DataTableColumn[] = [
    { key: 'domain', header: text.dashboard.tableDomain },
    { key: 'mode', header: text.dashboard.tableMode },
    { key: 'mail', header: text.dashboard.tableMail },
    { key: 'action', header: text.dashboard.tableAction },
  ];

  const domainRows: DataTableRow[] = pagedDomains.map((domain) => ({
    key: domain.id ?? domain.domain,
    cells: [
      <div className="dashboard-domain-cell" key="domain">
        <span className="font-medium">@{domain.domain}</span>
      </div>,
      <span className="badge" key="mode">{text.dashboard.publicTag}</span>,
      <span className="tabular-nums" key="mail" style={{ textAlign: 'right', display: 'inline-block', width: '100%' }}>
        {domain.message_count ?? 0}
      </span>,
      <button className="btn-ghost" key="action" onClick={() => setPage('inbox')}>
        <MailPlus size={14} />
        {text.dashboard.quickGenerate}
      </button>,
    ],
  }));

  return (
    <div className="dashboard-home grid gap-4" role="main">
      {/* Welcome banner */}
      <section className="panel dashboard-welcome">
        <div className="dashboard-welcome-inner">
          <div className="dashboard-welcome-avatar">{user.email.slice(0, 1).toUpperCase()}</div>
          <div>
            <h1>{text.dashboard.welcome} {user.email}</h1>
            <p>{user.role === 'admin' ? text.role.admin : text.role.regularUser}</p>
          </div>
        </div>
      </section>

      {urgentNotifications.length > 0 && (
        <section className="dashboard-alerts">
          {urgentNotifications.slice(0, 3).map((notification) => (
            <div
              className={`dashboard-alert dashboard-alert-${notification.type === 'DOMAIN_EXPIRING' ? 'warning' : 'critical'}`}
              key={notification.id}
            >
              <AlertTriangle size={16} />
              <span>{notification.message}</span>
            </div>
          ))}
        </section>
      )}

      {notifications.isError && (
        <div className="dashboard-alert dashboard-alert-warning">
          <AlertTriangle size={16} />
          <span>{text.dashboard.notificationsError}</span>
        </div>
      )}

      {/* Stats error banner */}
      {stats.isError && (
        <div className="dashboard-alert dashboard-alert-critical">
          <AlertTriangle size={16} />
          <span>{text.dashboard.statsError}</span>
          <button className="btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => stats.refetch()}>
            {text.dashboard.retry}
          </button>
        </div>
      )}

      {/* Quick stats */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric icon={Inbox} label={text.dashboard.mailboxesTotal} value={stats.data?.mailboxes ?? 0} loading={stats.isLoading} />
        <Metric icon={Globe2} label={text.dashboard.publicMailboxes} value={stats.data?.public_domains ?? 0} loading={stats.isLoading} />
        <Metric icon={MailPlus} label={text.dashboard.messagesTotal} value={stats.data?.messages ?? 0} loading={stats.isLoading} />
        <Metric icon={Activity} label={text.dashboard.apiCalls} value={stats.data?.api_calls_today ?? 0} loading={stats.isLoading} />
      </div>

      {/* Timeseries error banner */}
      {timeseries.isError && (
        <div className="dashboard-alert dashboard-alert-critical">
          <AlertTriangle size={16} />
          <span>{text.dashboard.timeseriesError}</span>
          <button className="btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => timeseries.refetch()}>
            {text.dashboard.retry}
          </button>
        </div>
      )}

      {/* Line charts */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <section className="panel chart-panel">
          <div className="panel-header">
            <div>
              <h2>{text.dashboard.chartMessages}</h2>
              <p>{text.dashboard.last7Days}</p>
            </div>
          </div>
          <LineChart
            data={timeseries.data?.messages || []}
            labels={timeseries.data?.days || []}
            color="var(--primary)"
            unit={text.dashboard.chartUnitMessages}
            loading={timeseries.isLoading}
            emptyLabel={text.dashboard.chartEmptyMessages}
            ariaLabel={text.dashboard.chartMessages}
          />
        </section>
        <section className="panel chart-panel">
          <div className="panel-header">
            <div>
              <h2>{text.dashboard.chartDomains}</h2>
              <p>{text.dashboard.last7Days}</p>
            </div>
          </div>
          <LineChart
            data={timeseries.data?.domains || []}
            labels={timeseries.data?.days || []}
            color="var(--good)"
            unit={text.dashboard.chartUnitDomains}
            loading={timeseries.isLoading}
            emptyLabel={text.dashboard.chartEmptyDomains}
            ariaLabel={text.dashboard.chartDomains}
          />
        </section>
        <section className="panel chart-panel">
          <div className="panel-header">
            <div>
              <h2>{text.dashboard.chartApiCalls}</h2>
              <p>{text.dashboard.last7Days}</p>
            </div>
          </div>
          <LineChart
            data={timeseries.data?.api_calls || []}
            labels={timeseries.data?.days || []}
            color="var(--warn)"
            unit={text.dashboard.chartUnitCalls}
            loading={timeseries.isLoading}
            emptyLabel={text.dashboard.chartEmptyApiCalls}
            ariaLabel={text.dashboard.chartApiCalls}
          />
        </section>
      </div>

      {/* Public domain list with pagination */}
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>{text.dashboard.publicDomainList}</h2>
            <p>{text.dashboard.publicDomainListDesc}</p>
          </div>
          <span className="text-xs text-[var(--muted)]">
            {publicDomains.length} {text.dashboard.publicMailboxes}
          </span>
        </div>

        {domains.isLoading ? (
          <EmptyState label={text.dashboard.domainListLoading} />
        ) : domains.isError ? (
          <div style={{ padding: '0.75rem 0' }}>
            <div className="dashboard-alert dashboard-alert-critical">
              <AlertTriangle size={16} />
              <span>{text.dashboard.domainsError}</span>
              <button className="btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => domains.refetch()}>
                {text.dashboard.retry}
              </button>
            </div>
          </div>
        ) : publicDomains.length > 0 ? (
          <>
            <DataTable columns={domainColumns} rows={domainRows} emptyLabel={text.dashboard.publicDomainEmpty} />
            <PaginationControls page={domainPage} totalPages={totalPages} onPageChange={setDomainPage} />
          </>
        ) : (
          <EmptyState label={text.dashboard.publicDomainEmpty} />
        )}
      </section>
    </div>
  );
}
