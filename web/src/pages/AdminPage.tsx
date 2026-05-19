import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Database, Eye, Globe2, Inbox, KeyRound, Megaphone, Play, RefreshCw, Save, ShieldAlert, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import type { AdminAnnouncement } from '../api';
import { api, patchJSON, postJSON } from '../api';
import type { AdminDomainHealth, AdminQuotaAlert, AdminStats, DomainCheckRun, DomainCheckSettings } from '../types';
import { domainModeLabel, formatDomainExpiry, relativeTime } from '../lib/display';
import { useAppStore } from '../store';
import { currentText, useText } from '../locales';
import { DataTable, Metric, StatusPill } from '../components/shared';
import { simpleMarkdownToHTML } from '../lib/markdown';
import { AdminAuditLog } from './AdminAuditLog';

export function AdminPage() {
  const queryClient = useQueryClient();
  const text = useText();
  const language = useAppStore((state) => state.language);
  const setPage = useAppStore((state) => state.setPage);

  const stats = useQuery({ queryKey: ['admin-stats'], queryFn: () => api<AdminStats>('/api/admin/stats'), retry: false, staleTime: 30_000 });
  const domainHealth = useQuery({ queryKey: ['admin-domain-health'], queryFn: () => api<AdminDomainHealth[]>('/api/admin/domain-health'), retry: false, staleTime: 30_000 });
  const quotaAlerts = useQuery({ queryKey: ['admin-quota-alerts'], queryFn: () => api<AdminQuotaAlert[]>('/api/admin/quota-alerts'), retry: false, staleTime: 30_000 });
  const domainCheckSettings = useQuery({
    queryKey: ['admin-domain-check-settings'],
    queryFn: () => api<DomainCheckSettings>('/api/admin/domain-check-settings'),
    retry: false,
    staleTime: 30_000,
    refetchInterval: (query) => query.state.data?.last_run?.status === 'running' ? 5000 : false
  });
  const domainCheckRuns = useQuery({
    queryKey: ['admin-domain-check-runs'],
    queryFn: () => api<DomainCheckRun[]>('/api/admin/domain-check-runs?limit=10'),
    retry: false,
    staleTime: 30_000,
    refetchInterval: (query) => query.state.data?.some((run) => run.status === 'running') ? 5000 : false
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

  // Announcement management state
  const [announcementTitle, setAnnouncementTitle] = useState('');
  const [announcementContent, setAnnouncementContent] = useState('');
  const [announcementPreview, setAnnouncementPreview] = useState(false);

  const adminAnnouncements = useQuery({
    queryKey: ['admin-announcements'],
    queryFn: () => api<AdminAnnouncement[]>('/api/admin/announcements'),
    retry: false
  });

  const createAnnouncement = useMutation({
    mutationFn: () => {
      if (!announcementTitle.trim()) throw new Error('Title is required');
      return postJSON<AdminAnnouncement>('/api/admin/announcements', {
        title: announcementTitle.trim(),
        content: announcementContent.trim()
      });
    },
    onSuccess: () => {
      setAnnouncementTitle('');
      setAnnouncementContent('');
      setAnnouncementPreview(false);
      queryClient.invalidateQueries({ queryKey: ['admin-announcements'] });
      queryClient.invalidateQueries({ queryKey: ['announcements'] });
      queryClient.invalidateQueries({ queryKey: ['announcements-unread-count'] });
      toast.success(text.announcements.created);
    },
    onError: (error) => toast.error(error.message)
  });

  const deleteAnnouncement = useMutation({
    mutationFn: (id: number) => {
      if (!window.confirm(text.announcements.deleteConfirm)) {
        throw new Error('Canceled');
      }
      return api(`/api/admin/announcements/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-announcements'] });
      queryClient.invalidateQueries({ queryKey: ['announcements'] });
      queryClient.invalidateQueries({ queryKey: ['announcements-unread-count'] });
      toast.success(text.announcements.deleted);
    },
    onError: (error) => {
      if (error.message !== 'Canceled') toast.error(error.message);
    }
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
    queryClient.invalidateQueries({ queryKey: ['admin-announcements'] });
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
      toast.success(text.admin.dnsCheck.saved);
    },
    onError: (error) => toast.error(error.message)
  });

  const runDomainCheck = useMutation({
    mutationFn: () => postJSON<{ run: DomainCheckRun; reused: boolean }>('/api/admin/domain-check-runs', {}),
    onSuccess: (result) => {
      refreshAdminData();
      toast.success(result.reused ? text.admin.dnsCheck.alreadyRunning : text.admin.dnsCheck.started);
    },
    onError: (error) => toast.error(error.message)
  });

  const recheckDomain = useMutation({
    mutationFn: (domain: string) => postJSON('/api/domains/check-mx', { domain }),
    onSuccess: () => {
      refreshAdminData();
      queryClient.invalidateQueries({ queryKey: ['domains-all'] });
      toast.success(text.admin.domainHealth.recheckDone);
    },
    onError: (error) => toast.error(error.message)
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
      toast.success(text.admin.domainHealth.disableDone);
    },
    onError: (error) => {
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
      toast.success(text.admin.domainHealth.makePrivateDone);
    },
    onError: (error) => {
      if (error.message !== 'Canceled') toast.error(error.message);
    }
  });

  const healthRows = (domainHealth.data || []).slice(0, 10);
  const risks = useMemo(
    () => stats.data ? configRisks(stats.data) : [],
    [stats.data]
  );
  const runRows = (domainCheckRuns.data || domainCheckSettings.data?.recent_runs || []).slice(0, 10);
  const lastRun = domainCheckSettings.data?.last_run;
  const hasRunningCheck = domainCheckRuns.data?.some((run) => run.status === 'running') || lastRun?.status === 'running';
  const isLoading = stats.isLoading || domainHealth.isLoading || quotaAlerts.isLoading || domainCheckSettings.isLoading || domainCheckRuns.isLoading;

  return (
    <div className="admin-page grid gap-4" id="admin-top">
      <div className="admin-page-header">
        <div>
          <h1>{text.admin.title}</h1>
          <p>{text.admin.desc}</p>
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
            <h2>{text.admin.systemStatus.title}</h2>
            <p>{text.admin.systemStatus.desc}</p>
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
        <div className="admin-dns-settings">
          <div className="segmented-control">
            <button type="button" className={`segment-choice ${!settingsForm.enabled ? 'segment-choice-active' : ''}`} onClick={() => setSettingsForm((current) => ({ ...current, enabled: false }))} aria-pressed={!settingsForm.enabled}>
              {text.common.disabled}
            </button>
            <button type="button" className={`segment-choice ${settingsForm.enabled ? 'segment-choice-active' : ''}`} onClick={() => setSettingsForm((current) => ({ ...current, enabled: true }))} aria-pressed={settingsForm.enabled}>
              {text.common.enabled}
            </button>
          </div>
          <div className="segmented-control">
            <button type="button" className={`segment-choice ${!settingsForm.check_inactive ? 'segment-choice-active' : ''}`} onClick={() => setSettingsForm((current) => ({ ...current, check_inactive: false }))} aria-pressed={!settingsForm.check_inactive}>
              {text.common.disabled}
            </button>
            <button type="button" className={`segment-choice ${settingsForm.check_inactive ? 'segment-choice-active' : ''}`} onClick={() => setSettingsForm((current) => ({ ...current, check_inactive: true }))} aria-pressed={settingsForm.check_inactive}>
              {text.common.enabled}
            </button>
          </div>
          <label className="grid gap-1 text-sm">
            <span className="text-[var(--muted)]">{text.admin.dnsCheck.interval}</span>
            <input className="input" type="number" min="1" value={settingsForm.interval_minutes} onChange={(event) => setSettingsForm((current) => ({ ...current, interval_minutes: event.target.value }))} />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-[var(--muted)]">{text.admin.dnsCheck.timeout}</span>
            <input className="input" type="number" min="500" value={settingsForm.timeout_ms} onChange={(event) => setSettingsForm((current) => ({ ...current, timeout_ms: event.target.value }))} />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-[var(--muted)]">{text.admin.dnsCheck.concurrency}</span>
            <input className="input" type="number" min="1" value={settingsForm.max_concurrency} onChange={(event) => setSettingsForm((current) => ({ ...current, max_concurrency: event.target.value }))} />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-[var(--muted)]">{text.admin.dnsCheck.failureThreshold}</span>
            <input className="input" type="number" min="1" value={settingsForm.failure_threshold} onChange={(event) => setSettingsForm((current) => ({ ...current, failure_threshold: event.target.value }))} />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-[var(--muted)]">{text.admin.dnsCheck.recoveryThreshold}</span>
            <input className="input" type="number" min="1" value={settingsForm.recovery_threshold} onChange={(event) => setSettingsForm((current) => ({ ...current, recovery_threshold: event.target.value }))} />
          </label>
          <label className="grid gap-1 text-sm admin-resolver-field">
            <span className="text-[var(--muted)]">{text.admin.dnsCheck.resolvers}</span>
            <textarea className="input-textarea" rows={4} value={settingsForm.resolvers} onChange={(event) => setSettingsForm((current) => ({ ...current, resolvers: event.target.value }))} />
          </label>
        </div>
        <DataTable
          emptyLabel={text.admin.dnsCheck.empty}
          columns={[
            { key: 'started-at', header: text.admin.dnsCheck.colTime },
            { key: 'trigger', header: text.admin.dnsCheck.colTrigger },
            { key: 'status', header: text.admin.dnsCheck.colStatus },
            { key: 'progress', header: text.admin.dnsCheck.colProgress },
            { key: 'passed', header: text.admin.dnsCheck.colPassed },
            { key: 'failed', header: text.admin.dnsCheck.colFailed },
            { key: 'duration', header: text.admin.dnsCheck.colDuration }
          ]}
          rows={runRows.map((run) => ({
            key: run.id,
            cells: [
              relativeTime(run.started_at),
              run.trigger,
              <SeverityPill severity={run.status === 'failed' ? 'critical' : run.status === 'running' ? 'warning' : 'ok'}>{domainCheckStatusLabel(run.status)}</SeverityPill>,
              `${run.checked}/${run.total}`,
              String(run.passed),
              String(run.failed),
              domainCheckDuration(run)
            ]
          }))}
        />
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
            emptyLabel={text.admin.domainHealth.empty}
            columns={[
              { key: 'domain', header: text.admin.domainHealth.colDomain },
              { key: 'status', header: text.admin.domainHealth.colStatus },
              { key: 'mode', header: text.admin.domainHealth.colMode },
              { key: 'expires', header: text.admin.domainHealth.colExpires },
              { key: 'messages', header: text.admin.domainHealth.colMessages },
              { key: 'actions', header: text.admin.domainHealth.colActions }
            ]}
            rows={healthRows.map((domain) => ({
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
                  <button className="btn-ghost" onClick={() => recheckDomain.mutate(domain.domain)} disabled={recheckDomain.isPending} aria-label={`${text.admin.domainHealth.recheck} ${domain.domain}`}>
                    <RefreshCw size={14} aria-hidden="true" />
                    {text.admin.domainHealth.recheck}
                  </button>
                  <button className="btn-ghost" onClick={() => makePrivate.mutate(domain)} disabled={domain.mode === 'private' || makePrivate.isPending} aria-label={`${text.admin.domainHealth.makePrivate} ${domain.domain}`}>
                    {text.admin.domainHealth.makePrivate}
                  </button>
                  <button className="btn-ghost" onClick={() => disableDomain.mutate(domain)} disabled={!domain.active || disableDomain.isPending} aria-label={`${text.admin.domainHealth.disable} ${domain.domain}`}>
                    {text.admin.domainHealth.disable}
                  </button>
                </div>
              ]
            }))}
          />
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
            emptyLabel={text.admin.quotaAlerts.empty}
            columns={[
              { key: 'target', header: text.admin.quotaAlerts.colTarget },
              { key: 'severity', header: text.admin.quotaAlerts.colSeverity },
              { key: 'usage', header: text.admin.quotaAlerts.colUsage },
              { key: 'last-used', header: text.admin.quotaAlerts.colLastUsed }
            ]}
            rows={(quotaAlerts.data || []).slice(0, 8).map((alert) => ({
              key: `${alert.kind}-${alert.id}`,
              cells: [
                <div className="admin-domain-cell">
                  <b>{alert.label}</b>
                  <small>{alert.kind === 'api_key' ? `API Key${alert.owner ? ` · ${alert.owner}` : ''}` : 'User'}</small>
                </div>,
                <SeverityPill severity={alert.severity}>{quotaReasonLabel(alert.reason)}</SeverityPill>,
                quotaSummary(alert),
                relativeTime(alert.last_used_at)
              ]
            }))}
          />
        </section>
      </div>

      <section className="panel" id="admin-announcements">
        <div className="panel-header admin-panel-header">
          <div>
            <h2>{text.announcements.title}</h2>
            <p>{text.announcements.newAnnouncement}</p>
          </div>
        </div>

        <div className="admin-announcement-form">
          <label className="grid gap-1 text-sm">
            <span className="text-[var(--muted)]">{text.common.create} {text.announcements.title}</span>
            <input
              className="input"
              type="text"
              value={announcementTitle}
              onChange={(event) => setAnnouncementTitle(event.target.value)}
              placeholder={text.announcements.titlePlaceholder}
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-[var(--muted)]">{text.announcements.content}</span>
            <textarea
              className="input-textarea"
              rows={6}
              value={announcementContent}
              onChange={(event) => setAnnouncementContent(event.target.value)}
              placeholder={text.announcements.contentPlaceholder}
            />
          </label>
          <div className="admin-announcement-actions">
            <button
              className="btn-ghost"
              type="button"
              onClick={() => setAnnouncementPreview((v) => !v)}
              disabled={!announcementContent.trim()}
              aria-label={text.announcements.preview}
            >
              <Eye size={14} aria-hidden="true" />
              {text.announcements.preview}
            </button>
            <button
              className="btn-secondary"
              type="button"
              onClick={() => createAnnouncement.mutate()}
              disabled={!announcementTitle.trim() || createAnnouncement.isPending}
              aria-label={text.announcements.createAnnouncement}
            >
              <Megaphone size={14} aria-hidden="true" />
              {createAnnouncement.isPending ? text.common.loading : text.announcements.createAnnouncement}
            </button>
          </div>
          {announcementPreview && announcementContent.trim() && (
            <div className="admin-announcement-preview">
              <div
                className="message-center-markdown"
                dangerouslySetInnerHTML={{ __html: simpleMarkdownToHTML(announcementContent) }}
              />
            </div>
          )}
        </div>

        <DataTable
          emptyLabel={text.announcements.noAnnouncements}
          columns={[
            { key: 'title', header: text.announcements.title },
            { key: 'created', header: text.common.refresh },
            { key: 'readers', header: text.announcements.read },
            { key: 'status', header: text.common.enabled },
            { key: 'actions', header: text.common.delete }
          ]}
          rows={(adminAnnouncements.data || []).slice(0, 15).map((ann) => ({
            key: ann.id,
            cells: [
              <div className="admin-domain-cell">
                <b>{ann.title}</b>
                <small>{ann.content.slice(0, 80)}{ann.content.length > 80 ? '...' : ''}</small>
              </div>,
              relativeTime(ann.created_at),
              text.announcements.readerCount.replace('{count}', String(ann.reader_count ?? 0)),
              ann.deleted_at ? (
                <span className="severity-pill severity-critical">{text.common.delete}</span>
              ) : (
                <span className="severity-pill severity-ok">{text.common.enabled}</span>
              ),
              <div className="table-actions">
                {!ann.deleted_at && (
                  <button
                    className="btn-ghost"
                    onClick={() => deleteAnnouncement.mutate(ann.id)}
                    disabled={deleteAnnouncement.isPending}
                    aria-label={text.announcements.deleteAnnouncement}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                    {text.announcements.deleteAnnouncement}
                  </button>
                )}
              </div>
            ]
          }))}
        />
      </section>

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

function quotaReasonLabel(reason: string) {
  const text = currentText();
  const labels: Record<string, string> = {
    daily_exceeded: text.admin.quotaAlerts.reason.dailyExceeded,
    daily_warning: text.admin.quotaAlerts.reason.dailyWarning,
    total_exceeded: text.admin.quotaAlerts.reason.totalExceeded,
    total_warning: text.admin.quotaAlerts.reason.totalWarning
  };
  return labels[reason] || reason;
}

function quotaSummary(alert: AdminQuotaAlert) {
  const text = currentText();
  const daily = alert.daily_limit > 0 ? `${alert.used_today}/${alert.daily_limit}` : text.admin.quotaAlerts.dailyUnlimited;
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
