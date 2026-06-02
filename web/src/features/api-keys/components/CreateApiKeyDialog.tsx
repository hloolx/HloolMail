import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, Gauge, KeyRound, ShieldAlert, X } from 'lucide-react';
import { toast } from 'sonner';
import { DialogShell, IconButton, InfoTip, LoadingIndicator } from '../../../components/shared';
import { Button, Input } from '../../../components/ui';
import { copy } from '../../../lib/clipboard';
import { cn } from '../../../lib/utils';
import { useText } from '../../../locales';
import { apiKeysQueryKey, createApiKey } from '../queries';
import { buildApiKeyCreatedNotices } from '../quotaMessages';
import type { APIKey, CreateApiKeyPayload, MailboxStats } from '../types';

export function CreateApiKeyDialog({
  open,
  mailboxStats,
  onClose
}: {
  open: boolean;
  mailboxStats?: MailboxStats;
  onClose: () => void;
}) {
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
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const createButtonRef = useRef<HTMLButtonElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  const hasDailyLimit = dailyUnlimited || dailyLimit.trim() !== '';
  const hasTotalLimit = totalUnlimited || totalLimit.trim() !== '';
  const hasExpiry = expiresNever || expiresAt.trim() !== '';
  const canCreate = name.trim() !== '' && hasDailyLimit && hasTotalLimit && hasExpiry;
  const createdNotices = buildApiKeyCreatedNotices(text, mailboxStats);

  useEffect(() => {
    if (open) {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
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

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, []);

  const handleClose = () => {
    if (closing) return;
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
    }
    setClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      onClose();
    }, 190);
  };

  const buildCreatePayload = (): CreateApiKeyPayload => {
    const trimmedName = name.trim();
    if (!trimmedName) throw new Error(text.apiKeys.nameRequired);

    const daily = dailyUnlimited ? 0 : Number(dailyLimit);
    const total = totalUnlimited ? 0 : Number(totalLimit);
    if (!dailyUnlimited && (!Number.isInteger(daily) || daily < 1)) throw new Error(text.apiKeys.dailyRequired);
    if (!totalUnlimited && (!Number.isInteger(total) || total < 1)) throw new Error(text.apiKeys.totalRequired);

    const payload: CreateApiKeyPayload = {
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
    mutationFn: () => createApiKey(buildCreatePayload()),
    onSuccess: (data) => {
      setPlainKey(data.plain_key);
      setCreatedCopied(false);
      setName('');
      setDailyLimit('');
      setTotalLimit('');
      setDailyUnlimited(false);
      setTotalUnlimited(false);
      setExpiresNever(true);
      setExpiresAt('');
      queryClient.setQueryData<APIKey[]>(apiKeysQueryKey, (current) => {
        const existing = current || [];
        return [data.api_key, ...existing.filter((key) => key.id !== data.api_key.id)];
      });
      queryClient.invalidateQueries({ queryKey: ['user-onboarding'] });
      void copy(data.plain_key, {
        celebrate: true,
        origin: createButtonRef.current,
        label: text.apiKeys.copiedSecret,
        toastMessage: text.apiKeys.copiedSecret
      }).then(setCreatedCopied);
    },
    onError: (error) => toast.error(error.message)
  });

  const submitCreate = (event: FormEvent) => {
    event.preventDefault();
    if (!canCreate || createKey.isPending) return;
    createKey.mutate();
  };

  if (!open && !closing) return null;

  return (
    <DialogShell
      open={open || closing}
      backdropClassName={cn('modal-backdrop', closing && 'modal-backdrop-closing')}
      className={cn('modal-panel', closing && 'modal-panel-closing')}
      titleId="create-api-key-title"
      descriptionId="create-api-key-desc"
      onClose={handleClose}
      initialFocusRef={nameInputRef}
    >
      <div className="modal-header">
        <div>
          <h2 id="create-api-key-title">{text.apiKeys.createTitle}</h2>
          <p id="create-api-key-desc">{text.apiKeys.createDesc}</p>
        </div>
        <IconButton title={text.common.close} onClick={handleClose}>
          <X size={16} />
        </IconButton>
      </div>
      <form className="api-key-form" onSubmit={submitCreate}>
        <label className="api-key-field">
          <span>{text.apiKeys.name}</span>
          <Input
            ref={nameInputRef}
            value={name}
            placeholder={text.apiKeys.namePlaceholder}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </label>
        <div className="api-key-limit-grid">
          <label className="api-key-field">
            <span>{text.apiKeys.dailyLimit}</span>
            <Input
              type="number"
              min="1"
              step="1"
              value={dailyLimit}
              disabled={dailyUnlimited}
              onChange={(event) => setDailyLimit(event.target.value)}
              required={!dailyUnlimited}
            />
          </label>
          <div className="segmented-control">
            <button
              type="button"
              className={cn('segment-choice', !dailyUnlimited && 'segment-choice-active')}
              onClick={() => setDailyUnlimited(false)}
            >
              {text.apiKeys.limited}
            </button>
            <button
              type="button"
              className={cn('segment-choice', dailyUnlimited && 'segment-choice-active')}
              onClick={() => setDailyUnlimited(true)}
            >
              {text.apiKeys.unlimited}
            </button>
          </div>
        </div>
        <div className="api-key-limit-grid">
          <label className="api-key-field">
            <span>{text.apiKeys.totalLimit}</span>
            <Input
              type="number"
              min="1"
              step="1"
              value={totalLimit}
              disabled={totalUnlimited}
              onChange={(event) => setTotalLimit(event.target.value)}
              required={!totalUnlimited}
            />
          </label>
          <div className="segmented-control">
            <button
              type="button"
              className={cn('segment-choice', !totalUnlimited && 'segment-choice-active')}
              onClick={() => setTotalUnlimited(false)}
            >
              {text.apiKeys.limited}
            </button>
            <button
              type="button"
              className={cn('segment-choice', totalUnlimited && 'segment-choice-active')}
              onClick={() => setTotalUnlimited(true)}
            >
              {text.apiKeys.unlimited}
            </button>
          </div>
        </div>
        <div className="api-key-limit-grid">
          <label className="api-key-field">
            <span>{text.apiKeys.expiresAt}</span>
            <Input
              type="datetime-local"
              value={expiresAt}
              disabled={expiresNever}
              onChange={(event) => setExpiresAt(event.target.value)}
              required={!expiresNever}
            />
          </label>
          <div className="segmented-control">
            <button
              type="button"
              className={cn('segment-choice', !expiresNever && 'segment-choice-active')}
              onClick={() => {
                setExpiresNever(false);
              }}
            >
              {text.apiKeys.expires}
            </button>
            <button
              type="button"
              className={cn('segment-choice', expiresNever && 'segment-choice-active')}
              onClick={() => {
                setExpiresNever(true);
                setExpiresAt('');
              }}
            >
              {text.apiKeys.never}
            </button>
          </div>
        </div>
        <div className="flex items-center gap-1 mb-1">
          <InfoTip text={text.apiKeys.quotaHint} />
        </div>
        <div className="confirm-modal-actions">
          <Button variant="secondary" type="button" onClick={handleClose} disabled={createKey.isPending}>
            {text.common.cancel}
          </Button>
          <Button
            ref={createButtonRef}
            variant="primary"
            type="submit"
            disabled={!canCreate}
            loading={createKey.isPending}
            leadingIcon={createKey.isPending ? <LoadingIndicator /> : <KeyRound size={16} />}
          >
            {text.common.create}
          </Button>
        </div>
      </form>
      {plainKey && (
        <div className="created-key-copy">
          <span>
            <b>{createdCopied ? text.apiKeys.createdCopiedTitle : text.apiKeys.createdKeyTitle}</b>
            <small>{text.apiKeys.createdKeyHint}</small>
          </span>
          <Button
            variant="secondary"
            type="button"
            leadingIcon={<Copy size={15} />}
            onClick={(event) => {
              void copy(plainKey, {
                celebrate: true,
                event,
                label: text.apiKeys.copiedSecret,
                toastMessage: text.apiKeys.copiedSecret
              }).then(setCreatedCopied);
            }}
          >
            {text.common.copy}
          </Button>
          <Input
            className="created-key-value"
            value={plainKey}
            readOnly
            autoComplete="off"
            spellCheck={false}
            aria-label={text.apiKeys.createdKeyTitle}
            onFocus={(event) => event.currentTarget.select()}
            onClick={(event) => event.currentTarget.select()}
          />
          {createdNotices.length > 0 && (
            <div className="created-key-notices">
              {createdNotices.map((notice) => (
                <div
                  key={notice.key}
                  className={cn('created-key-notice', `created-key-notice-${notice.tone}`)}
                >
                  {notice.key === 'public-domain-requirement'
                    ? <ShieldAlert size={15} />
                    : <Gauge size={15} />}
                  <p>{notice.message}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </DialogShell>
  );
}
