import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Play, RefreshCw, Save, ShieldAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useText } from '../../../locales';
import { relativeTime } from '../../../lib/display';
import { notifySuccess } from '../../../lib/feedback';
import { queryKeys } from '../../../lib/queryKeys';
import { useDirtyNavigationGuard } from '../../../hooks/useDirtyNavigationGuard';
import { useTableUrlState } from '../../../hooks/useTableUrlState';
import { DataTable, InfoTip, PaginationControls } from '../../../components/shared';
import type { DomainCheckSettings } from '../../../types';
import { AdminPageFrame } from '../components/AdminPageFrame';
import { SeverityPill } from '../components/SeverityPill';
import {
  domainCheckDuration,
  domainCheckStatusLabel,
  domainCheckTriggerLabel,
  formFingerprint,
  isDirtyFromBaseline,
  queryErrorMessage,
  splitResolvers,
  toPositiveInt
} from '../utils/adminFormatting';
import {
  useDomainCheckRunsQuery,
  useDomainCheckSettingsQuery,
  useRunDomainCheckMutation,
  useSaveDomainCheckSettingsMutation
} from '../hooks/useAdminQueries';
import type { DomainCheckSettingsPayload } from '../services/adminService';

type DomainCheckSettingsForm = {
  enabled: boolean;
  interval_minutes: string;
  timeout_ms: string;
  max_concurrency: string;
  resolvers: string;
  check_inactive: boolean;
  failure_threshold: string;
  recovery_threshold: string;
};

const DEFAULT_SETTINGS_FORM: DomainCheckSettingsForm = {
  enabled: true,
  interval_minutes: '30',
  timeout_ms: '3500',
  max_concurrency: '5',
  resolvers: '1.1.1.1:53\n8.8.8.8:53\n223.5.5.5:53',
  check_inactive: false,
  failure_threshold: '2',
  recovery_threshold: '1'
};

