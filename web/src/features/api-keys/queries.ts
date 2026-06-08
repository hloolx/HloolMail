import { useQuery } from '@tanstack/react-query';
import { api, patchJSON, postJSON } from '../../api';
import { queryKeys } from '../../lib/queryKeys';
import type { APIKey, CreateApiKeyPayload, CreateApiKeyResponse, MailboxStats, RevealApiKeyResponse } from './types';

export const apiKeysQueryKey = queryKeys.apiKeys.all;
export const apiKeyMailboxStatsQueryKey = queryKeys.apiKeys.mailboxStats;

export type DeleteApiKeysResult = {
  deleted: APIKey[];
  failed: Array<{
    key: APIKey;
    error: Error;
  }>;
};

export function useApiKeysQuery() {
  return useQuery({
    queryKey: apiKeysQueryKey,
    queryFn: fetchApiKeys,
    retry: false,
    staleTime: 30_000
  });
}

export function useApiKeyMailboxStatsQuery() {
  return useQuery({
    queryKey: apiKeyMailboxStatsQueryKey,
    queryFn: fetchApiKeyMailboxStats,
    retry: false,
    staleTime: 30_000
  });
}

export function fetchApiKeys() {
  return api<APIKey[]>('/api/api-keys');
}

export function fetchApiKeyMailboxStats() {
  return api<MailboxStats>('/api/mailboxes/stats');
}

export function createApiKey(payload: CreateApiKeyPayload) {
  return postJSON<CreateApiKeyResponse>('/api/api-keys', payload);
}

export function revealApiKey(id: APIKey['id']) {
  return postJSON<RevealApiKeyResponse>(`/api/api-keys/${id}/reveal`, {});
}

export function setApiKeyEnabled(key: APIKey, enabled: boolean) {
  return patchJSON(`/api/api-keys/${key.id}`, { enabled });
}

export async function deleteApiKeys(targets: APIKey[]): Promise<DeleteApiKeysResult> {
  const results = await Promise.allSettled(
    targets.map((key) => api(`/api/api-keys/${key.id}`, { method: 'DELETE' }))
  );
  const deleted: APIKey[] = [];
  const failed: DeleteApiKeysResult['failed'] = [];
  results.forEach((result, index) => {
    const key = targets[index];
    if (result.status === 'fulfilled') {
      deleted.push(key);
      return;
    }
    failed.push({
      key,
      error: result.reason instanceof Error ? result.reason : new Error(String(result.reason))
    });
  });
  if (deleted.length === 0 && failed.length > 0) {
    throw failed[0].error;
  }
  return { deleted, failed };
}
