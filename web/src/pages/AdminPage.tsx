import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Database,
  Globe2,
  Inbox,
  KeyRound,
  MailPlus,
  Play,
  RefreshCw,
  Save,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Users,
  type LucideIcon
} from 'lucide-react';
import { toast } from 'sonner';
import { api, patchJSON, postJSON } from '../api';
import type { PaginatedResponse } from '../api';
import type { AdminDomainHealth, AdminGrowthCounts, AdminQuotaAlert, AdminStats, APIInterfaceSettings, DomainCheckRun, DomainCheckRunsPage, DomainCheckSettings, TimeseriesStats } from '../types';
import { formatDomainExpiry, relativeTime } from '../lib/display';
import { notifySuccess } from '../lib/feedback';
import { useAppStore, type Page } from '../store';
import { currentText, useText } from '../locales';
import { useHashSearchState, useTableUrlState } from '../hooks/useTableUrlState';
import { useCountUp } from '../hooks/useCountUp';
import { DataTable, DataTableToolbar, DataTableViewOptions, InfoTip, PaginationControls, SegmentedTabs } from '../components/shared';
import type { DataTableColumn } from '../components/shared';
import { LineChart } from '../components/charts/LineChart';
import { AdminAuditLog } from './AdminAuditLog';
import { AdminShareLinksPanel } from './AdminShareLinksPanel';
import { AdminWebhooksPanel } from './AdminWebhooksPanel';

const ADMIN_TAB_OPTIONS = ['dns', 'domainHealth', 'shareLinks', 'webhooks', 'apiInterfaces', 'quotaAlerts', 'audit'] as const;
const DOMAIN_HEALTH_PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
const DOMAIN_HEALTH_MODE_OPTIONS = ['all', 'public', 'private'] as const;
const DOMAIN_HEALTH_STATUS_OPTIONS = ['all', 'active', 'inactive'] as const;
const DOMAIN_HEALTH_MX_OPTIONS = ['all', 'verified', 'failed', 'wildcard_failed', 'unchecked', 'stale'] as const;
const DOMAIN_HEALTH_SEVERITY_OPTIONS = ['all', 'critical', 'warning', 'ok'] as const;
const ADMIN_TIMESERIES_RANGE_OPTIONS = [7, 30, 90] as const;

type AdminTab = (typeof ADMIN_TAB_OPTIONS)[number];
type AdminTimeseriesRange = (typeof ADMIN_TIMESERIES_RANGE_OPTIONS)[number];
type AdminTimeseriesRangeValue = `${AdminTimeseriesRange}`;
type DomainHealthFilters = {
  mode: string;
  status: string;
  mx: string;
  severity: string;
};
type ConfigRisk = { level: 'warning' | 'critical' | 'ok'; title: string; desc: string };

const DEFAULT_DOMAIN_HEALTH_FILTERS: DomainHealthFilters = {
  mode: 'all',
  status: 'all',
  mx: 'all',
  severity: 'all'
};