export function AdminDnsPage() {
  const text = useText();
  const queryClient = useQueryClient();
  const dnsRunsUrlState = useTableUrlState({
    pageParam: 'dnsPage',
    pageSizeParam: 'dnsPageSize',
    pageSizeOptions: [10, 20, 50]
  });
  const domainCheckSettings = useDomainCheckSettingsQuery();
  const domainCheckRuns = useDomainCheckRunsQuery(dnsRunsUrlState.page, dnsRunsUrlState.pageSize);
  const saveButtonRef = useRef<HTMLButtonElement | null>(null);
  const runButtonRef = useRef<HTMLButtonElement | null>(null);
  const [settingsForm, setSettingsForm] = useState<DomainCheckSettingsForm>(DEFAULT_SETTINGS_FORM);
  const settingsFormRef = useRef(settingsForm);
  const settingsBaselineRef = useRef('');

  useEffect(() => {
    settingsFormRef.current = settingsForm;
  }, [settingsForm]);

  useEffect(() => {
    const settings = domainCheckSettings.data;
    if (!settings) return;
    const nextForm = domainCheckSettingsFormFromSettings(settings);
    if (isDirtyFromBaseline(settingsFormRef.current, settingsBaselineRef.current)) return;
    settingsBaselineRef.current = formFingerprint(nextForm);
    setSettingsForm(nextForm);
  }, [domainCheckSettings.data]);

  const invalidateDnsQueries = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.domainCheckSettings });
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.domainCheckRunsRoot });
  };

  const saveSettings = useSaveDomainCheckSettingsMutation({
    onSuccess: (settings) => {
      const nextForm = domainCheckSettingsFormFromSettings(settings);
      settingsBaselineRef.current = formFingerprint(nextForm);
      setSettingsForm(nextForm);
      invalidateDnsQueries();
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.auditLogsRoot });
      notifySuccess(text.admin.dnsCheck.saved, { origin: saveButtonRef.current });
    },
    onError: (error) => toast.error(error.message)
  });

  const runCheck = useRunDomainCheckMutation({
    onSuccess: (result) => {
      invalidateDnsQueries();
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.domainHealthRoot });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.stats });
      notifySuccess(result.reused ? text.admin.dnsCheck.alreadyRunning : text.admin.dnsCheck.started, { origin: runButtonRef.current });
    },
    onError: (error) => toast.error(error.message)
  });

  const runRows = domainCheckRuns.data?.runs || domainCheckSettings.data?.recent_runs || [];
  const runsPage = domainCheckRuns.data;
  const lastRun = domainCheckSettings.data?.last_run;
  const hasRunningCheck = runRows.some((run) => run.status === 'running') || lastRun?.status === 'running';
  const isRefreshing = domainCheckSettings.isFetching || domainCheckRuns.isFetching;
  const hasSettingsChanges = isDirtyFromBaseline(settingsForm, settingsBaselineRef.current);
  useDirtyNavigationGuard(hasSettingsChanges && !saveSettings.isPending, text.oauth.unsaved_desc);

  const submitSettings = () => {
    const payload = settingsPayload(settingsForm);
    if (!payload) {
      toast.error(text.admin.validation.invalidNumber);
      return;
    }
    saveSettings.mutate(payload);
  };

  const refreshDns = () => {
    invalidateDnsQueries();
  };

  return (
    <AdminPageFrame
      title={text.page['admin-dns']}
      actions={(
        <button className="btn-secondary" onClick={refreshDns} disabled={isRefreshing} aria-label={text.admin.refresh}>
          <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} aria-hidden="true" />
          {text.admin.refresh}
        </button>
      )}
    >
      <section className="panel admin-table-panel" id="admin-dns-check">
        <div className="panel-header admin-panel-header">
          <div>
            <h2>{text.admin.dnsCheck.title}</h2>
            <p>
              {lastRun ? `${domainCheckStatusLabel(lastRun.status)} / ${lastRun.checked}/${lastRun.total}` : text.admin.dnsCheck.noRunsYet}
              {domainCheckSettings.data?.next_run_at ? ` / ${text.admin.dnsCheck.nextRun} ${relativeTime(domainCheckSettings.data.next_run_at)}` : ''}
            </p>
          </div>
          <div className="table-actions">
            <button
              ref={saveButtonRef}
              className="btn-secondary"
              type="button"
              onClick={submitSettings}
              disabled={saveSettings.isPending || domainCheckSettings.isError || !hasSettingsChanges}
              title={domainCheckSettings.isError ? text.admin.dnsCheck.settingsError : !hasSettingsChanges ? text.admin.dnsCheck.saved : undefined}
              aria-label={text.admin.dnsCheck.save}
              aria-busy={saveSettings.isPending ? 'true' : undefined}
            >
              {saveSettings.isPending ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Save size={15} aria-hidden="true" />}
              {text.admin.dnsCheck.save}
            </button>
            <button
              ref={runButtonRef}
              className="btn-secondary"
              type="button"
              onClick={() => runCheck.mutate()}
              disabled={runCheck.isPending || hasRunningCheck}
              aria-label={text.admin.dnsCheck.run}
              aria-busy={runCheck.isPending ? 'true' : undefined}
            >
              {runCheck.isPending ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
              {text.admin.dnsCheck.run}
            </button>
          </div>
        </div>
        {domainCheckSettings.isError && (
          <div className="admin-risk admin-risk-warning" role="alert" style={{ marginBottom: '0.9rem' }}>
            <ShieldAlert size={16} />
            <span><small>{queryErrorMessage(domainCheckSettings.error, text.admin.dnsCheck.settingsError)}</small></span>
            <button className="btn-ghost btn-sm" type="button" onClick={() => domainCheckSettings.refetch()} disabled={domainCheckSettings.isFetching}>
              {text.common.retry}
            </button>
          </div>
        )}
        <div className="admin-dns-grid">
          <div className="admin-dns-settings" aria-busy={domainCheckSettings.isLoading ? 'true' : undefined}>
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
                  aria-label={text.admin.dnsCheck.enabled}
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
                  aria-label={text.admin.dnsCheck.checkInactive}
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
              loading={domainCheckRuns.isLoading}
              loadingLabel={text.common.loading}
              error={domainCheckRuns.isError}
              errorLabel={queryErrorMessage(domainCheckRuns.error, text.admin.dnsCheck.empty)}
              retryLabel={text.common.retry}
              onRetry={() => domainCheckRuns.refetch()}
              retryPending={domainCheckRuns.isFetching}
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
              page={runsPage?.page || dnsRunsUrlState.page}
              totalPages={runsPage?.total_pages || 1}
              onPageChange={dnsRunsUrlState.setPage}
              rowsPerPage={dnsRunsUrlState.pageSize}
              rowsPerPageOptions={[10, 20, 50]}
              onRowsPerPageChange={dnsRunsUrlState.setPageSize}
              rowsPerPageLabel={text.common.rowsPerPage}
            />
          </div>
        </div>
      </section>
    </AdminPageFrame>
  );
}

function domainCheckSettingsFormFromSettings(settings: DomainCheckSettings): DomainCheckSettingsForm {
  return {
    enabled: settings.enabled,
    interval_minutes: String(settings.interval_minutes),
    timeout_ms: String(settings.timeout_ms),
    max_concurrency: String(settings.max_concurrency),
    resolvers: (settings.resolvers || []).join('\n'),
    check_inactive: settings.check_inactive,
    failure_threshold: String(settings.failure_threshold),
    recovery_threshold: String(settings.recovery_threshold)
  };
}

function settingsPayload(form: DomainCheckSettingsForm): DomainCheckSettingsPayload | null {
  const keys = ['interval_minutes', 'timeout_ms', 'max_concurrency', 'failure_threshold', 'recovery_threshold'] as const;
  const allValid = keys.every((key) => {
    const parsed = Number.parseInt(form[key], 10);
    return Number.isFinite(parsed) && parsed > 0;
  });
  if (!allValid) return null;
  return {
    enabled: form.enabled,
    interval_minutes: toPositiveInt(form.interval_minutes, 30),
    timeout_ms: toPositiveInt(form.timeout_ms, 3500),
    max_concurrency: toPositiveInt(form.max_concurrency, 5),
    resolvers: splitResolvers(form.resolvers),
    check_inactive: form.check_inactive,
    failure_threshold: toPositiveInt(form.failure_threshold, 2),
    recovery_threshold: toPositiveInt(form.recovery_threshold, 1)
  };
}
