import { api, patchJSON, postJSON, type PaginatedResponse } from '../../../api';
import type {
  AdminDomainHealth,
  AdminQuotaAlert,
  AdminStats,
  APIInterfaceSettings,
  DomainCheckRun,
  DomainCheckRunsPage,
  DomainCheckSettings,
  TimeseriesStats
} from '../../../types';

export const DOMAIN_HEALTH_PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
export const DOMAIN_HEALTH_MODE_OPTIONS = ['all', 'public', 'private'] as const;
export const DOMAIN_HEALTH_STATUS_OPTIONS = ['all', 'active', 'inactive'] as const;
export const DOMAIN_HEALTH_MX_OPTIONS = ['all', 'verified', 'failed', 'wildcard_failed', 'unchecked', 'stale'] as const;
export const DOMAIN_HEALTH_SEVERITY_OPTIONS = ['all', 'critical', 'warning', 'ok'] as const;
export const ADMIN_TIMESERIES_RANGE_OPTIONS = [7, 30, 90] as const;

export type AdminTimeseriesRange = (typeof ADMIN_TIMESERIES_RANGE_OPTIONS)[number];
export type AdminTimeseriesRangeValue = `${AdminTimeseriesRange}`;

export type DomainHealthFilters = {
  mode: string;
  status: string;
  mx: string;
  severity: string;
};

export type DomainCheckSettingsPayload = {
  enabled: boolean;
  interval_minutes: number;
  timeout_ms: number;
  max_concurrency: number;
  resolvers: string[];
  check_inactive: boolean;
  failure_threshold: number;
  recovery_threshold: number;
};

export const DEFAULT_DOMAIN_HEALTH_FILTERS: DomainHealthFilters = {
  mode: 'all',
  status: 'all',
  mx: 'all',
  severity: 'all'
};

export function fetchAdminStats() {
  return api<AdminStats>('/api/admin/stats');
}

export function fetchAdminTimeseries(range: AdminTimeseriesRangeValue) {
  return api<TimeseriesStats>(`/api/admin/stats/timeseries?days=${range}`);
}

export function fetchAdminDomainHealth(filters: DomainHealthFilters, search: string, page: number, perPage: number) {
  return api<PaginatedResponse<AdminDomainHealth>>(`/api/admin/domain-health?${buildDomainHealthQuery(filters, search, page, perPage)}`);
}

export function fetchAdminQuotaAlerts(page: number, perPage: number) {
  return api<PaginatedResponse<AdminQuotaAlert>>(`/api/admin/quota-alerts?page=${page}&per_page=${perPage}`);
}

export function fetchDomainCheckSettings() {
  return api<DomainCheckSettings>('/api/admin/domain-check-settings');
}

export function fetchDomainCheckRuns(page: number, perPage: number) {
  return api<DomainCheckRunsPage>(`/api/admin/domain-check-runs?page=${page}&per_page=${perPage}`);
}

export function saveDomainCheckSettings(payload: DomainCheckSettingsPayload) {
  return patchJSON<DomainCheckSettings>('/api/admin/domain-check-settings', payload);
}

export function runDomainCheck() {
  return postJSON<{ run: DomainCheckRun; reused: boolean }>('/api/admin/domain-check-runs', {});
}

export function fetchAPIInterfaceSettings() {
  return api<APIInterfaceSettings>('/api/admin/api-interface-settings');
}

export function saveAPIInterfaceSettings(payload: Pick<APIInterfaceSettings, 'yyds_compatibility_enabled'>) {
  return patchJSON<APIInterfaceSettings>('/api/admin/api-interface-settings', payload);
}

export function recheckDomain(domain: AdminDomainHealth) {
  return postJSON(`/api/admin/domains/${domain.id}/check-mx`, {});
}

export function updateDomainMode(domain: AdminDomainHealth, mode: AdminDomainHealth['mode']) {
  return patchJSON(`/api/admin/domains/${domain.id}`, { mode });
}

export async function deleteAdminDomain(domain: AdminDomainHealth) {
  await api(`/api/admin/domains/${domain.id}`, { method: 'DELETE' });
}

export function buildDomainHealthQuery(filters: DomainHealthFilters, search: string, page: number, perPage: number) {
  const params = new URLSearchParams({
    page: String(page),
    per_page: String(perPage)
  });
  if (search.trim()) params.set('q', search.trim());
  if (filters.mode !== 'all') params.set('mode', filters.mode);
  if (filters.status !== 'all') params.set('status', filters.status);
  if (filters.mx !== 'all') params.set('mx', filters.mx);
  if (filters.severity !== 'all') params.set('severity', filters.severity);
  return params.toString();
}
