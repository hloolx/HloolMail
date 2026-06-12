import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError, clearPendingGetRequests } from '../api';
import { clearStoredRequestHistory } from '../hooks/useRequestHistory';
import { useAppStore } from '../store';
import type { MeResponse } from '../types';

const SESSION_EXPIRED_MESSAGE = 'Session expired. Please sign in again.';
const DEFAULT_ERROR_MESSAGE = 'Request failed. Please try again.';
const AUTH_PROBE_QUERY_KEY = ['me'] as const;
const USER_QUERY_ROOTS = new Set([
  'admin-announcements',
  'admin-api-interface-settings',
  'admin-audit-logs',
  'admin-domain-check-runs',
  'admin-domain-check-settings',
  'admin-domain-health',
  'admin-login-settings',
  'admin-oauth-providers',
  'admin-quota-alerts',
  'admin-quota-settings',
  'admin-share-link-access-logs',
  'admin-share-links',
  'admin-stats',
  'admin-stats-timeseries',
  'admin-webhook-deliveries',
  'admin-webhooks',
  'announcements',
  'announcements-unread-count',
  'api-keys',
  'domains-all',
  'domains-available',
  'email-detail',
  'emails',
  'mailbox-stats',
  'mailboxes',
  'me',
  'notifications',
  'notifications-dashboard',
  'notifications-unread-count',
  'share-link-access-logs',
  'share-links',
  'stats',
  'stats-timeseries',
  'user-onboarding',
  'user-oauth-identities',
  'user-passkeys',
  'users',
  'webhook-deliveries',
  'webhooks'
]);

let sessionExpiredNotified = false;

export function createAppQueryClient() {
  const queryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        handleQueryError(error, queryClient, query.queryKey);
      }
    }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        handleMutationError(error, queryClient, Boolean(mutation.options.onError));
      }
    }),
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
          return failureCount < 1;
        }
      },
      mutations: {
        retry: false
      }
    }
  });

  return queryClient;
}

function handleQueryError(error: unknown, queryClient: QueryClient, queryKey: readonly unknown[]) {
  if (handleAuthProbeUnauthorized(error, queryClient, queryKey)) return;
  if (handleAuthError(error, queryClient)) return;
}

function handleMutationError(error: unknown, queryClient: QueryClient, hasLocalHandler: boolean) {
  if (handleAuthError(error, queryClient)) return;
  if (hasLocalHandler) return;
  toast.error(readErrorMessage(error));
}

function handleAuthError(error: unknown, queryClient: QueryClient) {
  if (!(error instanceof ApiError) || error.status !== 401) return false;

  expireUserSession(queryClient);
  return true;
}

export function expireUserSession(queryClient: QueryClient) {
  clearPendingGetRequests();
  useAppStore.getState().logout();
  clearUserQueryCache(queryClient);
  clearStoredRequestHistory();
  notifySessionExpired();

  if (typeof window !== 'undefined' && !window.location.hash.startsWith('#/login')) {
    window.location.hash = '#/login';
  }
}

export function clearUserSession(queryClient: QueryClient) {
  clearPendingGetRequests();
  useAppStore.getState().logout();
  clearUserQueryCache(queryClient, { keepAuthProbe: true });
  setAnonymousAuthProbe(queryClient);
  clearStoredRequestHistory();
}

export function clearUserQueryCache(queryClient: QueryClient, options: { keepAuthProbe?: boolean } = {}) {
  queryClient.removeQueries({
    predicate: (query) => {
      if (options.keepAuthProbe && isAuthProbeQueryKey(query.queryKey)) return false;
      const [root] = query.queryKey;
      return typeof root === 'string' && USER_QUERY_ROOTS.has(root);
    }
  });
}

function notifySessionExpired() {
  if (sessionExpiredNotified) return;

  sessionExpiredNotified = true;
  toast.error(SESSION_EXPIRED_MESSAGE);
  window.setTimeout(() => {
    sessionExpiredNotified = false;
  }, 5000);
}

function handleAuthProbeUnauthorized(error: unknown, queryClient: QueryClient, queryKey: readonly unknown[]) {
  if (!(error instanceof ApiError) || error.status !== 401 || queryKey[0] !== 'me') return false;
  clearUserSession(queryClient);
  return true;
}

function setAnonymousAuthProbe(queryClient: QueryClient) {
  queryClient.setQueryData<MeResponse>(AUTH_PROBE_QUERY_KEY, { installed: true, user: null });
}

function isAuthProbeQueryKey(queryKey: readonly unknown[]) {
  return queryKey.length === AUTH_PROBE_QUERY_KEY.length && queryKey[0] === AUTH_PROBE_QUERY_KEY[0];
}

function readErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  return DEFAULT_ERROR_MESSAGE;
}
