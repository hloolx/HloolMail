import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Loader2, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import type { APIKey, User } from '../api';
import { api, patchJSON, postJSON } from '../api';
import { currentText, useText } from '../locales';
import { copy } from '../lib/clipboard';
import { formatAPIKeyExpiry, relativeTime } from '../lib/display';
import { DataTable, IconButton } from '../components/shared';

export function APIKeysPage({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const text = useText();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [dailyLimit, setDailyLimit] = useState('');
  const [totalLimit, setTotalLimit] = useState('');
  const [dailyUnlimited, setDailyUnlimited] = useState(false);
  const [totalUnlimited, setTotalUnlimited] = useState(false);
  const [expiresNever, setExpiresNever] = useState(true);
  const [expiresAt, setExpiresAt] = useState('');
  const [plainKey, setPlainKey] = useState('');
  const [createdCopied, setCreatedCopied] = useState(false);
  const [copyingKeyId, setCopyingKeyId] = useState<number | null>(null);
  const [deleteTargets, setDeleteTargets] = useState<APIKey[]>([]);
  const [selectedKeyIds, setSelectedKeyIds] = useState<number[]>([]);
  const keys = useQuery({ queryKey: ['api-keys'], queryFn: () => api<APIKey[]>('/api/api-keys'), retry: false });
  const keyList = keys.data || [];
  const selectedKeys = keyList.filter((key) => selectedKeyIds.includes(key.id));
  const selectedCount = selectedKeys.length;
  const allKeysSelected = keyList.length > 0 && selectedCount === keyList.length;
  const someKeysSelected = selectedCount > 0 && !allKeysSelected;
  const hasDailyLimit = dailyUnlimited || dailyLimit.trim() !== '';
  const hasTotalLimit = totalUnlimited || totalLimit.trim() !== '';
  const hasExpiry = expiresNever || expiresAt.trim() !== '';
  const canCreate = name.trim() !== '' && hasDailyLimit && hasTotalLimit && hasExpiry;
  const closeCreateModal = () => {
    setCreateOpen(false);
    setPlainKey('');
    setCreatedCopied(false);
  };

  useEffect(() => {
    if (!createOpen && deleteTargets.length === 0) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeCreateModal();
        setDeleteTargets([]);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [createOpen, deleteTargets.length]);

  useEffect(() => {
    if (!keys.data) return;
    const existingIds = new Set(keys.data.map((key) => key.id));
    setSelectedKeyIds((current) => current.filter((id) => existingIds.has(id)));
  }, [keys.data]);

  const resetCreateForm = () => {
    setName('');
    setDailyLimit('');
    setTotalLimit('');
    setDailyUnlimited(false);
    setTotalUnlimited(false);
    setExpiresNever(true);
    setExpiresAt('');
  };

  const buildCreatePayload = () => {
    const trimmedName = name.trim();
    if (!trimmedName) throw new Error(text.apiKeys.nameRequired);

    const daily = dailyUnlimited ? 0 : Number(dailyLimit);
    const total = totalUnlimited ? 0 : Number(totalLimit);
    if (!dailyUnlimited && (!Number.isInteger(daily) || daily < 1)) throw new Error(text.apiKeys.dailyRequired);
    if (!totalUnlimited && (!Number.isInteger(total) || total < 1)) throw new Error(text.apiKeys.totalRequired);

    const payload: Record<string, unknown> = {
      name: trimmedName,
      daily_limit: daily,
      total_limit: total
    };
    if (!expiresNever) {
      const date = new Date(expiresAt);
      if (!expiresAt || Number.isNaN(date.getTime())) throw new Error(text.apiKeys.expiryRequired);
      payload.expires_at = date.toISOString();
    }
    return payload;
  };

  const createKey = useMutation({
    mutationFn: () => postJSON<{ api_key: APIKey; plain_key: string }>('/api/api-keys', buildCreatePayload()),
    onSuccess: (data) => {
      setPlainKey(data.plain_key);
      setCreatedCopied(false);
      queryClient.setQueryData<APIKey[]>(['api-keys'], (current) => {
        const existing = current || [];
        return [data.api_key, ...existing.filter((key) => key.id !== data.api_key.id)];
      });
      resetCreateForm();
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      void copy(data.plain_key, { celebrate: true, label: text.apiKeys.copiedSecret, toastMessage: text.apiKeys.copiedSecret })
        .then(setCreatedCopied);
    },
    onError: (error) => toast.error(error.message)
  });
  const toggleKey = useMutation({
    mutationFn: (key: APIKey) => patchJSON(`/api/api-keys/${key.id}`, { enabled: !key.enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      toast.success(text.toast.apiKeyUpdated);
    },
    onError: (error) => toast.error(error.message)
  });
  const deleteKeys = useMutation({
    mutationFn: async (targets: APIKey[]) => {
      for (const key of targets) {
        await api(`/api/api-keys/${key.id}`, { method: 'DELETE' });
      }
    },
    onSuccess: (_data, targets) => {
      setDeleteTargets([]);
      setSelectedKeyIds([]);
      if (targets.some((key) => key.key_prefix && plainKey.startsWith(key.key_prefix))) {
        setPlainKey('');
      }
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

  const submitCreate = (event: FormEvent) => {
    event.preventDefault();
    if (!canCreate || createKey.isPending) return;
    createKey.mutate();
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
              <button className="btn-danger" onClick={() => setDeleteTargets(selectedKeys)} disabled={deleteKeys.isPending}>
                <Trash2 size={16} />
                {text.apiKeys.deleteSelected} ({selectedCount})
              </button>
            )}
            <button className="btn-primary" onClick={() => { setPlainKey(''); setCreatedCopied(false); setCreateOpen(true); }}>
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
                <button className={`key-switch ${key.enabled ? 'key-switch-on' : 'key-switch-off'}`} onClick={() => toggleKey.mutate(key)} disabled={toggleKey.isPending} aria-pressed={key.enabled}>
                  <span className="key-switch-knob" />
                  <span className="key-switch-label">{key.enabled ? text.common.enabled : text.common.disabled}</span>
                </button>,
                <QuotaThermometer used={key.used_today} limit={key.daily_limit} />,
                <QuotaThermometer used={key.total_used} limit={key.total_limit} />,
                formatAPIKeyExpiry(key.expires_at),
                key.last_used_at ? relativeTime(key.last_used_at) : '-',
                <div className="table-actions">
                  <IconButton title={text.apiKeys.deleteKey} onClick={() => setDeleteTargets([key])} disabled={deleteKeys.isPending}>
                    <Trash2 size={14} />
                  </IconButton>
                </div>
              ]
            };
          })}
        />
      </section>
      {createOpen && createPortal((
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeCreateModal();
        }}>
          <section className="modal-panel api-key-modal" role="dialog" aria-modal="true" aria-labelledby="create-api-key-title">
            <div className="modal-header">
              <div>
                <h2 id="create-api-key-title">{text.apiKeys.createTitle}</h2>
                <p>{text.apiKeys.createDesc}</p>
              </div>
              <IconButton title={text.common.close} onClick={closeCreateModal}>
                <X size={16} />
              </IconButton>
            </div>
            <form className="api-key-form" onSubmit={submitCreate}>
              <label className="api-key-field">
                <span>{text.apiKeys.name}</span>
                <input className="input" value={name} placeholder={text.apiKeys.namePlaceholder} onChange={(event) => setName(event.target.value)} required />
              </label>
              <div className="api-key-limit-grid">
                <label className="api-key-field">
                  <span>{text.apiKeys.dailyLimit}</span>
                  <input className="input" type="number" min="1" step="1" value={dailyLimit} disabled={dailyUnlimited} onChange={(event) => setDailyLimit(event.target.value)} required={!dailyUnlimited} />
                </label>
                <label className="check-row">
                  <input type="checkbox" checked={dailyUnlimited} onChange={(event) => setDailyUnlimited(event.target.checked)} />
                  <span>{text.apiKeys.unlimited}</span>
                </label>
              </div>
              <div className="api-key-limit-grid">
                <label className="api-key-field">
                  <span>{text.apiKeys.totalLimit}</span>
                  <input className="input" type="number" min="1" step="1" value={totalLimit} disabled={totalUnlimited} onChange={(event) => setTotalLimit(event.target.value)} required={!totalUnlimited} />
                </label>
                <label className="check-row">
                  <input type="checkbox" checked={totalUnlimited} onChange={(event) => setTotalUnlimited(event.target.checked)} />
                  <span>{text.apiKeys.unlimited}</span>
                </label>
              </div>
              <div className="api-key-limit-grid">
                <label className="api-key-field">
                  <span>{text.apiKeys.expiresAt}</span>
                  <input className="input" type="datetime-local" value={expiresAt} disabled={expiresNever} onChange={(event) => setExpiresAt(event.target.value)} required={!expiresNever} />
                </label>
                <label className="check-row">
                  <input type="checkbox" checked={expiresNever} onChange={(event) => setExpiresNever(event.target.checked)} />
                  <span>{text.apiKeys.neverExpires}</span>
                </label>
              </div>
              <p className="api-key-quota-note">{text.apiKeys.quotaHint}</p>
              <button className="btn-primary" type="submit" disabled={!canCreate || createKey.isPending}>
                {createKey.isPending ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
                {text.common.create}
              </button>
            </form>
            {plainKey && (
              <div className="created-key-copy">
                <span>
                  <b>{createdCopied ? text.apiKeys.createdCopiedTitle : text.apiKeys.createdKeyTitle}</b>
                  <small>{text.apiKeys.createdKeyHint}</small>
                </span>
                <button className="btn-secondary" type="button" onClick={(event) => {
                  void copy(plainKey, { celebrate: true, event, label: text.apiKeys.copiedSecret, toastMessage: text.apiKeys.copiedSecret })
                    .then(setCreatedCopied);
                }}>
                  <Copy size={15} />
                  {text.common.copy}
                </button>
                <input
                  className="input created-key-value"
                  value={plainKey}
                  readOnly
                  autoComplete="off"
                  spellCheck={false}
                  aria-label={text.apiKeys.createdKeyTitle}
                  onFocus={(event) => event.currentTarget.select()}
                  onClick={(event) => event.currentTarget.select()}
                />
              </div>
            )}
          </section>
        </div>
      ), document.body)}
      {deleteTargets.length > 0 && createPortal((
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !deleteKeys.isPending) setDeleteTargets([]);
        }}>
          <section className="modal-panel confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-api-key-title" aria-describedby="delete-api-key-desc">
            <div className="confirm-modal-icon">
              <Trash2 size={18} />
            </div>
            <div className="confirm-modal-copy">
              <h2 id="delete-api-key-title">{deleteTargets.length > 1 ? text.apiKeys.deleteSelectedTitle : text.apiKeys.deleteKey}</h2>
              <p id="delete-api-key-desc">{deleteConfirmText}</p>
              <code>{deleteSummary}</code>
            </div>
            <div className="confirm-modal-actions">
              <button className="btn-secondary" type="button" onClick={() => setDeleteTargets([])} disabled={deleteKeys.isPending}>
                {text.common.cancel}
              </button>
              <button className="btn-danger" type="button" onClick={() => deleteKeys.mutate(deleteTargets)} disabled={deleteKeys.isPending}>
                {deleteKeys.isPending ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                {text.common.delete}
              </button>
            </div>
          </section>
        </div>
      ), document.body)}
    </div>
  );
}

