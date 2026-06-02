import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { APIKey } from '../../api';
import { api } from '../../api';
import { useText } from '../../locales';
import { LoadingIndicator } from '../shared';

export type ApiKeySelectorProps = {
  value: string;
  onChange: (value: string) => void;
  onStatusChange?: (status: ApiKeySelectorStatus) => void;
  placeholder?: string;
};

type ApiKeyMode = 'manual' | 'saved';

export type ApiKeySelectorStatus = {
  mode: ApiKeyMode;
  selectedKeyId: string;
  revealLoading: boolean;
  revealFailed: boolean;
  hasSavedSelection: boolean;
};

export function ApiKeySelector({ value, onChange, onStatusChange, placeholder }: ApiKeySelectorProps) {
  const text = useText();
  const { data: keys, isLoading, error } = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => api<APIKey[]>('/api/api-keys'),
  });

  const [mode, setMode] = useState<ApiKeyMode>('manual');
  const [manualValue, setManualValue] = useState(value);
  const [selectValue, setSelectValue] = useState('');
  const [revealedSecrets, setRevealedSecrets] = useState<Map<string, string>>(new Map());
  const [revealLoadingId, setRevealLoadingId] = useState<string | null>(null);
  const [revealFailedId, setRevealFailedId] = useState<string | null>(null);
  const modeRef = useRef<ApiKeyMode>('manual');
  const selectedIdRef = useRef('');

  const keyMap = useMemo(() => {
    const map = new Map<string, APIKey>();
    keys?.forEach((key) => map.set(String(key.id), key));
    return map;
  }, [keys]);

  const selectedKey = selectValue ? keyMap.get(selectValue) : undefined;
  const selectedFullKey = selectedKey ? revealedSecrets.get(String(selectedKey.id)) || '' : '';
  const hasKeys = Boolean(keys && keys.length > 0);
  const revealLoading = mode === 'saved' && Boolean(revealLoadingId);
  const revealFailed = mode === 'saved' && Boolean(selectedKey) && revealFailedId === String(selectedKey?.id);
  const showUnavailable = mode === 'saved' && Boolean(selectedKey) && !revealLoadingId && revealFailedId === String(selectedKey?.id);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    selectedIdRef.current = selectValue;
  }, [selectValue]);

  useEffect(() => {
    if (mode === 'manual' && value !== manualValue) {
      setManualValue(value);
    }
  }, [manualValue, mode, value]);

  useEffect(() => {
    if (mode !== 'saved' || !value || !keys) return;
    const match = keys.find((key) => {
      const secret = revealedSecrets.get(String(key.id));
      return secret ? secret === value : key.key_prefix && value.startsWith(key.key_prefix);
    });
    setSelectValue(match ? String(match.id) : '');
  }, [mode, value, keys, revealedSecrets]);

  useEffect(() => {
    onStatusChange?.({
      mode,
      selectedKeyId: selectValue,
      revealLoading,
      revealFailed,
      hasSavedSelection: Boolean(selectedKey)
    });
  }, [mode, onStatusChange, revealFailed, revealLoading, selectValue, selectedKey]);

  const switchMode = (nextMode: ApiKeyMode) => {
    modeRef.current = nextMode;
    setMode(nextMode);
    setRevealFailedId(null);
    if (nextMode === 'manual') {
      onChange(manualValue);
      return;
    }
    onChange(selectedFullKey);
  };

  const handleSelect = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    const id = event.target.value;
    selectedIdRef.current = id;
    setSelectValue(id);
    setRevealFailedId(null);
    if (!id) {
      onChange('');
      return;
    }
    const cached = revealedSecrets.get(id);
    if (cached) {
      onChange(cached);
      return;
    }
    onChange('');
    setRevealLoadingId(id);
    try {
      const data = await api<{ plain_key: string }>(`/api/api-keys/${id}/reveal`, { method: 'POST', body: JSON.stringify({}) });
      setRevealedSecrets((prev) => {
        const next = new Map(prev);
        next.set(id, data.plain_key);
        return next;
      });
      if (modeRef.current === 'saved' && selectedIdRef.current === id) {
        onChange(data.plain_key);
      }
    } catch {
      setRevealFailedId(id);
      toast.error(text.apiDocs.apiKeyRevealFailed);
    } finally {
      setRevealLoadingId(null);
    }
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setManualValue(event.target.value);
    setSelectValue('');
    onChange(event.target.value);
  };

  return (
    <div className="api-key-selector">
      <div className="api-key-selector-tabs" role="tablist" aria-label={text.apiDocs.apiKey}>
        <button
          type="button"
          className={mode === 'manual' ? 'active' : ''}
          aria-pressed={mode === 'manual'}
          onClick={() => switchMode('manual')}
        >
          {text.apiDocs.apiKeyManual}
        </button>
        <button
          type="button"
          className={mode === 'saved' ? 'active' : ''}
          aria-pressed={mode === 'saved'}
          onClick={() => switchMode('saved')}
        >
          {text.apiDocs.apiKeySaved}
        </button>
      </div>

      {mode === 'manual' ? (
        <div className="api-key-selector-control">
          <input
            type="password"
            className="input"
            value={manualValue}
            onChange={handleInputChange}
            placeholder={placeholder || text.apiDocs.apiKeyPlaceholder}
            autoComplete="off"
          />
          {isLoading && (
            <span className="api-key-selector-loader" aria-hidden="true">
              <LoadingIndicator />
            </span>
          )}
        </div>
      ) : (
        <select
          className="input"
          value={selectValue}
          onChange={handleSelect}
          disabled={isLoading || Boolean(error) || !hasKeys || revealLoading}
        >
          <option value="">
            {isLoading
              ? text.apiDocs.apiKeyLoading
              : error
                ? text.apiDocs.apiKeyLoadError
                : hasKeys
                  ? text.apiDocs.apiKeySelectPlaceholder
                  : text.apiDocs.apiKeyNoSaved}
          </option>
          {keys?.map((key) => (
            <option key={key.id} value={String(key.id)}>
              {key.name} ({key.key_prefix}****)
            </option>
          ))}
        </select>
      )}

      {mode === 'saved' && revealLoadingId && (
        <p className="api-key-selector-note api-key-selector-loading">
          <LoadingIndicator size={14} label={text.apiDocs.apiKeyRevealing} />
        </p>
      )}
      {showUnavailable && (
        <p className="api-key-selector-note api-key-selector-error">{text.apiDocs.apiKeyRevealFailed}</p>
      )}
    </div>
  );
}