export function AdminPage() {
  const queryClient = useQueryClient();
  const text = useText();
  const language = useAppStore((state) => state.language);
  const setPage = useAppStore((state) => state.setPage);
  const { params: adminSearchParams, setParams: setAdminSearchParams } = useHashSearchState();
  const activeAdminTab = getAdminTab(adminSearchParams.get('tab'));
  const [dashboardRange, setDashboardRange] = useState<AdminTimeseriesRangeValue>('30');
  const dnsRunsUrlState = useTableUrlState({
    pageParam: 'dnsPage',
    pageSizeParam: 'dnsPageSize',
    pageSizeOptions: [10, 20, 50]
  });
  const domainHealthUrlState = useTableUrlState({
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
  const quotaAlertsUrlState = useTableUrlState({
    defaultPageSize: 8,
    pageParam: 'quotaPage',
    pageSizeParam: 'quotaPageSize',
    pageSizeOptions: [8, 20, 50]
  });
  const dnsCheckPage = dnsRunsUrlState.page;
  const dnsCheckPerPage = dnsRunsUrlState.pageSize;
  const domainHealthPage = domainHealthUrlState.page;
  const domainHealthPerPage = domainHealthUrlState.pageSize;
  const domainHealthSearch = domainHealthUrlState.search;
  const domainHealthFilters = domainHealthUrlState.filters;
  const quotaAlertsPage = quotaAlertsUrlState.page;
  const quotaAlertsPerPage = quotaAlertsUrlState.pageSize;
  const setActiveAdminTab = (nextTab: string) => {
    const tab = getAdminTab(nextTab);
    setAdminSearchParams((params) => {
      if (tab === 'dns') {
        params.delete('tab');
      } else {
        params.set('tab', tab);
      }
    });
  };
  const saveDnsSettingsButtonRef = useRef<HTMLButtonElement | null>(null);
  const runDnsCheckButtonRef = useRef<HTMLButtonElement | null>(null);
  const saveAPIInterfaceSettingsButtonRef = useRef<HTMLButtonElement | null>(null);
  const domainHealthFeedbackOriginRef = useRef<HTMLElement | null>(null);

  const stats = useQuery({ queryKey: ['admin-stats'], queryFn: () => api<AdminStats>('/api/admin/stats'), retry: false, staleTime: 30_000 });
  const adminTimeseries = useQuery({
    queryKey: ['admin-stats-timeseries', dashboardRange],
    queryFn: () => api<TimeseriesStats>(`/api/admin/stats/timeseries?days=${dashboardRange}`),
    retry: false,
    staleTime: 30_000
  });
  const domainHealth = useQuery({
    queryKey: ['admin-domain-health', domainHealthPage, domainHealthPerPage, domainHealthSearch, domainHealthFilters],
    queryFn: () => api<PaginatedResponse<AdminDomainHealth>>(`/api/admin/domain-health?${buildDomainHealthQuery(domainHealthFilters, domainHealthSearch, domainHealthPage, domainHealthPerPage)}`),
    retry: false,
    staleTime: 30_000
  });
  const quotaAlerts = useQuery({
    queryKey: ['admin-quota-alerts', quotaAlertsPage, quotaAlertsPerPage],
    queryFn: () => api<PaginatedResponse<AdminQuotaAlert>>(`/api/admin/quota-alerts?page=${quotaAlertsPage}&per_page=${quotaAlertsPerPage}`),
    retry: false,
    staleTime: 30_000
  });
  const domainCheckSettings = useQuery({
    queryKey: ['admin-domain-check-settings'],
    queryFn: () => api<DomainCheckSettings>('/api/admin/domain-check-settings'),
    retry: false,
    staleTime: 30_000,
    refetchInterval: (query) => query.state.data?.last_run?.status === 'running' ? 5000 : false
  });
  const domainCheckRuns = useQuery({
    queryKey: ['admin-domain-check-runs', dnsCheckPage, dnsCheckPerPage],
    queryFn: () => api<DomainCheckRunsPage>(`/api/admin/domain-check-runs?page=${dnsCheckPage}&per_page=${dnsCheckPerPage}`),
    retry: false,
    staleTime: 30_000,
    refetchInterval: (query) => query.state.data?.runs?.some((run: DomainCheckRun) => run.status === 'running') ? 5000 : false
  });
  const apiInterfaceSettings = useQuery({
    queryKey: ['admin-api-interface-settings'],
    queryFn: () => api<APIInterfaceSettings>('/api/admin/api-interface-settings'),
    retry: false,
    staleTime: 30_000
  });
  const [settingsForm, setSettingsForm] = useState({
    enabled: true,
    interval_minutes: '30',
    timeout_ms: '3500',
    max_concurrency: '5',
    resolvers: '1.1.1.1:53\n8.8.8.8:53\n223.5.5.5:53',
    check_inactive: false,
    failure_threshold: '2',
    recovery_threshold: '1'
  });
  const [apiInterfaceForm, setAPIInterfaceForm] = useState({
    yyds_compatibility_enabled: false
  });

  useEffect(() => {
    const settings = domainCheckSettings.data;
    if (!settings) return;
    setSettingsForm({
      enabled: settings.enabled,
      interval_minutes: String(settings.interval_minutes),
      timeout_ms: String(settings.timeout_ms),
      max_concurrency: String(settings.max_concurrency),
      resolvers: (settings.resolvers || []).join('\n'),
      check_inactive: settings.check_inactive,
      failure_threshold: String(settings.failure_threshold),
      recovery_threshold: String(settings.recovery_threshold)
    });
  }, [domainCheckSettings.data]);

  useEffect(() => {
    const settings = apiInterfaceSettings.data;
    if (!settings) return;
    setAPIInterfaceForm({
      yyds_compatibility_enabled: settings.yyds_compatibility_enabled
    });
  }, [apiInterfaceSettings.data]);

  const refreshAdminData = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
    queryClient.invalidateQueries({ queryKey: ['admin-stats-timeseries'] });
    queryClient.invalidateQueries({ queryKey: ['admin-domain-health'] });
    queryClient.invalidateQueries({ queryKey: ['admin-quota-alerts'] });
    queryClient.invalidateQueries({ queryKey: ['admin-audit-logs'] });
    queryClient.invalidateQueries({ queryKey: ['admin-share-links'] });
    queryClient.invalidateQueries({ queryKey: ['admin-domain-check-settings'] });
    queryClient.invalidateQueries({ queryKey: ['admin-domain-check-runs'] });
    queryClient.invalidateQueries({ queryKey: ['admin-quota-settings'] });
    queryClient.invalidateQueries({ queryKey: ['admin-api-interface-settings'] });
  };

  function validateNumberFields(): boolean {
    const keys = ['interval_minutes', 'timeout_ms', 'max_concurrency', 'failure_threshold', 'recovery_threshold'] as const;
    let allValid = true;
    for (const key of keys) {
      const parsed = Number.parseInt(settingsForm[key], 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        allValid = false;
      }
    }
    if (!allValid) {
      toast.error(text.admin.validation.invalidNumber);
    }
    return allValid;
  }

  const saveDomainCheckSettings = useMutation({
    mutationFn: () => {
      if (!validateNumberFields()) throw new Error(text.admin.validation.invalidNumber);
      return patchJSON<DomainCheckSettings>('/api/admin/domain-check-settings', {
        enabled: settingsForm.enabled,
        interval_minutes: toPositiveInt(settingsForm.interval_minutes, 30),
        timeout_ms: toPositiveInt(settingsForm.timeout_ms, 3500),
        max_concurrency: toPositiveInt(settingsForm.max_concurrency, 5),
        resolvers: splitResolvers(settingsForm.resolvers),
        check_inactive: settingsForm.check_inactive,
        failure_threshold: toPositiveInt(settingsForm.failure_threshold, 2),
        recovery_threshold: toPositiveInt(settingsForm.recovery_threshold, 1)
      });
    },
    onSuccess: () => {
      refreshAdminData();
      notifySuccess(text.admin.dnsCheck.saved, { origin: saveDnsSettingsButtonRef.current });
    },
    onError: (error) => toast.error(error.message)
  });

  const runDomainCheck = useMutation({
    mutationFn: () => postJSON<{ run: DomainCheckRun; reused: boolean }>('/api/admin/domain-check-runs', {}),
    onSuccess: (result) => {
      refreshAdminData();
      notifySuccess(result.reused ? text.admin.dnsCheck.alreadyRunning : text.admin.dnsCheck.started, { origin: runDnsCheckButtonRef.current });
    },
    onError: (error) => toast.error(error.message)
  });

  const saveAPIInterfaceSettings = useMutation({
    mutationFn: () => patchJSON<APIInterfaceSettings>('/api/admin/api-interface-settings', {
      yyds_compatibility_enabled: apiInterfaceForm.yyds_compatibility_enabled
    }),
    onSuccess: (settings) => {
      setAPIInterfaceForm({
        yyds_compatibility_enabled: settings.yyds_compatibility_enabled
      });
      refreshAdminData();
      notifySuccess(text.admin.apiInterfaces.saved, { origin: saveAPIInterfaceSettingsButtonRef.current });
    },
    onError: (error) => toast.error(error.message)
  });

  const recheckDomain = useMutation({
    mutationFn: (domain: AdminDomainHealth) => postJSON(`/api/admin/domains/${domain.id}/check-mx`, {}),
    onSuccess: () => {
      refreshAdminData();
      queryClient.invalidateQueries({ queryKey: ['domains-all'] });
      notifySuccess(text.admin.domainHealth.recheckDone, { origin: domainHealthFeedbackOriginRef.current });
      domainHealthFeedbackOriginRef.current = null;
    },
    onError: (error) => {
      domainHealthFeedbackOriginRef.current = null;
      toast.error(error.message);
    }
  });

  const updateDomainMode = useMutation({
    mutationFn: ({ domain, mode }: { domain: AdminDomainHealth; mode: AdminDomainHealth['mode'] }) => {
      const confirmText = mode === 'private'
        ? text.admin.domainHealth.privateConfirm
        : text.admin.domainHealth.publicConfirm;
      if (!window.confirm(confirmText.replace('{domain}', domain.domain))) {
        throw new Error('Canceled');
      }
      return patchJSON(`/api/admin/domains/${domain.id}`, { mode });
    },
    onSuccess: (_, variables) => {
      refreshAdminData();
      queryClient.invalidateQueries({ queryKey: ['domains-all'] });
      const message = variables.mode === 'private'
        ? text.admin.domainHealth.makePrivateDone
        : text.admin.domainHealth.makePublicDone;
      notifySuccess(message, { origin: domainHealthFeedbackOriginRef.current });
      domainHealthFeedbackOriginRef.current = null;
    },
    onError: (error) => {
      domainHealthFeedbackOriginRef.current = null;
      if (error.message !== 'Canceled') toast.error(error.message);
    }
  });

  const deleteDomain = useMutation({
    mutationFn: (domain: AdminDomainHealth) => {
      if (!window.confirm(text.admin.domainHealth.deleteConfirm.replace('{domain}', domain.domain))) {
        throw new Error('Canceled');
      }
      return api(`/api/admin/domains/${domain.id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      refreshAdminData();
      queryClient.invalidateQueries({ queryKey: ['domains-all'] });
      queryClient.invalidateQueries({ queryKey: ['domains-available'] });
      notifySuccess(text.admin.domainHealth.deleteDone, { origin: domainHealthFeedbackOriginRef.current });
      domainHealthFeedbackOriginRef.current = null;
    },
    onError: (error) => {
      domainHealthFeedbackOriginRef.current = null;
      if (error.message !== 'Canceled') toast.error(error.message);
    }
  });

  const healthPage = domainHealth.data;
  const healthItems = healthPage?.items || [];
  const quotaPage = quotaAlerts.data;
  const risks = useMemo(
    () => stats.data ? configRisks(stats.data) : [],
    [stats.data]
  );
  const runRows = domainCheckRuns.data?.runs || domainCheckSettings.data?.recent_runs || [];
  const runsPage = domainCheckRuns.data;
  const lastRun = domainCheckSettings.data?.last_run;
  const hasRunningCheck = runRows.some((run) => run.status === 'running') || lastRun?.status === 'running';
  const isLoading = stats.isLoading || adminTimeseries.isLoading || domainHealth.isLoading || quotaAlerts.isLoading || domainCheckSettings.isLoading || domainCheckRuns.isLoading || apiInterfaceSettings.isLoading;
  const [domainHealthHiddenColumnKeys, setDomainHealthHiddenColumnKeys] = useState<string[]>([]);
  const domainHealthColumns = useMemo<DataTableColumn[]>(() => [
    { key: 'domain', header: text.admin.domainHealth.colDomain, minWidth: '14rem', hideable: false, mobileTitle: true },
    { key: 'owner', header: text.admin.domainHealth.colOwner, minWidth: '12rem', mobileSubtitle: true },
    { key: 'status', header: text.admin.domainHealth.colStatus, align: 'center', width: '8rem', mobileBadge: true },
    { key: 'mode', header: text.admin.domainHealth.colMode, width: '10rem', mobilePriority: 1 },
    { key: 'expires', header: text.admin.domainHealth.colExpires, width: '8rem', mobilePriority: 3 },
    { key: 'mailboxes', header: text.admin.domainHealth.colMailboxes, align: 'right', width: '7rem', mobilePriority: 2 },
    { key: 'messages', header: text.admin.domainHealth.colMessages, align: 'right', width: '7rem', mobilePriority: 2 },
    { key: 'actions', role: 'actions', header: text.admin.domainHealth.colActions, align: 'right', minWidth: '14rem', hideable: false }
  ], [text]);
  const domainHealthCountLabel = text.admin.domainHealth.resultCount
    .replace('{shown}', String(healthItems.length))
    .replace('{total}', String(healthPage?.total ?? 0));

  return (
    <div className="admin-page grid gap-4" id="admin-top">
      <div className="admin-page-header">
        <div>
          <h1>{text.admin.title}</h1>
        </div>
        <button className="btn-secondary" onClick={refreshAdminData} disabled={isLoading} aria-label={text.admin.refresh}>
          <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} aria-hidden="true" />
          {text.admin.refresh}
        </button>
      </div>

      <AdminDashboardOverview
        stats={stats.data}
        risks={risks}
        statsLoading={stats.isLoading}
        statsError={stats.isError}
        onRetryStats={() => stats.refetch()}
        timeseries={adminTimeseries.data}
        timeseriesLoading={adminTimeseries.isLoading}
        timeseriesError={adminTimeseries.isError}
        onRetryTimeseries={() => adminTimeseries.refetch()}
        range={dashboardRange}
        onRangeChange={setDashboardRange}
        quotaAlertsTotal={quotaPage?.total ?? 0}
        hasRunningCheck={hasRunningCheck}
        onOpenAdminTab={setActiveAdminTab}
        onOpenPage={setPage}
      />

      <SegmentedTabs
        value={activeAdminTab}
        onValueChange={setActiveAdminTab}
        ariaLabel={text.admin.title}
        items={[
          { value: 'dns', label: text.admin.dnsCheck.title, badge: hasRunningCheck ? domainCheckStatusLabel('running') : undefined },
          { value: 'domainHealth', label: text.admin.domainHealth.title, badge: stats.data?.failed_domains ? String(stats.data.failed_domains) : undefined },
          { value: 'shareLinks', label: text.admin.shareLinks.title },
          { value: 'webhooks', label: text.admin.webhooks.title },
          { value: 'apiInterfaces', label: text.admin.apiInterfaces.title },
          { value: 'quotaAlerts', label: text.admin.quotaAlerts.title, badge: quotaPage?.total ? String(quotaPage.total) : undefined },
          { value: 'audit', label: text.admin.auditLogs.title }
        ]}
      />

      <section className="panel admin-table-panel" id="admin-dns-check" hidden={activeAdminTab !== 'dns'}>
        <div className="panel-header admin-panel-header">
          <div>
            <h2>{text.admin.dnsCheck.title}</h2>
            <p>
              {lastRun ? `${domainCheckStatusLabel(lastRun.status)} · ${lastRun.checked}/${lastRun.total}` : text.admin.dnsCheck.noRunsYet}
              {domainCheckSettings.data?.next_run_at ? ` · ${text.admin.dnsCheck.nextRun} ${relativeTime(domainCheckSettings.data.next_run_at)}` : ''}
            </p>
          </div>
          <div className="table-actions">
            <button
              ref={saveDnsSettingsButtonRef}
              className="btn-secondary"
              onClick={() => saveDomainCheckSettings.mutate()}
              disabled={saveDomainCheckSettings.isPending || domainCheckSettings.isError}
              title={domainCheckSettings.isError ? text.admin.dnsCheck.settingsError : undefined}
              aria-label={text.admin.dnsCheck.save}
            >
              <Save size={15} aria-hidden="true" />
              {text.admin.dnsCheck.save}
            </button>
            <button
              ref={runDnsCheckButtonRef}
              className="btn-secondary"
              onClick={() => runDomainCheck.mutate()}
              disabled={runDomainCheck.isPending || hasRunningCheck}
              aria-label={text.admin.dnsCheck.run}
            >
              <Play size={15} aria-hidden="true" />
              {text.admin.dnsCheck.run}
            </button>
          </div>
        </div>
        {domainCheckSettings.isError && (
          <div className="admin-risk admin-risk-warning" style={{ marginBottom: '0.9rem' }}>
            <ShieldAlert size={16} />
            <span><small>{text.admin.dnsCheck.settingsError}</small></span>
          </div>
        )}
        <div className="admin-dns-grid">
          <div className="admin-dns-settings">
            <div className="dns-form-row">
              <div className="toggle-row">
                <span className="toggle-row-label">
                  {text.admin.dnsCheck.enabled}
                  <InfoTip text={text.admin.dnsCheck.enabledDesc} />
                </span>
                <button
                  type="button"
                  className={`toggle-switch ${settingsForm.enabled ? 'on' : ''}`}
                  onClick={() => setSettingsForm((current) => ({ ...current, enabled: !current.enabled }))}
                  role="switch"
                  aria-checked={settingsForm.enabled}
                >
                  <span className="toggle-switch-knob" />
                </button>
              </div>
              <div className="toggle-row">
                <span className="toggle-row-label">
                  {text.admin.dnsCheck.checkInactive}
                  <InfoTip text={text.admin.dnsCheck.checkInactiveDesc} />
                </span>
                <button
                  type="button"
                  className={`toggle-switch ${settingsForm.check_inactive ? 'on' : ''}`}
                  onClick={() => setSettingsForm((current) => ({ ...current, check_inactive: !current.check_inactive }))}
                  role="switch"
                  aria-checked={settingsForm.check_inactive}
                >
                  <span className="toggle-switch-knob" />
                </button>
              </div>
            </div>

            <div className="dns-form-row">
              <label className="dns-form-field">
                <span className="dns-field-label">
                  {text.admin.dnsCheck.interval}
                  <InfoTip text={text.admin.dnsCheck.intervalDesc} />
                </span>
                <input className="input" type="number" min="1" value={settingsForm.interval_minutes} onChange={(event) => setSettingsForm((current) => ({ ...current, interval_minutes: event.target.value }))} />
              </label>
              <label className="dns-form-field">
                <span className="dns-field-label">
                  {text.admin.dnsCheck.timeout}
                  <InfoTip text={text.admin.dnsCheck.timeoutDesc} />
                </span>
                <input className="input" type="number" min="500" value={settingsForm.timeout_ms} onChange={(event) => setSettingsForm((current) => ({ ...current, timeout_ms: event.target.value }))} />
              </label>
            </div>

            <div className="dns-form-row">
              <label className="dns-form-field">
                <span className="dns-field-label">
                  {text.admin.dnsCheck.failureThreshold}
                  <InfoTip text={text.admin.dnsCheck.failureThresholdDesc} />
                </span>
                <input className="input" type="number" min="1" value={settingsForm.failure_threshold} onChange={(event) => setSettingsForm((current) => ({ ...current, failure_threshold: event.target.value }))} />
              </label>
              <label className="dns-form-field">
                <span className="dns-field-label">
                  {text.admin.dnsCheck.recoveryThreshold}
                  <InfoTip text={text.admin.dnsCheck.recoveryThresholdDesc} />
                </span>
                <input className="input" type="number" min="1" value={settingsForm.recovery_threshold} onChange={(event) => setSettingsForm((current) => ({ ...current, recovery_threshold: event.target.value }))} />
              </label>
            </div>

            <label className="dns-form-field">
              <span className="dns-field-label">
                {text.admin.dnsCheck.concurrency}
                <InfoTip text={text.admin.dnsCheck.concurrencyDesc} />
              </span>
              <input className="input" type="number" min="1" value={settingsForm.max_concurrency} onChange={(event) => setSettingsForm((current) => ({ ...current, max_concurrency: event.target.value }))} />
            </label>

            <label className="dns-form-field">
              <span className="dns-field-label">
                {text.admin.dnsCheck.resolvers}
                <InfoTip text={text.admin.dnsCheck.resolversDesc} />
              </span>
              <textarea className="input-textarea" rows={4} value={settingsForm.resolvers} onChange={(event) => setSettingsForm((current) => ({ ...current, resolvers: event.target.value }))} />
            </label>
          </div>
          <div className="admin-dns-runs">
            <DataTable
              ariaLabel={text.admin.dnsCheck.title}
              density="compact"
              emptyLabel={text.admin.dnsCheck.empty}
              columns={[
                { key: 'started-at', header: text.admin.dnsCheck.colTime, minWidth: '8rem' },
                { key: 'trigger', header: text.admin.dnsCheck.colTrigger, width: '7rem' },
                { key: 'status', header: text.admin.dnsCheck.colStatus, align: 'center', width: '7rem' },
                { key: 'progress', header: text.admin.dnsCheck.colProgress, align: 'center', width: '7rem' },
                { key: 'passed', header: text.admin.dnsCheck.colPassed, align: 'right', width: '5.5rem' },
                { key: 'failed', header: text.admin.dnsCheck.colFailed, align: 'right', width: '5.5rem' },
                { key: 'duration', header: text.admin.dnsCheck.colDuration, align: 'right', width: '6rem' }
              ]}
              rows={runRows.map((run) => ({
                key: run.id,
                cells: [
                  relativeTime(run.started_at),
                  domainCheckTriggerLabel(run.trigger),
                  <SeverityPill severity={run.status === 'failed' ? 'critical' : run.status === 'running' ? 'warning' : 'ok'}>{domainCheckStatusLabel(run.status)}</SeverityPill>,
                  `${run.checked}/${run.total}`,
                  String(run.passed),
                  String(run.failed),
                  domainCheckDuration(run)
                ]
              }))}
            />
            <PaginationControls
              page={runsPage?.page || dnsCheckPage}
              totalPages={runsPage?.total_pages || 1}
              onPageChange={dnsRunsUrlState.setPage}
              rowsPerPage={dnsCheckPerPage}
              rowsPerPageOptions={[10, 20, 50]}
              onRowsPerPageChange={(nextRowsPerPage) => {
                dnsRunsUrlState.setPageSize(nextRowsPerPage);
              }}
              rowsPerPageLabel={text.common.rowsPerPage}
            />
          </div>
        </div>
      </section>

      <div className="admin-tab-panels" hidden={activeAdminTab !== 'domainHealth' && activeAdminTab !== 'shareLinks' && activeAdminTab !== 'webhooks' && activeAdminTab !== 'apiInterfaces' && activeAdminTab !== 'quotaAlerts'}>
        <section className="panel admin-table-panel" id="admin-domain-health" hidden={activeAdminTab !== 'domainHealth'}>
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
                  value={domainHealthSearch}
                  onChange={(event) => domainHealthUrlState.setSearch(event.target.value, 'replace')}
                  placeholder={text.admin.domainHealth.searchPlaceholder}
                />
              </label>
            )}
            filters={(
              <div className="admin-domain-health-filters">
                <select className="input" value={domainHealthFilters.mode} aria-label={text.admin.domainHealth.filterMode} onChange={(event) => domainHealthUrlState.setFilter('mode', event.target.value)}>
                  <option value="all">{text.admin.domainHealth.filterModeAll}</option>
                  <option value="public">{text.domains.modePublic}</option>
                  <option value="private">{text.domains.modePrivate}</option>
                </select>
                <select className="input" value={domainHealthFilters.status} aria-label={text.admin.domainHealth.filterStatus} onChange={(event) => domainHealthUrlState.setFilter('status', event.target.value)}>
                  <option value="all">{text.admin.domainHealth.filterStatusAll}</option>
                  <option value="active">{text.domains.enabled}</option>
                  <option value="inactive">{text.domains.inactive}</option>
                </select>
                <select className="input" value={domainHealthFilters.mx} aria-label={text.admin.domainHealth.filterMx} onChange={(event) => domainHealthUrlState.setFilter('mx', event.target.value)}>
                  <option value="all">{text.admin.domainHealth.filterMxAll}</option>
                  <option value="verified">{text.admin.domainHealth.mxVerified}</option>
                  <option value="failed">{text.admin.domainHealth.mxFailed}</option>
                  <option value="wildcard_failed">{text.admin.domainHealth.mxWildcardFailed}</option>
                  <option value="unchecked">{text.admin.domainHealth.mxUnchecked}</option>
                  <option value="stale">{text.admin.domainHealth.mxStale}</option>
                </select>
                <select className="input" value={domainHealthFilters.severity} aria-label={text.admin.domainHealth.filterSeverity} onChange={(event) => domainHealthUrlState.setFilter('severity', event.target.value)}>
                  <option value="all">{text.admin.domainHealth.filterSeverityAll}</option>
                  <option value="critical">{text.admin.domainHealth.severityCritical}</option>
                  <option value="warning">{text.admin.domainHealth.severityWarning}</option>
                  <option value="ok">{text.admin.domainHealth.severityOk}</option>
                </select>
              </div>
            )}
            state={<span className="admin-domain-health-count">{domainHealthCountLabel}</span>}
            viewOptions={(
              <DataTableViewOptions
                columns={domainHealthColumns}
                hiddenColumnKeys={domainHealthHiddenColumnKeys}
                onHiddenColumnKeysChange={setDomainHealthHiddenColumnKeys}
                label={text.common.view}
                menuLabel={text.common.toggleColumns}
                resetLabel={text.common.reset}
                emptyLabel={text.common.noToggleColumns}
              />
            )}
          />
          {domainHealth.isError && (
            <div className="admin-risk admin-risk-warning" role="alert">
              <ShieldAlert size={16} />
              <span><small>{domainHealth.error instanceof Error && domainHealth.error.message ? domainHealth.error.message : text.admin.domainHealth.empty}</small></span>
            </div>
          )}
          <DataTable
            ariaLabel={text.admin.domainHealth.title}
            emptyLabel={domainHealth.isLoading ? text.common.loading : text.admin.domainHealth.empty}
            columns={domainHealthColumns}
            hiddenColumnKeys={domainHealthHiddenColumnKeys}
            onHiddenColumnKeysChange={setDomainHealthHiddenColumnKeys}
            hiddenLabel={text.common.noColumnsSelected}
            showAllColumnsLabel={text.common.showAllColumns}
            rows={healthItems.map((domain) => ({
              key: domain.id,
              cells: [
                <div className="admin-domain-cell">
                  <b>{domain.domain}</b>
                  <small>{domain.last_check_message || domain.last_mx_records || '-'}</small>
                </div>,
                domain.owner_email || text.admin.domainHealth.ownerUnknown,
                <SeverityPill severity={domain.severity}>{domainIssueLabel(domain.issue)}</SeverityPill>,
                <div className="segmented-control">
                  <button type="button" className={`segment-choice ${domain.mode === 'private' ? 'segment-choice-active' : ''}`} style={{ fontSize: '0.75rem' }} disabled={domain.mode === 'private' || updateDomainMode.isPending} onClick={(event) => {
                    domainHealthFeedbackOriginRef.current = event.currentTarget;
                    updateDomainMode.mutate({ domain, mode: 'private' });
                  }}>
                    {text.domains.modePrivate}
                  </button>
                  <button type="button" className={`segment-choice ${domain.mode === 'public' ? 'segment-choice-active' : ''}`} style={{ fontSize: '0.75rem' }} disabled={domain.mode === 'public' || updateDomainMode.isPending} onClick={(event) => {
                    domainHealthFeedbackOriginRef.current = event.currentTarget;
                    updateDomainMode.mutate({ domain, mode: 'public' });
                  }}>
                    {text.domains.modePublic}
                  </button>
                </div>,
                formatDomainExpiry(domain.domain_expires_at, language),
                String(domain.mailbox_count ?? domain.mailbox_created_count ?? 0),
                String(domain.message_count ?? 0),
                <div className="table-actions">
                  <button className="btn-ghost" onClick={(event) => {
                    domainHealthFeedbackOriginRef.current = event.currentTarget;
                    recheckDomain.mutate(domain);
                  }} disabled={recheckDomain.isPending} aria-label={`${text.admin.domainHealth.recheck} ${domain.domain}`}>
                    <RefreshCw size={14} aria-hidden="true" />
                    {text.admin.domainHealth.recheck}
                  </button>
                  <button className="btn-ghost" onClick={(event) => {
                    domainHealthFeedbackOriginRef.current = event.currentTarget;
                    deleteDomain.mutate(domain);
                  }} disabled={deleteDomain.isPending} aria-label={`${text.admin.domainHealth.delete} ${domain.domain}`}>
                    <Trash2 size={14} aria-hidden="true" />
                    {text.admin.domainHealth.delete}
                  </button>
                </div>
              ]
            }))}
          />
          <PaginationControls
            page={healthPage?.page || domainHealthPage}
            totalPages={healthPage?.total_pages || 1}
            onPageChange={domainHealthUrlState.setPage}
            rowsPerPage={domainHealthPerPage}
            rowsPerPageOptions={DOMAIN_HEALTH_PAGE_SIZE_OPTIONS}
            onRowsPerPageChange={(nextRowsPerPage) => {
              domainHealthUrlState.setPageSize(nextRowsPerPage);
            }}
            rowsPerPageLabel={text.common.rowsPerPage}
          />
        </section>

        <div hidden={activeAdminTab !== 'shareLinks'}>
          {activeAdminTab === 'shareLinks' && <AdminShareLinksPanel />}
        </div>

        <div hidden={activeAdminTab !== 'webhooks'}>
          {activeAdminTab === 'webhooks' && <AdminWebhooksPanel />}
        </div>

        <section className="panel admin-table-panel admin-api-interface-panel" id="admin-api-interfaces" hidden={activeAdminTab !== 'apiInterfaces'}>
          <div className="panel-header admin-panel-header">
            <div>
              <h2>{text.admin.apiInterfaces.title}</h2>
              <p>{text.admin.apiInterfaces.desc}</p>
            </div>
            <button
              ref={saveAPIInterfaceSettingsButtonRef}
              className="btn-secondary"
              type="button"
              onClick={() => saveAPIInterfaceSettings.mutate()}
              disabled={saveAPIInterfaceSettings.isPending || apiInterfaceSettings.isError}
              title={apiInterfaceSettings.isError ? text.admin.apiInterfaces.settingsError : undefined}
              aria-label={text.admin.apiInterfaces.save}
            >
              <Save size={15} aria-hidden="true" />
              {text.admin.apiInterfaces.save}
            </button>
          </div>
          {apiInterfaceSettings.isError && (
            <div className="admin-risk admin-risk-warning" role="alert">
              <ShieldAlert size={16} />
              <span><small>{text.admin.apiInterfaces.settingsError}</small></span>
            </div>
          )}
          <div className="admin-api-interface-grid">
            <div className="admin-api-interface-card">
              <div className="admin-api-interface-title">
                <span className={`admin-api-interface-mark ${apiInterfaceForm.yyds_compatibility_enabled ? 'admin-api-interface-mark-on' : ''}`}>
                  <KeyRound size={16} aria-hidden="true" />
                </span>
                <span>
                  <b>{text.admin.apiInterfaces.yydsTitle}</b>
                  <small>{text.admin.apiInterfaces.yydsPath}</small>
                </span>
              </div>
              <div className="toggle-row">
                <span className="toggle-row-label">
                  {text.admin.apiInterfaces.yydsEnabled}
                  <InfoTip text={text.admin.apiInterfaces.yydsEnabledDesc} />
                </span>
                <button
                  type="button"
                  className={`toggle-switch ${apiInterfaceForm.yyds_compatibility_enabled ? 'on' : ''}`}
                  onClick={() => setAPIInterfaceForm((current) => ({ ...current, yyds_compatibility_enabled: !current.yyds_compatibility_enabled }))}
                  role="switch"
                  aria-checked={apiInterfaceForm.yyds_compatibility_enabled}
                >
                  <span className="toggle-switch-knob" />
                </button>
              </div>
            </div>
            <div className="admin-api-interface-card">
              <div className="admin-api-interface-meta">
                <span>{text.admin.apiInterfaces.basePathLabel}</span>
                <code>/yyds/v1</code>
              </div>
              <p>{text.admin.apiInterfaces.scopeNote}</p>
            </div>
          </div>
        </section>

        <section className="panel admin-table-panel" id="admin-quota-alerts" hidden={activeAdminTab !== 'quotaAlerts'}>
          <div className="panel-header admin-panel-header">
            <div>
              <h2>{text.admin.quotaAlerts.title}</h2>
              <p>{text.admin.quotaAlerts.desc}</p>
            </div>
            <button className="btn-ghost" onClick={() => setPage('users')} aria-label={text.admin.quotaAlerts.goToUsers || text.admin.domainHealth.goToUsers}>{text.admin.quotaAlerts.goToUsers || text.admin.domainHealth.goToUsers}</button>
          </div>
          <DataTable
            ariaLabel={text.admin.quotaAlerts.title}
            density="compact"
            emptyLabel={text.admin.quotaAlerts.empty}
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
                  <small>{alert.kind === 'api_key' ? `API Key${alert.owner ? ` · ${alert.owner}` : ''}` : 'User'}</small>
                </div>,
                <SeverityPill severity={alert.severity}>{quotaReasonLabel(alert)}</SeverityPill>,
                quotaSummary(alert),
                relativeTime(alert.last_used_at)
              ]
            }))}
          />
          <PaginationControls
            page={quotaPage?.page || quotaAlertsPage}
            totalPages={quotaPage?.total_pages || 1}
            onPageChange={quotaAlertsUrlState.setPage}
            rowsPerPage={quotaAlertsPerPage}
            rowsPerPageOptions={[8, 20, 50]}
            onRowsPerPageChange={(nextRowsPerPage) => {
              quotaAlertsUrlState.setPageSize(nextRowsPerPage);
            }}
            rowsPerPageLabel={text.common.rowsPerPage}
          />
        </section>
      </div>

      <div hidden={activeAdminTab !== 'audit'}>
        <AdminAuditLog />
      </div>
    </div>
  );
}

function AdminDashboardOverview({
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
  onOpenAdminTab,
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
  onOpenAdminTab: (tab: string) => void;
  onOpenPage: (page: Page) => void;
}) {
  const text = useText();
  const growth = growthForRange(stats, range);
  const rangeLabel = text.admin.dashboard.rangeLabel.replace('{days}', range);
  const domainsTotal = stats?.total_domains ?? 0;
  const usersTotal = stats?.users ?? 0;
  const systemRiskItems = buildSystemRiskItems(text, stats, risks, quotaAlertsTotal, hasRunningCheck, onOpenAdminTab);
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

      {statsError && (
        <AdminDashboardAlert label={text.admin.dashboard.statsError} onRetry={onRetryStats} />
      )}

      <div className="admin-dashboard-metrics">
        <AdminSummaryMetric
          icon={Inbox}
          label={text.admin.dashboard.metricMailboxes}
          value={stats?.mailboxes ?? 0}
          growth={growth.mailboxes}
          growthLabel={rangeLabel}
          loading={statsLoading}
        />
        <AdminSummaryMetric
          icon={MailPlus}
          label={text.admin.dashboard.metricMessages}
          value={stats?.messages ?? 0}
          growth={growth.messages}
          growthLabel={rangeLabel}
          loading={statsLoading}
        />
        <AdminSummaryMetric
          icon={Globe2}
          label={text.admin.dashboard.metricDomains}
          value={domainsTotal}
          growth={growth.domains}
          growthLabel={rangeLabel}
          loading={statsLoading}
          onClick={() => onOpenAdminTab('domainHealth')}
        />
        <AdminSummaryMetric
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
            <AdminDashboardAlert label={text.admin.dashboard.timeseriesError} onRetry={onRetryTimeseries} compact />
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

function AdminSummaryMetric({
  icon: Icon,
  label,
  value,
  growth,
  growthLabel,
  loading,
  onClick
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  growth: number;
  growthLabel: string;
  loading: boolean;
  onClick?: () => void;
}) {
  const animated = useCountUp(value);
  const content = (
    <>
      <span className="admin-summary-icon"><Icon size={17} aria-hidden="true" /></span>
      <span className="admin-summary-copy">
        <span className="admin-summary-label">{label}</span>
        <strong>{loading ? <span className="metric-loading" aria-busy="true" /> : animated.toLocaleString()}</strong>
        <small>{growthLabel.replace('{count}', formatSignedNumber(growth))}</small>
      </span>
    </>
  );
  if (onClick) {
    return (
      <button className="admin-summary-metric admin-summary-metric-clickable" type="button" onClick={onClick}>
        {content}
      </button>
    );
  }
  return (
    <div className="admin-summary-metric">
      {content}
    </div>
  );
}

function TrendPanel({
  title,
  data,
  labels,
  color,
  unit,
  loading,
  emptyLabel
}: {
  title: string;
  data: number[];
  labels: string[];
  color: string;
  unit: string;
  loading: boolean;
  emptyLabel: string;
}) {
  return (
    <div className="admin-trend-panel">
      <h3>{title}</h3>
      <LineChart data={data} labels={labels} color={color} unit={unit} loading={loading} emptyLabel={emptyLabel} ariaLabel={title} />
    </div>
  );
}

function BreakdownPanel({
  title,
  total,
  items
}: {
  title: string;
  total: number;
  items: Array<{ label: string; value: number; tone: 'good' | 'bad' | 'focus' | 'neutral' }>;
}) {
  return (
    <section className="panel admin-breakdown-panel">
      <div className="admin-breakdown-header">
        <h2>{title}</h2>
        <span>{formatNumber(total)}</span>
      </div>
      <div className="admin-breakdown-list">
        {items.map((item) => (
          <div className={`admin-breakdown-row admin-breakdown-${item.tone}`} key={item.label}>
            <div>
              <span>{item.label}</span>
              <b>{formatNumber(item.value)}</b>
            </div>
            <div className="admin-breakdown-track" aria-hidden="true">
              <span style={{ width: `${percentage(item.value, total)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function AdminDashboardAlert({ label, onRetry, compact = false }: { label: string; onRetry: () => void; compact?: boolean }) {
  const text = useText();
  return (
    <div className={`dashboard-alert dashboard-alert-critical ${compact ? 'admin-dashboard-alert-compact' : ''}`} role="alert">
      <AlertTriangle size={16} />
      <span>{label}</span>
      <button className="btn-ghost" style={{ marginLeft: 'auto' }} onClick={onRetry}>
        {text.common.retry}
      </button>
    </div>
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
  onOpenAdminTab: (tab: string) => void
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
      onClick: () => onOpenAdminTab('domainHealth')
    },
    {
      key: 'quota-alerts',
      icon: BarChart3,
      level: quotaAlertsTotal > 0 ? 'warning' : 'ok',
      title: text.admin.dashboard.riskQuotaTitle,
      desc: quotaAlertsTotal > 0 ? text.admin.dashboard.riskQuotaDesc : text.admin.dashboard.riskQuotaEmpty,
      count: formatNumber(quotaAlertsTotal),
      onClick: () => onOpenAdminTab('quotaAlerts')
    },
    {
      key: 'config-risks',
      icon: configRiskCount > 0 ? KeyRound : ShieldCheck,
      level: configRiskCount > 0 ? 'warning' : 'ok',
      title: text.admin.dashboard.riskConfigTitle,
      desc: configRiskCount > 0 ? risks.map((risk) => risk.title).join(' / ') : text.admin.dashboard.riskConfigEmpty,
      count: formatNumber(configRiskCount),
      onClick: () => onOpenAdminTab('audit')
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
      onClick: () => onOpenAdminTab('dns')
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

function formatNumber(value: number) {
  return Math.max(0, Math.round(Number.isFinite(value) ? value : 0)).toLocaleString();
}

function formatSignedNumber(value: number) {
  const safe = Math.round(Number.isFinite(value) ? value : 0);
  return `${safe >= 0 ? '+' : ''}${safe.toLocaleString()}`;
}

function percentage(value: number, total: number) {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0 || value <= 0) return 0;
  return Math.max(2, Math.min(100, Math.round((value / total) * 100)));
}

function SeverityPill({ severity, children }: { severity: 'ok' | 'warning' | 'critical'; children: string }) {
  return <span className={`severity-pill severity-${severity}`}>{children}</span>;
}

function getAdminTab(value: string | null): AdminTab {
  return ADMIN_TAB_OPTIONS.includes(value as AdminTab) ? (value as AdminTab) : 'dns';
}

function splitResolvers(value: string) {
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toPositiveInt(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function buildDomainHealthQuery(filters: DomainHealthFilters, search: string, page: number, perPage: number) {
  const params = new URLSearchParams({
    page: String(page),
    per_page: String(perPage)
  });
  if (search.trim()) {
    params.set('q', search.trim());
  }
  if (filters.mode !== 'all') {
    params.set('mode', filters.mode);
  }
  if (filters.status !== 'all') {
    params.set('status', filters.status);
  }
  if (filters.mx !== 'all') {
    params.set('mx', filters.mx);
  }
  if (filters.severity !== 'all') {
    params.set('severity', filters.severity);
  }
  return params.toString();
}

function domainCheckStatusLabel(status: string) {
  const text = currentText();
  const labels: Record<string, string> = {
    running: text.admin.dnsCheck.statusRunning,
    success: text.admin.dnsCheck.statusSuccess,
    failed: text.admin.dnsCheck.statusFailed,
    canceled: text.admin.dnsCheck.statusCanceled
  };
  return labels[status] || status;
}

function domainCheckTriggerLabel(trigger: string) {
  const text = currentText();
  const labels: Record<string, string> = {
    schedule: text.admin.dnsCheck.triggerSchedule,
    manual: text.admin.dnsCheck.triggerManual
  };
  return labels[trigger] || trigger;
}

function domainCheckDuration(run: DomainCheckRun) {
  const text = currentText();
  if (!run.finished_at) return run.status === 'running' ? text.admin.dnsCheck.statusRunning : '-';
  const started = new Date(run.started_at).getTime();
  const finished = new Date(run.finished_at).getTime();
  if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started) return '-';
  return `${Math.round((finished - started) / 1000)}s`;
}

function domainIssueLabel(issue: string) {
  const text = currentText();
  const labels: Record<string, string> = {
    healthy: text.admin.domainHealth.issue.healthy,
    inactive: text.admin.domainHealth.issue.inactive,
    mx_failed: text.admin.domainHealth.issue.mxFailed,
    domain_expired: text.admin.domainHealth.issue.expired,
    domain_expiring: text.admin.domainHealth.issue.expiring,
    never_checked: text.admin.domainHealth.issue.neverChecked,
    stale_check: text.admin.domainHealth.issue.staleCheck
  };
  return labels[issue] || issue;
}

function quotaReasonLabel(alert: AdminQuotaAlert) {
  const text = currentText();
  const dailyExceeded = alert.kind === 'user' ? text.admin.quotaAlerts.reason.publicDailyExceeded : text.admin.quotaAlerts.reason.dailyExceeded;
  const dailyWarning = alert.kind === 'user' ? text.admin.quotaAlerts.reason.publicDailyWarning : text.admin.quotaAlerts.reason.dailyWarning;
  const labels: Record<string, string> = {
    daily_exceeded: dailyExceeded,
    daily_warning: dailyWarning,
    total_exceeded: text.admin.quotaAlerts.reason.totalExceeded,
    total_warning: text.admin.quotaAlerts.reason.totalWarning
  };
  return labels[alert.reason] || alert.reason;
}

function quotaSummary(alert: AdminQuotaAlert) {
  const text = currentText();
  const dailyValue = alert.daily_limit > 0 ? `${alert.used_today}/${alert.daily_limit}` : '';
  const daily = alert.kind === 'user'
    ? (dailyValue ? text.admin.quotaAlerts.publicDailyUsage.replace('{value}', dailyValue) : text.admin.quotaAlerts.publicDailyUnlimited)
    : (dailyValue ? text.admin.quotaAlerts.dailyUsage.replace('{value}', dailyValue) : text.admin.quotaAlerts.dailyUnlimited);
  const total = alert.total_limit > 0 ? `${alert.total_used}/${alert.total_limit}` : text.admin.quotaAlerts.totalUnlimited;
  return `${daily} · ${total}`;
}

function configRisks(stats?: AdminStats) {
  const text = currentText();
  if (!stats) return [];
  const risks: ConfigRisk[] = [];
  if (stats.dev_mode) {
    risks.push({ level: 'warning', title: text.admin.risk.devMode, desc: text.admin.risk.devModeDesc });
  }
  if (stats.admin_token_enabled) {
    risks.push({ level: 'warning', title: text.admin.risk.tokenEnabled, desc: text.admin.risk.tokenEnabledDesc });
  }
  if ((stats.failed_domains || 0) > 0) {
    risks.push({ level: 'warning', title: text.admin.risk.failedDomains, desc: text.admin.risk.failedDomainsDesc });
  }
  return risks;
}
