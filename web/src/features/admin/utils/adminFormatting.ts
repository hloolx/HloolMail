import { currentText } from '../../../locales';
import type { AdminQuotaAlert, AdminStats, DomainCheckRun } from '../../../types';

export type ConfigRisk = { level: 'warning' | 'critical' | 'ok'; title: string; desc: string };

export function formatNumber(value: number) {
  return Math.max(0, Math.round(Number.isFinite(value) ? value : 0)).toLocaleString();
}

export function formatSignedNumber(value: number) {
  const safe = Math.round(Number.isFinite(value) ? value : 0);
  return `${safe >= 0 ? '+' : ''}${safe.toLocaleString()}`;
}

export function percentage(value: number, total: number) {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0 || value <= 0) return 0;
  return Math.max(2, Math.min(100, Math.round((value / total) * 100)));
}

export function queryErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function domainCheckStatusLabel(status: string) {
  const text = currentText();
  const labels: Record<string, string> = {
    running: text.admin.dnsCheck.statusRunning,
    success: text.admin.dnsCheck.statusSuccess,
    failed: text.admin.dnsCheck.statusFailed,
    canceled: text.admin.dnsCheck.statusCanceled
  };
  return labels[status] || status;
}

export function domainCheckTriggerLabel(trigger: string) {
  const text = currentText();
  const labels: Record<string, string> = {
    schedule: text.admin.dnsCheck.triggerSchedule,
    manual: text.admin.dnsCheck.triggerManual
  };
  return labels[trigger] || trigger;
}

export function domainCheckDuration(run: DomainCheckRun) {
  const text = currentText();
  if (!run.finished_at) return run.status === 'running' ? text.admin.dnsCheck.statusRunning : '-';
  const started = new Date(run.started_at).getTime();
  const finished = new Date(run.finished_at).getTime();
  if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started) return '-';
  return `${Math.round((finished - started) / 1000)}s`;
}

export function domainIssueLabel(issue: string) {
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

export function quotaReasonLabel(alert: AdminQuotaAlert) {
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

export function quotaSummary(alert: AdminQuotaAlert) {
  const text = currentText();
  const dailyValue = alert.daily_limit > 0 ? `${alert.used_today}/${alert.daily_limit}` : '';
  const daily = alert.kind === 'user'
    ? (dailyValue ? text.admin.quotaAlerts.publicDailyUsage.replace('{value}', dailyValue) : text.admin.quotaAlerts.publicDailyUnlimited)
    : (dailyValue ? text.admin.quotaAlerts.dailyUsage.replace('{value}', dailyValue) : text.admin.quotaAlerts.dailyUnlimited);
  const total = alert.total_limit > 0 ? `${alert.total_used}/${alert.total_limit}` : text.admin.quotaAlerts.totalUnlimited;
  return `${daily} / ${total}`;
}

export function configRisks(stats?: AdminStats) {
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

export function isDirtyFromBaseline(form: object, baseline: string) {
  return Boolean(baseline) && formFingerprint(form) !== baseline;
}

export function formFingerprint(form: object) {
  return JSON.stringify(form);
}

export function splitResolvers(value: string) {
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function toPositiveInt(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
