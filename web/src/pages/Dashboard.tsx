import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle, ChevronDown, Globe2, Inbox, MailPlus } from 'lucide-react';
import type { AppNotification, DomainAvailability, User } from '../api';
import { api } from '../api';
import type { Stats, TimeseriesStats } from '../types';
import { useText } from '../locales';
import { useAppStore } from '../store';
import { LineChart } from '../components/charts/LineChart';
import { EmptyState, Metric } from '../components/shared';

export function Dashboard({ user }: { user: User }) {
  const { setPage } = useAppStore();
  const text = useText();
  const [domainPage, setDomainPage] = useState(1);
  const pageSize = 10;
  const stats = useQuery({ queryKey: ['stats'], queryFn: () => api<Stats>('/api/stats') });
  const timeseries = useQuery({ queryKey: ['stats-timeseries'], queryFn: () => api<TimeseriesStats>('/api/stats/timeseries') });
  const domains = useQuery({
    queryKey: ['domains-available'],
    queryFn: () => api<DomainAvailability>('/api/domains/available')
  });
  const notifications = useQuery({
    queryKey: ['notifications-dashboard'],
    queryFn: () => api<AppNotification[]>('/api/notifications?unread=true&limit=5'),
    retry: false
  });

  const publicDomains = domains.data?.public_domains || [];
  const urgentNotifications = (notifications.data || []).filter((item) => item.type === 'MX_FAILED' || item.type === 'DOMAIN_EXPIRING' || item.type === 'DOMAIN_EXPIRED');
  const totalPages = Math.max(1, Math.ceil(publicDomains.length / pageSize));
  const pagedDomains = publicDomains.slice((domainPage - 1) * pageSize, domainPage * pageSize);

  return (
    <div className="dashboard-home grid gap-4">
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
            <div className={`dashboard-alert dashboard-alert-${notification.type === 'DOMAIN_EXPIRING' ? 'warning' : 'critical'}`} key={notification.id}>
              <AlertTriangle size={16} />
              <span>{notification.message}</span>
            </div>
          ))}
        </section>
      )}

      {/* Quick stats */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric icon={Inbox} label={text.dashboard.mailboxesTotal} value={stats.data?.mailboxes ?? 0} loading={stats.isLoading} />
        <Metric icon={Globe2} label={text.dashboard.publicMailboxes} value={stats.data?.public_domains ?? 0} loading={stats.isLoading} />
        <Metric icon={MailPlus} label={text.dashboard.messagesTotal} value={stats.data?.messages ?? 0} loading={stats.isLoading} />
        <Metric icon={Activity} label={text.dashboard.apiCalls} value={stats.data?.api_calls_today ?? 0} loading={stats.isLoading} />
      </div>

      {/* Line charts */}
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="panel chart-panel">
          <div className="panel-header">
            <div>
              <h2>{text.dashboard.chartMessages}</h2>
              <p>{text.dashboard.last7Days}</p>
            </div>
          </div>
          <LineChart data={timeseries.data?.messages || []} labels={timeseries.data?.days || []} color="var(--primary)" unit={text.dashboard.chartUnitMessages} />
        </section>
        <section className="panel chart-panel">
          <div className="panel-header">
            <div>
              <h2>{text.dashboard.chartDomains}</h2>
              <p>{text.dashboard.last7Days}</p>
            </div>
          </div>
          <LineChart data={timeseries.data?.domains || []} labels={timeseries.data?.days || []} color="var(--good)" unit={text.dashboard.chartUnitDomains} />
        </section>
        <section className="panel chart-panel">
          <div className="panel-header">
            <div>
              <h2>{text.dashboard.chartApiCalls}</h2>
              <p>{text.dashboard.last7Days}</p>
            </div>
          </div>
          <LineChart data={timeseries.data?.api_calls || []} labels={timeseries.data?.days || []} color="var(--warn)" unit={text.dashboard.chartUnitCalls} />
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
        {publicDomains.length > 0 ? (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{text.dashboard.tableDomain}</th>
                    <th>{text.dashboard.tableMode}</th>
                    <th>{text.dashboard.tableMail}</th>
                    <th>{text.dashboard.tableAction}</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedDomains.map((domain) => (
                    <tr key={domain.id}>
                      <td>
                        <div className="dashboard-domain-cell">
                          <span className="font-medium">@{domain.domain}</span>
                          {domain.wildcard_enabled && <span className="badge">{text.dashboard.wildcardTag}</span>}
                        </div>
                      </td>
                      <td><span className="badge">{text.dashboard.publicTag}</span></td>
                      <td>{domain.message_count ?? 0}</td>
                      <td>
                        <button className="btn-ghost" onClick={() => setPage('inbox')}>
                          <MailPlus size={14} />
                          {text.dashboard.quickGenerate}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="pagination">
                <button className="btn-ghost" disabled={domainPage <= 1} onClick={() => setDomainPage((p) => Math.max(1, p - 1))}>
                  <ChevronDown className="rotate-90" size={14} />
                  {text.dashboard.prev}
                </button>
                <span className="pagination-info">
                  {text.dashboard.pageOf.replace('{current}', String(domainPage)).replace('{total}', String(totalPages))}
                </span>
                <button className="btn-ghost" disabled={domainPage >= totalPages} onClick={() => setDomainPage((p) => Math.min(totalPages, p + 1))}>
                  {text.dashboard.next}
                  <ChevronDown className="-rotate-90" size={14} />
                </button>
              </div>
            )}
          </>
        ) : (
          <EmptyState label={text.dashboard.publicDomainEmpty} />
        )}
      </section>
    </div>
  );
}
