import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { APIKey, User } from '../api';
import { api, patchJSON, postJSON } from '../api';
import { useText } from '../locales';
import { copy } from '../lib/clipboard';
import { dissolveElement } from '../lib/dissolve';
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
      toast.success(text.toast.apiKeyUpdated);
    },
    onError: (error) => toast.error(error.message)
  });
  const deleteKeys = useMutation({
    mutationFn: (targets: APIKey[]) =>
      Promise.all(targets.map((key) => api(`/api/api-keys/${key.id}`, { method: 'DELETE' }))).then(() => undefined),
    onSuccess: () => {
      setDeleteTargets([]);
      setSelectedKeyIds([]);
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      toast.success(text.toast.apiKeyDeleted);
    },
    onError: (error) => toast.error(error.message)
  });

  const handleCopyKey = async (key: APIKey) => {
    setCopyingKeyId(key.id);
    try {
      const data = await postJSON<{ plain_key: string }>(`/api/api-keys/${key.id}/reveal`, {});
      await copy(data.plain_key, { celebrate: true, label: text.apiKeys.copiedSecret, toastMessage: text.apiKeys.copiedSecret });
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
          columns={[
            {
              key: 'select',
              header: (
                <label className="table-select" title={text.apiKeys.selectAll}>
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
            { key: 'name', header: text.apiKeys.name },
            { key: 'key', header: text.apiKeys.key },
            { key: 'enabled', header: text.apiKeys.enabled },
            { key: 'today', header: text.apiKeys.today },
            { key: 'total', header: text.apiKeys.total },
            { key: 'expires', header: text.apiKeys.expires },
            { key: 'last-used', header: text.apiKeys.lastUsed },
            { key: 'actions', header: text.apiKeys.actions }
          ]}
          emptyLabel={keys.isLoading ? text.common.loading : text.apiKeys.empty}
          rows={keyList.map((key) => {
            const maskedKey = maskAPIKey(key.key_prefix);
            return {
              key: key.id,
              cells: [
                <label className="table-select" title={text.apiKeys.selectKey}>
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
                  onClick={(event) => { event.preventDefault(); handleCopyKey(key); }}
                  disabled={copyingKeyId === key.id}
                  className={`key-copy ${copyingKeyId === key.id ? 'key-copy-loading' : ''}`}
                  title={text.apiKeys.copySecret}
                >
                  <span className="key-copy-mask">{maskedKey}</span>
                  {copyingKeyId === key.id ? <Loader2 size={13} className="animate-spin" /> : <Copy size={13} />}
                </button>,
                <button className={`key-switch ${key.enabled ? 'key-switch-on' : 'key-switch-off'}`} onClick={() => toggleKey.mutate(key)} disabled={toggleKey.isPending} role="switch" aria-checked={key.enabled}>
                  <span className="key-switch-knob" />
                  <span className="key-switch-label">{key.enabled ? text.common.enabled : text.common.disabled}</span>
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
          await new Promise(r => requestAnimationFrame(r));
          if (targets.length === 1 && targetEl) {
            await dissolveElement(targetEl, { duration: 400, blockSize: 4, direction: 'out' });
          } else if (targets.length > 1) {
            const rows = targets
              .map((key) => document.querySelector(`[data-key-id="${key.id}"]`)?.closest('tr') as HTMLElement | null)
              .filter(Boolean) as HTMLElement[];
            for (const row of rows) {
              await dissolveElement(row, { duration: 300, blockSize: 4, direction: 'up' });
            }
          }
          deleteKeys.mutate(targets);
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

