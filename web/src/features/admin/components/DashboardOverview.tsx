import {
  Activity,
  BarChart3,
  Database,
  Globe2,
  Inbox,
  KeyRound,
  MailPlus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Users,
  type LucideIcon
} from 'lucide-react';
import { currentText, useText } from '../../../locales';
import type { Page } from '../../../store';
import type { AdminGrowthCounts, AdminStats, TimeseriesStats } from '../../../types';
import { InfoTip, SegmentedTabs } from '../../../components/shared';
import '../../../styles/dashboard.css';
import {
  formatNumber,
  type ConfigRisk
} from '../utils/adminFormatting';
import {
  BreakdownPanel,
  DashboardAlert,
  SummaryMetric,
  TrendPanel
} from './DashboardCards';
import {
  ADMIN_TIMESERIES_RANGE_OPTIONS,
  type AdminTimeseriesRangeValue
} from '../services/adminService';

export function DashboardOverview({
  stats,
  risks,
  statsLoading,
  statsError,
  onRetryStats,
  timeseries,
  timeseriesLoading,
  timeseriesError,
  onRetryTimeseries,
  range,
  onRangeChange,
  quotaAlertsTotal,
  hasRunningCheck,
  onOpenPage
}: {
  stats?: AdminStats;
  risks: ConfigRisk[];
  statsLoading: boolean;
  statsError: boolean;
  onRetryStats: () => void;
  timeseries?: TimeseriesStats;
  timeseriesLoading: boolean;
  timeseriesError: boolean;
  onRetryTimeseries: () => void;
  range: AdminTimeseriesRangeValue;
  onRangeChange: (range: AdminTimeseriesRangeValue) => void;
  quotaAlertsTotal: number;
  hasRunningCheck: boolean;
  onOpenPage: (page: Page) => void;
}) {
  const text = useText();
  const growth = growthForRange(stats, range);
  const rangeLabel = text.admin.dashboard.rangeLabel.replace('{days}', range);
  const domainsTotal = stats?.total_domains ?? 0;
  const usersTotal = stats?.users ?? 0;
  const systemRiskItems = buildSystemRiskItems(text, stats, risks, quotaAlertsTotal, hasRunningCheck, onOpenPage);
  const domainBreakdown = [
    { label: text.admin.dashboard.breakdownActiveDomains, value: stats?.active_domains ?? 0, tone: 'good' as const },
    { label: text.admin.dashboard.breakdownFailedDomains, value: stats?.failed_domains ?? 0, tone: 'bad' as const },
    { label: text.admin.dashboard.breakdownPublicDomains, value: stats?.public_domains ?? 0, tone: 'focus' as const },
    { label: text.admin.dashboard.breakdownPrivateDomains, value: stats?.private_domains ?? 0, tone: 'neutral' as const }
  ];
  const userBreakdown = [
    { label: text.admin.dashboard.breakdownEnabledUsers, value: stats?.enabled_users ?? 0, tone: 'good' as const },
    { label: text.admin.dashboard.breakdownDisabledUsers, value: stats?.disabled_users ?? 0, tone: 'bad' as const },
    { label: text.admin.dashboard.breakdownAdminUsers, value: stats?.admin_users ?? 0, tone: 'focus' as const },
    { label: text.admin.dashboard.breakdownRegularUsers, value: stats?.regular_users ?? 0, tone: 'neutral' as const }
  ];
  const mailboxBreakdown = [
    { label: text.admin.dashboard.breakdownPublicMailboxes, value: stats?.public_mailboxes ?? 0, tone: 'focus' as const },
    { label: text.admin.dashboard.breakdownPrivateMailboxes, value: stats?.private_mailboxes ?? 0, tone: 'neutral' as const }
  ];

  return (
    <section className="admin-dashboard-overview" aria-labelledby="admin-dashboard-title">
      <div className="admin-dashboard-heading">
        <div>
          <h2 id="admin-dashboard-title">{text.admin.dashboard.title}</h2>
          <p>{text.admin.dashboard.desc}</p>
        </div>
        <SegmentedTabs
          value={range}
          onValueChange={onRangeChange}
          ariaLabel={text.admin.dashboard.rangeAria}
          size="sm"
          className="admin-dashboard-range-tabs"
          items={ADMIN_TIMESERIES_RANGE_OPTIONS.map((days) => ({
            value: String(days) as AdminTimeseriesRangeValue,
            label: text.admin.dashboard.rangeTab.replace('{days}', String(days))
          }))}
        />
      </div>

      {statsError && <DashboardAlert label={text.admin.dashboard.statsError} onRetry={onRetryStats} />}

      <div className="admin-dashboard-metrics">
        <SummaryMetric
          icon={Inbox}
          label={text.admin.dashboard.metricMailboxes}
          value={stats?.mailboxes ?? 0}
          growth={growth.mailboxes}
          growthLabel={rangeLabel}
          loading={statsLoading}
        />
        <SummaryMetric
          icon={MailPlus}
          label={text.admin.dashboard.metricMessages}
          value={stats?.messages ?? 0}
          growth={growth.messages}
          growthLabel={rangeLabel}
          loading={statsLoading}
        />
        <SummaryMetric
          icon={Globe2}
          label={text.admin.dashboard.metricDomains}
          value={domainsTotal}
          growth={growth.domains}
          growthLabel={rangeLabel}
          loading={statsLoading}
          onClick={() => onOpenPage('admin-domains')}
        />
        <SummaryMetric
          icon={Users}
          label={text.admin.dashboard.metricUsers}
          value={usersTotal}
          growth={growth.users}
          growthLabel={rangeLabel}
          loading={statsLoading}
          onClick={() => onOpenPage('users')}
        />
      </div>

      <div className="admin-dashboard-grid">
        <section className="panel admin-dashboard-chart-panel">
          <div className="panel-header admin-dashboard-panel-header">
            <div>
              <h2>{text.admin.dashboard.timelineTitle}<InfoTip text={text.admin.dashboard.timelineHint.replace('{days}', range)} /></h2>
              <p>{text.admin.dashboard.timelineDesc}</p>
            </div>
            <span className="admin-dashboard-api-chip">
              <Activity size={14} aria-hidden="true" />
              {text.admin.dashboard.apiCallsToday.replace('{count}', formatNumber(stats?.api_usage_today ?? 0))}
            </span>
          </div>
          {timeseriesError && (
            <DashboardAlert label={text.admin.dashboard.timeseriesError} onRetry={onRetryTimeseries} compact />
          )}
          <div className="admin-dashboard-chart-grid">
            <TrendPanel
              title={text.admin.dashboard.chartNewMailboxes}
              data={timeseries?.new_mailboxes || []}
              labels={timeseries?.days || []}
              color="var(--focus)"
              unit={text.admin.dashboard.unitMailboxes}
              loading={timeseriesLoading}
              emptyLabel={text.admin.dashboard.emptyTrend}
            />
            <TrendPanel
              title={text.admin.dashboard.chartNewMessages}
              data={timeseries?.new_messages || timeseries?.messages || []}
              labels={timeseries?.days || []}
              color="var(--primary)"
              unit={text.dashboard.chartUnitMessages}
              loading={timeseriesLoading}
              emptyLabel={text.admin.dashboard.emptyTrend}
            />
            <TrendPanel
              title={text.admin.dashboard.chartNewDomains}
              data={timeseries?.new_domains || []}
              labels={timeseries?.days || []}
              color="var(--good)"
              unit={text.dashboard.chartUnitDomains}
              loading={timeseriesLoading}
              emptyLabel={text.admin.dashboard.emptyTrend}
            />
            <TrendPanel
              title={text.admin.dashboard.chartNewUsers}
              data={timeseries?.new_users || []}
              labels={timeseries?.days || []}
              color="var(--warn)"
              unit={text.admin.dashboard.unitUsers}
              loading={timeseriesLoading}
              emptyLabel={text.admin.dashboard.emptyTrend}
            />
          </div>
        </section>

        <section className="panel admin-dashboard-side-panel">
          <div className="panel-header admin-dashboard-panel-header">
            <div>
              <h2>{text.admin.dashboard.riskTitle}</h2>
              <p>{text.admin.dashboard.riskDesc}</p>
            </div>
          </div>
          <div className="admin-dashboard-action-list">
            {systemRiskItems.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`admin-dashboard-action admin-dashboard-action-${item.level}`}
                onClick={item.onClick}
              >
                <item.icon size={16} aria-hidden="true" />
                <span>
                  <b>{item.title}</b>
                  <small>{item.desc}</small>
                </span>
                <strong>{item.count}</strong>
              </button>
            ))}
          </div>
        </section>
      </div>

      <div className="admin-dashboard-breakdowns">
        <BreakdownPanel title={text.admin.dashboard.domainBreakdownTitle} total={domainsTotal} items={domainBreakdown} />
        <BreakdownPanel title={text.admin.dashboard.userBreakdownTitle} total={usersTotal} items={userBreakdown} />
        <BreakdownPanel title={text.admin.dashboard.mailboxBreakdownTitle} total={stats?.mailboxes ?? 0} items={mailboxBreakdown} />
      </div>
    </section>
  );
}

