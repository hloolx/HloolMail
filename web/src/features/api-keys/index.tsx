import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { notifySuccess, runDeleteEffect } from '../../lib/feedback';
import { useText } from '../../locales';
import { Button, PageHeader, Panel } from '../../components/ui';
import { EmptyState } from '../../components/shared';
import { apiKeysQueryKey, deleteApiKeys, useApiKeyMailboxStatsQuery, useApiKeysQuery } from './queries';
import { buildApiKeyHelperMessages } from './quotaMessages';
import { ApiKeysTable } from './components/ApiKeysTable';
import { CreateApiKeyDialog } from './components/CreateApiKeyDialog';
import { DeleteApiKeysDialog } from './components/DeleteApiKeysDialog';
import type { APIKey, User } from './types';

export function ApiKeysFeature({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const text = useText();
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTargets, setDeleteTargets] = useState<APIKey[]>([]);
  const [dissolveTarget, setDissolveTarget] = useState<HTMLElement | null>(null);
  const [selectedKeyIds, setSelectedKeyIds] = useState<number[]>([]);
  const createTriggerRef = useRef<HTMLButtonElement | null>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const keys = useApiKeysQuery();
  const mailboxStats = useApiKeyMailboxStatsQuery();
  const keyList = keys.data || [];
  const selectedKeys = keyList.filter((key) => selectedKeyIds.includes(key.id));
  const selectedCount = selectedKeys.length;
  const helperMessages = buildApiKeyHelperMessages(text, user, mailboxStats.data);

  useEffect(() => {
    if (!keys.data) return;
    const existingIds = new Set(keys.data.map((key) => key.id));
    setSelectedKeyIds((current) => current.filter((id) => existingIds.has(id)));
  }, [keys.data]);

  const deleteKeys = useMutation({
    mutationFn: deleteApiKeys,
    onError: (error) => {
      queryClient.invalidateQueries({ queryKey: apiKeysQueryKey });
      toast.error(error.message);
    }
  });

  const animateDeletedKeys = async (targets: APIKey[], targetEl: HTMLElement | null) => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (targets.length === 1 && targetEl?.isConnected) {
      await runDeleteEffect(targetEl);
      return;
    }
    const rows = targets
      .map((key) => document.querySelector(`[data-key-id="${key.id}"]`)?.closest('tr') as HTMLElement | null)
      .filter((row): row is HTMLElement => Boolean(row?.isConnected));
    for (const row of rows) {
      await runDeleteEffect(row, { duration: 300, direction: 'up' });
    }
  };

  const requestDelete = (targets: APIKey[], targetEl: HTMLElement | null) => {
    setDissolveTarget(targetEl);
    setDeleteTargets(targets);
  };

  const cancelDelete = () => {
    setDeleteTargets([]);
    setDissolveTarget(null);
    deleteTriggerRef.current?.focus();
  };

  const confirmDelete = async () => {
    const targets = deleteTargets;
    const targetEl = dissolveTarget;
    setDeleteTargets([]);
    setDissolveTarget(null);
    try {
      const result = await deleteKeys.mutateAsync(targets);
      const deletedIds = new Set(result.deleted.map((key) => key.id));
      setSelectedKeyIds((current) => current.filter((id) => !deletedIds.has(id)));
      await animateDeletedKeys(result.deleted, targetEl);
      queryClient.invalidateQueries({ queryKey: apiKeysQueryKey });
      if (result.failed.length > 0) {
        toast.warning(
          text.apiKeys.deletePartial
            .replace('{deleted}', String(result.deleted.length))
            .replace('{failed}', String(result.failed.length))
            .replace('{total}', String(targets.length))
        );
      } else {
        notifySuccess(text.toast.apiKeyDeleted, { burst: false });
      }
    } catch {
      // Error toast and cache refresh are handled by the mutation.
    }
  };

  return (
    <div className="grid gap-4">
      <Panel className="api-key-panel">
        <PageHeader
          className="api-key-panel-header"
          title={text.apiKeys.title}
          description={`${keys.data?.length ?? 0} ${text.apiKeys.count}`}
          actions={
            <>
              {selectedCount > 0 && (
                <Button
                  variant="danger"
                  ref={deleteTriggerRef}
                  onClick={() => requestDelete(selectedKeys, null)}
                  disabled={deleteKeys.isPending}
                  leadingIcon={<Trash2 size={16} />}
                >
                  {text.apiKeys.deleteSelected} ({selectedCount})
                </Button>
              )}
              <Button
                variant="primary"
                ref={createTriggerRef}
                data-onboarding-target="create-api-key"
                onClick={() => setCreateOpen(true)}
                leadingIcon={<KeyRound size={16} />}
              >
                {text.apiKeys.createButton}
              </Button>
            </>
          }
        />
        <p className="api-key-helper">{helperMessages.join(' ')}</p>
        {keys.isError ? (
          <EmptyState label={keys.error.message} />
        ) : (
          <ApiKeysTable
            keys={keyList}
            isLoading={keys.isLoading}
            selectedKeyIds={selectedKeyIds}
            onSelectedKeyIdsChange={setSelectedKeyIds}
            deletePending={deleteKeys.isPending}
            deletingKeyIds={(deleteKeys.variables || []).map((key) => key.id)}
            onRequestDelete={requestDelete}
          />
        )}
      </Panel>
      {createOpen && (
        <CreateApiKeyDialog
          open={createOpen}
          mailboxStats={mailboxStats.data}
          onClose={() => {
            setCreateOpen(false);
            createTriggerRef.current?.focus();
          }}
        />
      )}
      <DeleteApiKeysDialog targets={deleteTargets} onCancel={cancelDelete} onConfirm={confirmDelete} />
    </div>
  );
}
