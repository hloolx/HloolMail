import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Activity, ClipboardList, Database, Globe2, Inbox, KeyRound, Play, RefreshCw, Save, ShieldAlert, Users } from 'lucide-react';
import { toast } from 'sonner';
import { api, patchJSON, postJSON } from '../api';
import type { AdminDomainHealth, AdminQuotaAlert, AdminStats, AuditLog, DomainCheckRun, DomainCheckSettings } from '../types';
import { domainModeLabel, formatDomainExpiry, relativeTime } from '../lib/display';
import { useAppStore } from '../store';
import { useText } from '../locales';
import { DataTable, Metric, StatusPill } from '../components/shared';

export function AdminPage() {
  const queryClient = useQueryClient();
  const text = useText();
  const language = useAppStore((state) => state.language);
  const setPage = useAppStore((state) => state.setPage);
  const stats = useQuery({ queryKey: ['admin-stats'], queryFn: () => api<AdminStats>('/api/admin/stats'), retry: false });
  const domainHealth = useQuery({ queryKey: ['admin-domain-health'], queryFn: () => api<AdminDomainHealth[]>('/api/admin/domain-health'), retry: false });
  const quotaAlerts = useQuery({ queryKey: ['admin-quota-alerts'], queryFn: () => api<AdminQuotaAlert[]>('/api/admin/quota-alerts'), retry: false });
  const auditLogs = useQuery({ queryKey: ['admin-audit-logs'], queryFn: () => api<AuditLog[]>('/api/admin/audit-logs?limit=30'), retry: false });
  const domainCheckSettings = useQuery({
    queryKey: ['admin-domain-check-settings'],
    queryFn: () => api<DomainCheckSettings>('/api/admin/domain-check-settings'),
    retry: false,
    refetchInterval: (query) => query.state.data?.last_run?.status === 'running' ? 5000 : false
  });
  const domainCheckRuns = useQuery({
    queryKey: ['admin-domain-check-runs'],
    queryFn: () => api<DomainCheckRun[]>('/api/admin/domain-check-runs?limit=10'),
    retry: false,
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
  };

  const saveDomainCheckSettings = useMutation({
    mutationFn: () => patchJSON<DomainCheckSettings>('/api/admin/domain-check-settings', {
      enabled: settingsForm.enabled,
      interval_minutes: toPositiveInt(settingsForm.interval_minutes, 30),
      timeout_ms: toPositiveInt(settingsForm.timeout_ms, 3500),
      max_concurrency: toPositiveInt(settingsForm.max_concurrency, 5),
      resolvers: splitResolvers(settingsForm.resolvers),
      check_inactive: settingsForm.check_inactive,
      failure_threshold: toPositiveInt(settingsForm.failure_threshold, 2),
      recovery_threshold: toPositiveInt(settingsForm.recovery_threshold, 1)
    }),
    onSuccess: () => {
      refreshAdminData();
      toast.success('DNS check settings saved');
    },
    onError: (error) => toast.error(error.message)
  });

  const runDomainCheck = useMutation({
    mutationFn: () => postJSON<{ run: DomainCheckRun; reused: boolean }>('/api/admin/domain-check-runs', {}),
    onSuccess: (result) => {
      refreshAdminData();
      toast.success(result.reused ? 'DNS check is already running' : 'DNS check started');
    },
    onError: (error) => toast.error(error.message)
  });

  const recheckDomain = useMutation({
    mutationFn: (domain: string) => postJSON('/api/domains/check-mx', { domain }),
    onSuccess: () => {
      refreshAdminData();
      queryClient.invalidateQueries({ queryKey: ['domains-all'] });
      toast.success('域名检测已刷新');
    },
    onError: (error) => toast.error(error.message)
  });

  const disableDomain = useMutation({
    mutationFn: (domain: AdminDomainHealth) => patchJSON(`/api/domains/${domain.id}`, { active: false }),
    onSuccess: () => {
      refreshAdminData();
      queryClient.invalidateQueries({ queryKey: ['domains-all'] });
      toast.success('域名已停用');
    },
    onError: (error) => toast.error(error.message)
  });

  const makePrivate = useMutation({
    mutationFn: (domain: AdminDomainHealth) => patchJSON(`/api/domains/${domain.id}`, { mode: 'private' }),
    onSuccess: () => {
      refreshAdminData();
      queryClient.invalidateQueries({ queryKey: ['domains-all'] });
      toast.success('域名已转为私有');
    },
    onError: (error) => toast.error(error.message)
  });

  const healthRows = (domainHealth.data || []).slice(0, 10);
  const riskItems = configRisks(stats.data);
  const runRows = (domainCheckRuns.data || domainCheckSettings.data?.recent_runs || []).slice(0, 10);
  const lastRun = domainCheckSettings.data?.last_run;
  const isLoading = stats.isLoading || domainHealth.isLoading || quotaAlerts.isLoading || auditLogs.isLoading || domainCheckSettings.isLoading || domainCheckRuns.isLoading;

  return (
    <div className="admin-page grid gap-4">
      <div className="admin-page-header">
        <div>
          <h1>{text.admin.title}</h1>
          <p>{text.admin.desc}</p>
        </div>
        <button className="btn-secondary" onClick={refreshAdminData} disabled={isLoading}>
          <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
          刷新
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Metric icon={Inbox} label={text.dashboard.messagesTotal} value={stats.data?.messages ?? 0} loading={stats.isLoading} />
        <Metric icon={Globe2} label={text.admin.enabledDomains} value={stats.data?.active_domains ?? 0} loading={stats.isLoading} />
        <Metric icon={Users} label="用户" value={stats.data?.users ?? 0} loading={stats.isLoading} />
        <Metric icon={KeyRound} label={text.dashboard.apiCalls} value={stats.data?.api_usage_today ?? 0} loading={stats.isLoading} />
      </div>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>系统状态</h2>
            <p>把配置风险和运行状态放在最前面，方便上线前扫一遍</p>
          </div>
        </div>
        <div className="admin-status-grid">
          <StatusPill ok={!stats.isError} loading={stats.isLoading}>Admin API</StatusPill>
          <StatusPill ok={!stats.data?.failed_domains} loading={stats.isLoading}>Domain Health</StatusPill>
          <StatusPill ok={!stats.isLoading} loading={stats.isLoading}>Cleanup</StatusPill>
          <StatusPill ok={!stats.data?.admin_token_is_default} loading={stats.isLoading}>Admin Token</StatusPill>
        </div>
        <div className="admin-risk-list">
          {riskItems.length ? riskItems.map((item) => (
            <div className={`admin-risk admin-risk-${item.level}`} key={item.title}>
              <ShieldAlert size={16} />
              <span>
                <b>{item.title}</b>
                <small>{item.desc}</small>
              </span>
            </div>
          )) : (
            <div className="admin-risk admin-risk-ok">
              <Database size={16} />
              <span>
                <b>暂无明显配置风险</b>
                <small>MX 目标：{stats.data?.expected_mx || '-'}</small>
              </span>
            </div>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header admin-panel-header">
          <div>
            <h2>DNS 自动检测</h2>
            <p>
              {lastRun ? `${domainCheckStatusLabel(lastRun.status)} · ${lastRun.checked}/${lastRun.total}` : 'No runs yet'}
              {domainCheckSettings.data?.next_run_at ? ` · next ${relativeTime(domainCheckSettings.data.next_run_at)}` : ''}
            </p>
          </div>
          <div className="table-actions">
            <button className="btn-secondary" onClick={() => saveDomainCheckSettings.mutate()} disabled={saveDomainCheckSettings.isPending}>
              <Save size={15} />
              保存
            </button>
            <button className="btn-secondary" onClick={() => runDomainCheck.mutate()} disabled={runDomainCheck.isPending || lastRun?.status === 'running'}>
              <Play size={15} />
              立即检测
            </button>
          </div>
        </div>
        <div className="admin-dns-settings">
          <label className="admin-toggle">
            <input
              type="checkbox"
              checked={settingsForm.enabled}
              onChange={(event) => setSettingsForm((current) => ({ ...current, enabled: event.target.checked }))}
            />
            <span>启用</span>
          </label>
          <label className="admin-toggle">
            <input
              type="checkbox"
              checked={settingsForm.check_inactive}
              onChange={(event) => setSettingsForm((current) => ({ ...current, check_inactive: event.target.checked }))}
            />
            <span>检测停用域名</span>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-[var(--muted)]">间隔(分钟)</span>
            <input className="input" type="number" min="1" value={settingsForm.interval_minutes} onChange={(event) => setSettingsForm((current) => ({ ...current, interval_minutes: event.target.value }))} />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-[var(--muted)]">超时(ms)</span>
            <input className="input" type="number" min="500" value={settingsForm.timeout_ms} onChange={(event) => setSettingsForm((current) => ({ ...current, timeout_ms: event.target.value }))} />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-[var(--muted)]">并发数</span>
            <input className="input" type="number" min="1" value={settingsForm.max_concurrency} onChange={(event) => setSettingsForm((current) => ({ ...current, max_concurrency: event.target.value }))} />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-[var(--muted)]">失败阈值</span>
            <input className="input" type="number" min="1" value={settingsForm.failure_threshold} onChange={(event) => setSettingsForm((current) => ({ ...current, failure_threshold: event.target.value }))} />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-[var(--muted)]">恢复阈值</span>
            <input className="input" type="number" min="1" value={settingsForm.recovery_threshold} onChange={(event) => setSettingsForm((current) => ({ ...current, recovery_threshold: event.target.value }))} />
          </label>
          <label className="grid gap-1 text-sm admin-resolver-field">
            <span className="text-[var(--muted)]">Resolvers</span>
            <textarea className="input" rows={4} value={settingsForm.resolvers} onChange={(event) => setSettingsForm((current) => ({ ...current, resolvers: event.target.value }))} />
          </label>
        </div>
        <DataTable
          emptyLabel="暂无检测批次"
          columns={[
            { key: 'started-at', header: '时间' },
            { key: 'trigger', header: '触发' },
            { key: 'status', header: '状态' },
            { key: 'progress', header: '进度' },
            { key: 'passed', header: '成功' },
            { key: 'failed', header: '失败' },
            { key: 'duration', header: '耗时' }
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

      <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
        <section className="panel">
          <div className="panel-header admin-panel-header">
            <div>
              <h2>域名健康队列</h2>
              <p>{stats.data?.failed_domains ?? 0} 个 MX 异常，{stats.data?.stale_domains ?? 0} 个超过 24 小时未检测</p>
            </div>
            <button className="btn-ghost" onClick={() => setPage('domain-management')}>去域名页</button>
          </div>
          <DataTable
            emptyLabel="暂无域名风险"
            columns={[
              { key: 'domain', header: '域名' },
              { key: 'status', header: '状态' },
              { key: 'mode', header: '模式' },
              { key: 'expires', header: '到期' },
              { key: 'messages', header: '邮件' },
              { key: 'actions', header: '操作' }
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
                  <button className="btn-ghost" onClick={() => recheckDomain.mutate(domain.domain)} disabled={recheckDomain.isPending}>
                    <RefreshCw size={14} />
                    检测
                  </button>
                  <button className="btn-ghost" onClick={() => makePrivate.mutate(domain)} disabled={domain.mode === 'private' || makePrivate.isPending}>
                    私有
                  </button>
                  <button className="btn-ghost" onClick={() => disableDomain.mutate(domain)} disabled={!domain.active || disableDomain.isPending}>
                    停用
                  </button>
                </div>
              ]
            }))}
          />
        </section>

        <section className="panel">
          <div className="panel-header admin-panel-header">
            <div>
              <h2>额度预警</h2>
              <p>用户与 API Key 接近上限时会出现在这里</p>
            </div>
            <button className="btn-ghost" onClick={() => setPage('users')}>去用户页</button>
          </div>
          <DataTable
            emptyLabel="暂无额度预警"
            columns={[
              { key: 'target', header: '对象' },
              { key: 'severity', header: '级别' },
              { key: 'usage', header: '用量' },
              { key: 'last-used', header: '最近' }
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

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>最近审计日志</h2>
            <p>记录管理动作、域名变更、API Key 和邮箱操作</p>
          </div>
          <ClipboardList size={18} className="text-[var(--muted)]" />
        </div>
        <DataTable
          emptyLabel="暂无审计日志"
          columns={[
            { key: 'created-at', header: '时间' },
            { key: 'action', header: '动作' },
            { key: 'actor', header: '操作者' },
            { key: 'target', header: '目标' },
            { key: 'metadata', header: '备注' }
          ]}
          rows={(auditLogs.data || []).map((log) => ({
            key: log.id,
            cells: [
              relativeTime(log.created_at),
              <code className="admin-code">{log.action}</code>,
              log.actor || '-',
              <span className="admin-log-target">{log.target || '-'}</span>,
              log.metadata || '-'
            ]
          }))}
        />
      </section>
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
  const labels: Record<string, string> = {
    running: '运行中',
    success: '完成',
    failed: '失败',
    canceled: '已取消'
  };
  return labels[status] || status;
}

function domainCheckDuration(run: DomainCheckRun) {
  if (!run.finished_at) return run.status === 'running' ? '运行中' : '-';
  const started = new Date(run.started_at).getTime();
  const finished = new Date(run.finished_at).getTime();
  if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started) return '-';
  return `${Math.round((finished - started) / 1000)}s`;
}

function domainIssueLabel(issue: string) {
  const labels: Record<string, string> = {
    healthy: '正常',
    inactive: '已停用',
    mx_failed: 'MX 异常',
    domain_expired: '已过期',
    domain_expiring: '即将到期',
    never_checked: '未检测',
    stale_check: '检测过期'
  };
  return labels[issue] || issue;
}

function quotaReasonLabel(reason: string) {
  const labels: Record<string, string> = {
    daily_exceeded: '日额度已满',
    daily_warning: '日额度接近',
    total_exceeded: '总额度已满',
    total_warning: '总额度接近'
  };
  return labels[reason] || reason;
}

function quotaSummary(alert: AdminQuotaAlert) {
  const daily = alert.daily_limit > 0 ? `${alert.used_today}/${alert.daily_limit}` : '日不限';
  const total = alert.total_limit > 0 ? `${alert.total_used}/${alert.total_limit}` : '总不限';
  return `${daily} · ${total}`;
}

function configRisks(stats?: AdminStats) {
  if (!stats) return [];
  const risks: { level: 'warning' | 'critical' | 'ok'; title: string; desc: string }[] = [];
  if (stats.dev_mode) {
    risks.push({ level: 'warning', title: '开发模式开启', desc: '生产环境建议关闭 DEV_MODE，避免测试域名被自动验证。' });
  }
  if (stats.admin_token_is_default) {
    risks.push({ level: 'critical', title: 'Admin Token 使用默认值', desc: '请替换 dev-admin-token，或清空 ADMIN_TOKEN 只保留登录态管理。' });
  } else if (stats.admin_token_enabled) {
    risks.push({ level: 'warning', title: 'Admin Token 已启用', desc: '确认该 token 只在可信服务端使用，不要暴露给浏览器或第三方脚本。' });
  }
  if ((stats.failed_domains || 0) > 0) {
    risks.push({ level: 'warning', title: '存在 MX 异常域名', desc: '处理健康队列中的异常域名，避免继续对外提供不可收信的域。' });
  }
  return risks;
}