function maskAPIKey(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const prefix = 'key-hloolmail-';
  if (trimmed.startsWith(prefix) && trimmed.length > prefix.length + 6) {
    return `${prefix}${trimmed.slice(prefix.length, prefix.length + 2)}${'*'.repeat(Math.max(8, trimmed.length - prefix.length - 4))}${trimmed.slice(-2)}`;
  }
  const visible = Math.min(3, Math.floor(trimmed.length / 5));
  const suffix = Math.min(2, Math.floor(trimmed.length / 6));
  const maskedLen = trimmed.length - visible - suffix;
  return `${trimmed.slice(0, visible)}${'*'.repeat(Math.max(6, maskedLen))}${suffix > 0 ? trimmed.slice(-suffix) : ''}`;
}

function QuotaThermometer({ used, limit }: { used: number; limit: number }) {
  const text = currentText();
  const unlimited = limit <= 0;
  if (unlimited) {
    return (
      <div className="quota-thermo quota-thermo-unlimited" title={text.apiKeys.unlimited}>
        <span className="quota-thermo-infinity">{text.apiKeys.unlimitedShort}</span>
      </div>
    );
  }

  const ratio = Math.min(1, Math.max(0, used / Math.max(limit, 1)));
  const label = `${used.toLocaleString()} / ${limit.toLocaleString()}`;

  return (
    <div className="quota-thermo" title={label}>
      <span className="quota-thermo-value">{label}</span>
      <span className="quota-thermo-track">
        <span style={{ width: `${Math.round(ratio * 100)}%` }} />
      </span>
    </div>
  );
}
