import type { QueryClient } from '@tanstack/react-query';

import type { Domain } from '../api';
import { currentText } from '../locales';
import { queryKeys } from '../lib/queryKeys';

export function invalidateDomainQueries(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: queryKeys.domains.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.domains.available });
  queryClient.invalidateQueries({ queryKey: queryKeys.userOnboarding });
  queryClient.invalidateQueries({ queryKey: queryKeys.admin.domainHealthRoot });
}

export function pendingDeleteAt(domain: Domain) {
  return domain.pending_delete_at;
}

export function formatRelativeTime(value?: string, pastLabel = ''): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const diff = date.getTime() - Date.now();
  if (diff <= 0) return pastLabel;
  const t = currentText();
  const minutes = Math.ceil(diff / 60000);
  if (minutes < 60) return t.domains.minutesLater.replace('{minutes}', String(minutes));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest
    ? t.domains.hoursMinLater.replace('{hours}', String(hours)).replace('{rest}', String(rest))
    : t.domains.hoursLater.replace('{hours}', String(hours));
}

export function isCheckReady(result: { mx_verified?: boolean; wildcard_enabled?: boolean; wildcard_checked?: boolean } | null | undefined) {
  return Boolean(result?.mx_verified || result?.wildcard_enabled);
}
