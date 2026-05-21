import { useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { APIKey, User } from '../api';
import { api, patchJSON, postJSON } from '../api';
import { useText } from '../locales';
import { copy } from '../lib/clipboard';
import { notifySuccess, runDeleteEffect } from '../lib/feedback';
import { formatAPIKeyExpiry, relativeTime } from '../lib/display';
import { ConfirmModal, DataTable, IconButton, QuotaThermometer } from '../components/shared';
import { CreateAPIKeyDialog } from './CreateAPIKeyDialog';

export function APIKeysPage({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const text = useText();
  const [createOpen, setCreateOpen] = useState(false);
  const [copyingKeyId, setCopyingKeyId] = useState<number | null>(null);
  const [deleteTargets, setDeleteTargets] = useState<APIKey[]>([]);
  const [dissolveTarget, setDissolveTarget] = useState<HTMLElement | null>(null);
  const [selectedKeyIds, setSelectedKeyIds] = useState<number[]>([]);
  const createTriggerRef = useRef<HTMLButtonElement | null>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const feedbackOriginRef = useRef<HTMLElement | null>(null);
  const keys = useQuery({ queryKey: ['api-keys'], queryFn: () => api<APIKey[]>('/api/api-keys'), retry: false, staleTime: 30_000 });
  const keyList = keys.data || [];
  const selectedKeys = keyList.filter((key) => selectedKeyIds.includes(key.id));
  const selectedCount = selectedKeys.length;
  const allKeysSelected = keyList.length > 0 && selectedCount === keyList.length;
  const someKeysSelected = selectedCount > 0 && !allKeysSelected;

  useEffect(() => {
    if (!keys.data) return;
    const existingIds = new Set(keys.data.map((key) => key.id));
    setSelectedKeyIds((current) => current.filter((id) => existingIds.has(id)));
  }, [keys.data]);

  const toggleKey = useMutation({
    mutationFn: (key: APIKey) => patchJSON(`/api/api-keys/${key.id}`, { enabled: !key.enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      notifySuccess(text.toast.apiKeyUpdated, { origin: feedbackOriginRef.current });
      feedbackOriginRef.current = null;
    },
    onError: (error) => {
      feedbackOriginRef.current = null;
      toast.error(error.message);
    }
  });
  const deleteKeys = useMutation({
    mutationFn: async (targets: APIKey[]) => {
      const results = await Promise.allSettled(targets.map((key) => api(`/api/api-keys/${key.id}`, { method: 'DELETE' })));
      const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (failed) {
        throw failed.reason instanceof Error ? failed.reason : new Error(String(failed.reason));
      }
      return targets;
    },
    onError: (error) => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      toast.error(error.message);
    }
  });

  const handleCopyKey = async (key: APIKey, event: MouseEvent<Element>) => {
    setCopyingKeyId(key.id);
    try {
      const data = await postJSON<{ plain_key: string }>(`/api/api-keys/${key.id}/reveal`, {});
      await copy(data.plain_key, { celebrate: true, event, label: text.apiKeys.copiedSecret, toastMessage: text.apiKeys.copiedSecret });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text.apiKeys.copyUnavailable);
    } finally {
      setCopyingKeyId(null);
    }
  };

  const toggleSelectedKey = (id: number) => {
    setSelectedKeyIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const toggleSelectAllKeys = () => {
    setSelectedKeyIds(allKeysSelected ? [] : keyList.map((key) => key.id));
  };

  const animateDeletedKeys = async (targets: APIKey[], targetEl: HTMLElement | null) => {
    await new Promise(r => requestAnimationFrame(r));
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

  const deleteConfirmText = deleteTargets.length > 1
    ? text.apiKeys.deleteSelectedConfirm.replace('{count}', String(deleteTargets.length))
    : text.apiKeys.deleteConfirm;
  const deleteSummary = deleteTargets.length > 1
    ? text.apiKeys.deleteSelectedSummary.replace('{count}', String(deleteTargets.length))
    : deleteTargets[0]?.name;

  return (
    <div className="grid gap-4">
      <section className="panel api-key-panel">
        <div className="panel-header api-key-panel-header">
          <div>
            <h2>{text.apiKeys.title}</h2>
            <p>{keys.data?.length ?? 0} {text.apiKeys.count}</p>
          </div>
          <div className="api-key-header-actions">
            {selectedCount > 0 && (
              <button className="btn-danger" ref={deleteTriggerRef} onClick={() => { setDissolveTarget(null); setDeleteTargets(selectedKeys); }} disabled={deleteKeys.isPending}>
                <Trash2 size={16} />
                {text.apiKeys.deleteSelected} ({selectedCount})
              </button>
            )}
            <button className="btn-primary" ref={createTriggerRef} onClick={() => setCreateOpen(true)}>
              <KeyRound size={16} />
              {text.apiKeys.createButton}
            </button>
          </div>
        </div>
        <p className="api-key-helper">{user.role === 'admin' ? text.apiKeys.adminDesc : text.apiKeys.userDesc}</p>
        <DataTable
          ariaLabel={text.apiKeys.title}
          columns={[
            {
              key: 'select',
              align: 'center',
              width: '5.5rem',
              header: (
                <label className="table-select">
                  <input
                    type="checkbox"
                    checked={allKeysSelected}
                    disabled={keyList.length === 0 || deleteKeys.isPending}
                    ref={(node) => {
                      if (node) node.indeterminate = someKeysSelected;
                    }}
                    onChange={toggleSelectAllKeys}
                    aria-label={text.apiKeys.selectAll}
                  />
                  <span className="sr-only">{text.apiKeys.selectAll}</span>
                  <span style={{ fontSize: '0.68rem', marginLeft: '0.25rem' }}>{text.apiKeys.selectAll}</span>
                </label>
              )
            },
            { key: 'name', header: text.apiKeys.name, minWidth: '9rem' },
            { key: 'key', header: text.apiKeys.key, minWidth: '13rem' },
            { key: 'enabled', header: text.apiKeys.enabled, align: 'center', width: '6rem' },
            { key: 'today', header: text.apiKeys.today, align: 'center', width: '8rem' },
            { key: 'total', header: text.apiKeys.total, align: 'center', width: '8rem' },
            { key: 'expires', header: text.apiKeys.expires, width: '8rem' },
            { key: 'last-used', header: text.apiKeys.lastUsed, width: '8rem' },
            { key: 'actions', header: text.apiKeys.actions, align: 'right', width: '5rem' }
          ]}
          emptyLabel={keys.isLoading ? text.common.loading : text.apiKeys.empty}
          rows={keyList.map((key) => {
            const maskedKey = maskAPIKey(key.key_prefix);
            return {
              key: key.id,
              selected: selectedKeyIds.includes(key.id),
              cells: [
                <label className="table-select">
                  <input
                    type="checkbox"
                    checked={selectedKeyIds.includes(key.id)}
                    disabled={deleteKeys.isPending}
                    onChange={() => toggleSelectedKey(key.id)}
                    aria-label={`${text.apiKeys.selectKey} ${key.name}`}
                  />
                </label>,
                key.name,
                <button
                  onClick={(event) => { event.preventDefault(); handleCopyKey(key, event); }}
                  disabled={copyingKeyId === key.id}
                  className={`key-copy ${copyingKeyId === key.id ? 'key-copy-loading' : ''}`}
                >
                  <span className="key-copy-mask">{maskedKey}</span>
                  {copyingKeyId === key.id ? <Loader2 size={13} className="animate-spin" /> : <Copy size={13} />}
                </button>,
                <button className={`toggle-switch toggle-switch-sm ${key.enabled ? 'on' : ''}`} onClick={(event) => {
                  feedbackOriginRef.current = event.currentTarget;
                  toggleKey.mutate(key);
                }} disabled={toggleKey.isPending} role="switch" aria-checked={key.enabled} aria-label={key.enabled ? text.common.enabled : text.common.disabled}>
                  <span className="toggle-switch-knob" />
                </button>,
                <QuotaThermometer used={key.used_today} limit={key.daily_limit} />,
                <QuotaThermometer used={key.total_used} limit={key.total_limit} />,
                formatAPIKeyExpiry(key.expires_at),
                key.last_used_at ? relativeTime(key.last_used_at) : '-',
                <div className="table-actions" data-key-id={key.id}>
                  <IconButton title={`${text.apiKeys.deleteKey}: ${key.name}`} aria-label={`${text.apiKeys.deleteKey} ${key.name}`} onClick={() => {
                    const row = document.querySelector(`[data-key-id="${key.id}"]`)?.closest('tr') as HTMLElement | null;
                    setDissolveTarget(row);
                    setDeleteTargets([key]);
                  }} disabled={deleteKeys.isPending}>
                    <Trash2 size={14} />
                  </IconButton>
                </div>
              ]
            };
          })}
        />
      </section>
      {createOpen && (
        <CreateAPIKeyDialog
          open={createOpen}
          onClose={() => {
            setCreateOpen(false);
            createTriggerRef.current?.focus();
          }}
        />
      )}
      <ConfirmModal
        open={deleteTargets.length > 0}
        title={deleteTargets.length > 1 ? text.apiKeys.deleteSelectedTitle : text.apiKeys.deleteKey}
        description={`${deleteConfirmText}\n\n${deleteSummary}`}
        danger
        confirmText={text.common.delete}
        cancelText={text.common.cancel}
        onConfirm={async () => {
          const targets = deleteTargets;
          const targetEl = dissolveTarget;
          setDeleteTargets([]);
          setDissolveTarget(null);
          try {
            await deleteKeys.mutateAsync(targets);
            const deletedIds = new Set(targets.map((key) => key.id));
            setSelectedKeyIds((current) => current.filter((id) => !deletedIds.has(id)));
            await animateDeletedKeys(targets, targetEl);
            queryClient.invalidateQueries({ queryKey: ['api-keys'] });
            notifySuccess(text.toast.apiKeyDeleted, { burst: false });
          } catch {
            // Error toast and cache refresh are handled by the mutation.
          }
        }}
        onCancel={() => {
          setDeleteTargets([]);
          setDissolveTarget(null);
          deleteTriggerRef.current?.focus();
        }}
      />
    </div>
  );
}

function maskAPIKey(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const prefix = 'key-hloolmail-';
  if (trimmed.startsWith(prefix) && trimmed.length > prefix.length + 6) {
    return `${prefix}${trimmed.slice(prefix.length, prefix.length + 2)}${'*'.repeat(8)}${trimmed.slice(-2)}`;
  }
  const visible = Math.min(3, Math.floor(trimmed.length / 5));
  const suffix = Math.min(2, Math.floor(trimmed.length / 6));
  const maskedLen = trimmed.length - visible - suffix;
  const starCount = maskedLen > 0 ? Math.max(8, maskedLen) : 8;
  return `${trimmed.slice(0, visible)}${'*'.repeat(starCount)}${suffix > 0 ? trimmed.slice(-suffix) : ''}`;
}