function growthForRange(stats: AdminStats | undefined, range: AdminTimeseriesRangeValue): AdminGrowthCounts {
  if (!stats?.growth) return emptyGrowth();
  if (range === '7') return stats.growth.last_7_days || emptyGrowth();
  if (range === '90') return stats.growth.last_90_days || stats.growth.last_30_days || emptyGrowth();
  return stats.growth.last_30_days || emptyGrowth();
}

function emptyGrowth(): AdminGrowthCounts {
  return { messages: 0, mailboxes: 0, domains: 0, users: 0, api_calls: 0 };
}

function buildSystemRiskItems(
  text: ReturnType<typeof currentText>,
  stats: AdminStats | undefined,
  risks: ConfigRisk[],
  quotaAlertsTotal: number,
  hasRunningCheck: boolean,
  onOpenPage: (page: Page) => void
) {
  const failedDomains = stats?.failed_domains ?? 0;
  const staleDomains = stats?.stale_domains ?? 0;
  const expiringDomains = stats?.expiring_domains ?? 0;
  const expiredDomains = stats?.expired_domains ?? 0;
  const domainRiskCount = failedDomains + staleDomains + expiringDomains + expiredDomains;
  const configRiskCount = risks.length;
  return [
    {
      key: 'domain-health',
      icon: domainRiskCount > 0 ? ShieldAlert : ShieldCheck,
      level: domainRiskCount > 0 ? 'warning' : 'ok',
      title: text.admin.dashboard.riskDomainTitle,
      desc: text.admin.dashboard.riskDomainDesc
        .replace('{failed}', formatNumber(failedDomains))
        .replace('{stale}', formatNumber(staleDomains))
        .replace('{expiring}', formatNumber(expiringDomains + expiredDomains)),
      count: formatNumber(domainRiskCount),
      onClick: () => onOpenPage('admin-domains')
    },
    {
      key: 'quota-alerts',
      icon: BarChart3,
      level: quotaAlertsTotal > 0 ? 'warning' : 'ok',
      title: text.admin.dashboard.riskQuotaTitle,
      desc: quotaAlertsTotal > 0 ? text.admin.dashboard.riskQuotaDesc : text.admin.dashboard.riskQuotaEmpty,
      count: formatNumber(quotaAlertsTotal),
      onClick: () => onOpenPage('admin-quota-alerts')
    },
    {
      key: 'config-risks',
      icon: configRiskCount > 0 ? KeyRound : ShieldCheck,
      level: configRiskCount > 0 ? 'warning' : 'ok',
      title: text.admin.dashboard.riskConfigTitle,
      desc: configRiskCount > 0 ? risks.map((risk) => risk.title).join(' / ') : text.admin.dashboard.riskConfigEmpty,
      count: formatNumber(configRiskCount),
      onClick: () => onOpenPage('admin-audit')
    },
    {
      key: 'dns-check',
      icon: hasRunningCheck ? RefreshCw : Database,
      level: hasRunningCheck || staleDomains > 0 ? 'warning' : 'ok',
      title: text.admin.dashboard.riskDnsTitle,
      desc: hasRunningCheck
        ? text.admin.dashboard.riskDnsRunning
        : text.admin.dashboard.riskDnsDesc.replace('{stale}', formatNumber(staleDomains)),
      count: hasRunningCheck ? text.admin.dashboard.runningTag : formatNumber(staleDomains),
      onClick: () => onOpenPage('admin-dns')
    }
  ] as Array<{
    key: string;
    icon: LucideIcon;
    level: 'ok' | 'warning' | 'critical';
    title: string;
    desc: string;
    count: string;
    onClick: () => void;
  }>;
}
