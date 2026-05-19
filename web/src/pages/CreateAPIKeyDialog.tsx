import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import type { APIKey } from '../api';
import { postJSON } from '../api';
import { useText } from '../locales';
import { copy } from '../lib/clipboard';
import { IconButton } from '../components/shared';

export function CreateAPIKeyDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const text = useText();
  const queryClient = useQueryClient();

  const [closing, setClosing] = useState(false);
  const [name, setName] = useState('');
  const [dailyLimit, setDailyLimit] = useState('');
  const [totalLimit, setTotalLimit] = useState('');
  const [dailyUnlimited, setDailyUnlimited] = useState(false);
  const [totalUnlimited, setTotalUnlimited] = useState(false);
  const [expiresNever, setExpiresNever] = useState(true);
  const [expiresAt, setExpiresAt] = useState('');
  const [plainKey, setPlainKey] = useState('');
  const [createdCopied, setCreatedCopied] = useState(false);

  const hasDailyLimit = dailyUnlimited || dailyLimit.trim() !== '';
  const hasTotalLimit = totalUnlimited || totalLimit.trim() !== '';
  const hasExpiry = expiresNever || expiresAt.trim() !== '';
  const canCreate = name.trim() !== '' && hasDailyLimit && hasTotalLimit && hasExpiry;

  // Reset form state when dialog opens
  useEffect(() => {
    if (open) {
      setName('');
      setDailyLimit('');
      setTotalLimit('');
      setDailyUnlimited(false);
      setTotalUnlimited(false);
      setExpiresNever(true);
      setExpiresAt('');
      setPlainKey('');
      setCreatedCopied(false);
      setClosing(false);
    }
  }, [open]);

  // Escape key to close
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleClose = () => {
    setClosing(true);
    setTimeout(() => {
      onClose();
    }, 190);
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
      // Reset form for another key
      setName('');
      setDailyLimit('');
      setTotalLimit('');
      setDailyUnlimited(false);
      setTotalUnlimited(false);
      setExpiresNever(true);
      setExpiresAt('');
      queryClient.setQueryData<APIKey[]>(['api-keys'], (current) => {
        const existing = current || [];
        return [data.api_key, ...existing.filter((key) => key.id !== data.api_key.id)];
      });
      void copy(data.plain_key, { celebrate: true, label: text.apiKeys.copiedSecret, toastMessage: text.apiKeys.copiedSecret })
        .then(setCreatedCopied);
    },
    onError: (error) => toast.error(error.message)
  });

  const submitCreate = (event: FormEvent) => {
    event.preventDefault();
    if (!canCreate || createKey.isPending) return;
    createKey.mutate();
  };

  if (!open && !closing) return null;

  return createPortal(
    <div className={`modal-backdrop${closing ? ' modal-backdrop-closing' : ''}`} role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) handleClose();
    }}>
      <section className={`modal-panel${closing ? ' modal-panel-closing' : ''}`} role="dialog" aria-modal="true" aria-labelledby="create-api-key-title">
        <div className="modal-header">
          <div>
            <h2 id="create-api-key-title">{text.apiKeys.createTitle}</h2>
            <p>{text.apiKeys.createDesc}</p>
          </div>
          <IconButton title={text.common.close} onClick={handleClose}>
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
            <div className="segmented-control">
              <button type="button" className={`segment-choice ${!dailyUnlimited ? 'segment-choice-active' : ''}`} onClick={() => setDailyUnlimited(false)}>
                {text.apiKeys.limited}
              </button>
              <button type="button" className={`segment-choice ${dailyUnlimited ? 'segment-choice-active' : ''}`} onClick={() => setDailyUnlimited(true)}>
                {text.apiKeys.unlimited}
              </button>
            </div>
          </div>
          <div className="api-key-limit-grid">
            <label className="api-key-field">
              <span>{text.apiKeys.totalLimit}</span>
              <input className="input" type="number" min="1" step="1" value={totalLimit} disabled={totalUnlimited} onChange={(event) => setTotalLimit(event.target.value)} required={!totalUnlimited} />
            </label>
            <div className="segmented-control">
              <button type="button" className={`segment-choice ${!totalUnlimited ? 'segment-choice-active' : ''}`} onClick={() => setTotalUnlimited(false)}>
                {text.apiKeys.limited}
              </button>
              <button type="button" className={`segment-choice ${totalUnlimited ? 'segment-choice-active' : ''}`} onClick={() => setTotalUnlimited(true)}>
                {text.apiKeys.unlimited}
              </button>
            </div>
          </div>
          <div className="api-key-limit-grid">
            <label className="api-key-field">
              <span>{text.apiKeys.expiresAt}</span>
              <input className="input" type="datetime-local" value={expiresAt} disabled={expiresNever} onChange={(event) => setExpiresAt(event.target.value)} required={!expiresNever} />
            </label>
            <div className="segmented-control">
              <button type="button" className={`segment-choice ${!expiresNever ? 'segment-choice-active' : ''}`} onClick={() => { setExpiresNever(false); }}>
                {text.apiKeys.expires}
              </button>
              <button type="button" className={`segment-choice ${expiresNever ? 'segment-choice-active' : ''}`} onClick={() => { setExpiresNever(true); setExpiresAt(''); }}>
                {text.apiKeys.never}
              </button>
            </div>
          </div>
          <p className="api-key-quota-note">{text.apiKeys.quotaHint}</p>
          <div className="confirm-modal-actions">
            <button className="btn-secondary" type="button" onClick={handleClose} disabled={createKey.isPending}>
              {text.common.cancel}
            </button>
            <button className="btn-primary" type="submit" disabled={!canCreate || createKey.isPending}>
              {createKey.isPending ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
              {text.common.create}
            </button>
          </div>
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
    </div>,
    document.body
  );
}
