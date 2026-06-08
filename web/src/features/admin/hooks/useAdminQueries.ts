import { useMutation, useQuery } from '@tanstack/react-query';
import type { UseMutationOptions } from '@tanstack/react-query';
import type {
  AdminDomainHealth,
  APIInterfaceSettings,
  DomainCheckRun,
  DomainCheckSettings
} from '../../../types';
import { queryKeys } from '../../../lib/queryKeys';
import {
  deleteAdminDomain,
  fetchAdminDomainHealth,
  fetchAdminQuotaAlerts,
  fetchAdminStats,
  fetchAdminTimeseries,
  fetchAPIInterfaceSettings,
  fetchDomainCheckRuns,
  fetchDomainCheckSettings,
  recheckDomain,
  runDomainCheck,
  saveAPIInterfaceSettings,
  saveDomainCheckSettings,
  updateDomainMode,
  type AdminTimeseriesRangeValue,
  type DomainCheckSettingsPayload,
  type DomainHealthFilters
} from '../services/adminService';

type MutationOptions<TData, TVariables> = UseMutationOptions<TData, Error, TVariables>;

export function useAdminStatsQuery() {
  return useQuery({
    queryKey: queryKeys.admin.stats,
    queryFn: fetchAdminStats,
    retry: false,
    staleTime: 30_000
  });
}

export function useAdminTimeseriesQuery(range: AdminTimeseriesRangeValue) {
  return useQuery({
    queryKey: queryKeys.admin.timeseries(range),
    queryFn: () => fetchAdminTimeseries(range),
    retry: false,
    staleTime: 30_000
  });
}

export function useAdminDomainHealthQuery(filters: DomainHealthFilters, search: string, page: number, perPage: number) {
  return useQuery({
    queryKey: queryKeys.admin.domainHealth(page, perPage, search, filters),
    queryFn: () => fetchAdminDomainHealth(filters, search, page, perPage),
    retry: false,
    staleTime: 30_000
  });
}

export function useAdminQuotaAlertsQuery(page: number, perPage: number) {
  return useQuery({
    queryKey: queryKeys.admin.quotaAlerts(page, perPage),
    queryFn: () => fetchAdminQuotaAlerts(page, perPage),
    retry: false,
    staleTime: 30_000
  });
}

export function useDomainCheckSettingsQuery() {
  return useQuery({
    queryKey: queryKeys.admin.domainCheckSettings,
    queryFn: fetchDomainCheckSettings,
    retry: false,
    staleTime: 30_000,
    refetchInterval: (query) => query.state.data?.last_run?.status === 'running' ? 5000 : false
  });
}

export function useDomainCheckRunsQuery(page: number, perPage: number) {
  return useQuery({
    queryKey: queryKeys.admin.domainCheckRuns(page, perPage),
    queryFn: () => fetchDomainCheckRuns(page, perPage),
    retry: false,
    staleTime: 30_000,
    refetchInterval: (query) => query.state.data?.runs?.some((run: DomainCheckRun) => run.status === 'running') ? 5000 : false
  });
}

export function useSaveDomainCheckSettingsMutation(options?: MutationOptions<DomainCheckSettings, DomainCheckSettingsPayload>) {
  return useMutation({
    mutationFn: saveDomainCheckSettings,
    ...options
  });
}

export function useRunDomainCheckMutation(options?: MutationOptions<{ run: DomainCheckRun; reused: boolean }, void>) {
  return useMutation({
    mutationFn: runDomainCheck,
    ...options
  });
}

export function useAPIInterfaceSettingsQuery() {
  return useQuery({
    queryKey: queryKeys.admin.apiInterfaceSettings,
    queryFn: fetchAPIInterfaceSettings,
    retry: false,
    staleTime: 30_000
  });
}

export function useSaveAPIInterfaceSettingsMutation(options?: MutationOptions<APIInterfaceSettings, Pick<APIInterfaceSettings, 'yyds_compatibility_enabled'>>) {
  return useMutation({
    mutationFn: saveAPIInterfaceSettings,
    ...options
  });
}

export function useRecheckDomainMutation(options?: MutationOptions<unknown, AdminDomainHealth>) {
  return useMutation({
    mutationFn: recheckDomain,
    ...options
  });
}

export function useUpdateDomainModeMutation(options?: MutationOptions<unknown, { domain: AdminDomainHealth; mode: AdminDomainHealth['mode'] }>) {
  return useMutation({
    mutationFn: ({ domain, mode }) => updateDomainMode(domain, mode),
    ...options
  });
}

export function useDeleteAdminDomainMutation(options?: MutationOptions<void, AdminDomainHealth>) {
  return useMutation({
    mutationFn: deleteAdminDomain,
    ...options
  });
}
