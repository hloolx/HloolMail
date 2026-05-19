import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Database, Globe2, Inbox, KeyRound, Play, RefreshCw, Save, ShieldAlert, Users } from 'lucide-react';
import { toast } from 'sonner';
import { api, patchJSON, postJSON } from '../api';
import type { PaginatedResponse } from '../api';
import type { AdminDomainHealth, AdminQuotaAlert, AdminStats, DomainCheckRun, DomainCheckRunsPage, DomainCheckSettings } from '../types';
import { domainModeLabel, formatDomainExpiry, relativeTime } from '../lib/display';
import { notifySuccess } from '../lib/feedback';
import { useAppStore } from '../store';
import { currentText, useText } from '../locales';
import { DataTable, InfoTip, Metric, PaginationControls, StatusPill } from '../components/shared';
import { AdminAuditLog } from './AdminAuditLog';

export function AdminPage() {
  const queryClient = useQueryClient();
  const text = useText();
  const language = useAppStore((state) => state.language);
  const setPage = useAppStore((state) => state.setPage);
  const [dnsCheckPage, setDnsCheckPage] = useState(1);
  const [domainHealthPage, setDomainHealthPage] = useState(1);
  const [quotaAlertsPage, setQuotaAlertsPage] = useState(1);
  const saveDnsSettingsButtonRef = useRef<HTMLButtonElement | null>(null);
  const runDnsCheckButtonRef = useRef<HTMLButtonElement | null>(null);
  const domainHealthFeedbackOriginRef = useRef<HTMLElement | null>(null);
  const dnsCheckPerPage = 10;
  const domainHealthPerPage = 10;
  const quotaAlertsPerPage = 8;

  const stats = useQuery({ queryKey: ['admin-stats'], queryFn: () => api<AdminStats>('/api/admin/stats'), retry: false, staleTime: 30_000 });
  const domainHealth = useQuery({
    queryKey: ['admin-domain-health', domainHealthPage],
    queryFn: () => api<PaginatedResponse<AdminDomainHealth>>(`/api/admin/domain-health?page=${domainHealthPage}&per_page=${domainHealthPerPage}`),
    retry: false,
    staleTime: 30_000
  });
  const quotaAlerts = useQuery({
    queryKey: ['admin-quota-alerts', quotaAlertsPage],
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

  const refreshAdminData = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
    queryClient.invalidateQueries({ queryKey: ['admin-domain-health'] });
    queryClient.invalidateQueries({ queryKey: ['admin-quota-alerts'] });
    queryClient.invalidateQueries({ queryKey: ['admin-audit-logs'] });
    queryClient.invalidateQueries({ queryKey: ['admin-domain-check-settings'] });
    queryClient.invalidateQueries({ queryKey: ['admin-domain-check-runs'] });
    queryClient.invalidateQueries({ queryKey: ['admin-quota-settings'] });
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

  const recheckDomain = useMutation({
    mutationFn: (domain: string) => postJSON('/api/domains/check-mx', { domain }),
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

  const disableDomain = useMutation({
    mutationFn: (domain: AdminDomainHealth) => {
      if (!window.confirm(text.admin.domainHealth.disableConfirm.replace('{domain}', domain.domain))) {
        throw new Error('Canceled');
      }
      return patchJSON(`/api/domains/${domain.id}`, { active: false });
    },
    onSuccess: () => {
      refreshAdminData();
      queryClient.invalidateQueries({ queryKey: ['domains-all'] });
      notifySuccess(text.admin.domainHealth.disableDone, { origin: domainHealthFeedbackOriginRef.current });
      domainHealthFeedbackOriginRef.current = null;
    },
    onError: (error) => {
      domainHealthFeedbackOriginRef.current = null;
      if (error.message !== 'Canceled') toast.error(error.message);
    }
  });

  const makePrivate = useMutation({
    mutationFn: (domain: AdminDomainHealth) => {
      if (!window.confirm(text.admin.domainHealth.privateConfirm.replace('{domain}', domain.domain))) {
        throw new Error('Canceled');
      }
      return patchJSON(`/api/domains/${domain.id}`, { mode: 'private' });
    },
    onSuccess: () => {
      refreshAdminData();
      queryClient.invalidateQueries({ queryKey: ['domains-all'] });
      notifySuccess(text.admin.domainHealth.makePrivateDone, { origin: domainHealthFeedbackOriginRef.current });
      domainHealthFeedbackOriginRef.current = null;
    },
    onError: (error) => {
      domainHealthFeedbackOriginRef.current = null;
      if (error.message !== 'Canceled') toast.error(error.message);
    }
  });

  const healthPage = domainHealth.data;
  const quotaPage = quotaAlerts.data;
  const risks = useMemo(
    () => stats.data ? configRisks(stats.data) : [],
    [stats.data]
  );
  const runRows = domainCheckRuns.data?.runs || domainCheckSettings.data?.recent_runs || [];
  const runsPage = domainCheckRuns.data;
  const lastRun = domainCheckSettings.data?.last_run;
  const hasRunningCheck = runRows.some((run) => run.status === 'running') || lastRun?.status === 'running';
  const isLoading = stats.isLoading || domainHealth.isLoading || quotaAlerts.isLoading || domainCheckSettings.isLoading || domainCheckRuns.isLoading;

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

      <div className="grid gap-3 md:grid-cols-4">
        <Metric icon={Inbox} label={text.dashboard.messagesTotal} value={stats.data?.messages ?? 0} loading={stats.isLoading} />
        <Metric icon={Globe2} label={text.admin.enabledDomains} value={stats.data?.active_domains ?? 0} loading={stats.isLoading} />
        <Metric icon={Users} label={text.admin.userMetric} value={stats.data?.users ?? 0} loading={stats.isLoading} />
        <Metric icon={KeyRound} label={text.dashboard.apiCalls} value={stats.data?.api_usage_today ?? 0} loading={stats.isLoading} />
      </div>

      <section className="panel" id="admin-system-status">
        <div className="panel-header">
          <div>
            <h2>{text.admin.systemStatus.title}<InfoTip text={text.admin.systemStatus.desc} /></h2>
          </div>
        </div>
        <div className="admin-status-grid">
          <StatusPill ok={!stats.isError} loading={stats.isLoading}>{text.admin.systemStatus.adminApi}</StatusPill>
          <StatusPill ok={!stats.data?.failed_domains} loading={stats.isLoading}>{text.admin.systemStatus.domainHealth}</StatusPill>
          <StatusPill ok={stats.data ? true : undefined} loading={stats.isLoading}>
            {stats.isLoading || !stats.data ? text.admin.systemStatus.cleanup : text.admin.systemStatus.cleanupUnchecked}
          </StatusPill>
          <StatusPill ok={!stats.data?.admin_token_is_default} loading={stats.isLoading}>{text.admin.systemStatus.adminToken}</StatusPill>
        </div>
        <div className="admin-risk-list">
          {risks.length ? risks.map((item) => (
            <div className={`admin-risk admin-risk-${item.level}`} key={item.title} role={item.level === 'critical' ? 'alert' : 'status'}>
              <ShieldAlert size={16} aria-hidden="true" />
              <span>
                <b>{item.title}</b>
                <small>{item.desc}</small>
              </span>
            </div>
          )) : (
            <div className="admin-risk admin-risk-ok" role="status">
              <Database size={16} />
              <span>
                <b>{text.admin.risk.none}</b>
                <small>{text.admin.risk.mxTarget}：{stats.data?.expected_mx || '-'}</small>
              </span>
            </div>
          )}
        </div>
      </section>

      <section className="panel" id="admin-dns-check">
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
            <PaginationControls page={runsPage?.page || 1} totalPages={runsPage?.total_pages || 1} onPageChange={setDnsCheckPage} />
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]" id="admin-domain-health">
        <section className="panel">
          <div className="panel-header admin-panel-header">
            <div>
              <h2>{text.admin.domainHealth.title}</h2>
              <p>{text.admin.domainHealth.desc.replace('{failed}', String(stats.data?.failed_domains ?? 0)).replace('{stale}', String(stats.data?.stale_domains ?? 0))}</p>
            </div>
            <button className="btn-ghost" onClick={() => setPage('domain-management')} aria-label={text.admin.domainHealth.goToDomains}>{text.admin.domainHealth.goToDomains}</button>
          </div>
          <DataTable
            ariaLabel={text.admin.domainHealth.title}
            emptyLabel={text.admin.domainHealth.empty}
            columns={[
              { key: 'domain', header: text.admin.domainHealth.colDomain, minWidth: '14rem' },
              { key: 'status', header: text.admin.domainHealth.colStatus, align: 'center', width: '8rem' },
              { key: 'mode', header: text.admin.domainHealth.colMode, width: '7rem' },
              { key: 'expires', header: text.admin.domainHealth.colExpires, width: '8rem' },
              { key: 'messages', header: text.admin.domainHealth.colMessages, align: 'right', width: '7rem' },
              { key: 'actions', header: text.admin.domainHealth.colActions, align: 'right', minWidth: '18rem' }
            ]}
            rows={(healthPage?.items || []).map((domain) => ({
              key: domain.id,
              cells: [
                <div className="admin-domain-cell">
                  <b>{domain.domain}</b>
                  <small>{domain.last_check_message || domain.last_mx_records || '-'}</small>
                </div>,
                <SeverityPill severity={domain.severity}>{domainIssueLabel(domain.issue)}</SeverityPill>,
                domainModeLabel(domain.mode, language),
                formatDomainExpiry(domain.domain_expires_at, language),
                String(domain.message_count ?? 0),
                <div className="table-actions">
                  <button className="btn-ghost" onClick={(event) => {
                    domainHealthFeedbackOriginRef.current = event.currentTarget;
                    recheckDomain.mutate(domain.domain);
                  }} disabled={recheckDomain.isPending} aria-label={`${text.admin.domainHealth.recheck} ${domain.domain}`}>
                    <RefreshCw size={14} aria-hidden="true" />
                    {text.admin.domainHealth.recheck}
                  </button>
                  <button className="btn-ghost" onClick={(event) => {
                    domainHealthFeedbackOriginRef.current = event.currentTarget;
                    makePrivate.mutate(domain);
                  }} disabled={domain.mode === 'private' || makePrivate.isPending} aria-label={`${text.admin.domainHealth.makePrivate} ${domain.domain}`}>
                    {text.admin.domainHealth.makePrivate}
                  </button>
                  <button className="btn-ghost" onClick={(event) => {
                    domainHealthFeedbackOriginRef.current = event.currentTarget;
                    disableDomain.mutate(domain);
                  }} disabled={!domain.active || disableDomain.isPending} aria-label={`${text.admin.domainHealth.disable} ${domain.domain}`}>
                    {text.admin.domainHealth.disable}
                  </button>
                </div>
              ]
            }))}
          />
          <PaginationControls page={healthPage?.page || 1} totalPages={healthPage?.total_pages || 1} onPageChange={setDomainHealthPage} />
        </section>

        <section className="panel" id="admin-quota-alerts">
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
          <PaginationControls page={quotaPage?.page || 1} totalPages={quotaPage?.total_pages || 1} onPageChange={setQuotaAlertsPage} />
        </section>
      </div>

      <AdminAuditLog />
    </div>
  );
}

function SeverityPill({ severity, children }: { severity: 'ok' | 'warning' | 'critical'; children: string }) {
  return <span className={`severity-pill severity-${severity}`}>{children}</span>;
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
  const risks: { level: 'warning' | 'critical' | 'ok'; title: string; desc: string }[] = [];
  if (stats.dev_mode) {
    risks.push({ level: 'warning', title: text.admin.risk.devMode, desc: text.admin.risk.devModeDesc });
  }
  if (stats.admin_token_is_default) {
    risks.push({ level: 'critical', title: text.admin.risk.defaultToken, desc: text.admin.risk.defaultTokenDesc });
  } else if (stats.admin_token_enabled) {
    risks.push({ level: 'warning', title: text.admin.risk.tokenEnabled, desc: text.admin.risk.tokenEnabledDesc });
  }
  if ((stats.failed_domains || 0) > 0) {
    risks.push({ level: 'warning', title: text.admin.risk.failedDomains, desc: text.admin.risk.failedDomainsDesc });
  }
  return risks;
}
