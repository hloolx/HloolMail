import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { APIKey } from '../../api';
import { api } from '../../api';
import { useText } from '../../locales';
import { LoadingIndicator } from '../shared';

export type ApiKeySelectorProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
};

type ApiKeyMode = 'manual' | 'saved';

export function ApiKeySelector({ value, onChange, placeholder }: ApiKeySelectorProps) {
  const text = useText();
  const { data: keys, isLoading, error } = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => api<APIKey[]>('/api/api-keys'),
  });

  const [mode, setMode] = useState<ApiKeyMode>('manual');
  const [selectValue, setSelectValue] = useState('');
  const [revealedSecrets, setRevealedSecrets] = useState<Map<string, string>>(new Map());
  const [revealLoadingId, setRevealLoadingId] = useState<string | null>(null);
  const [revealFailedId, setRevealFailedId] = useState<string | null>(null);

  const keyMap = useMemo(() => {
    const map = new Map<string, APIKey>();
    keys?.forEach((key) => map.set(String(key.id), key));
    return map;
  }, [keys]);

  const selectedKey = selectValue ? keyMap.get(selectValue) : undefined;
  const selectedFullKey = selectedKey ? revealedSecrets.get(String(selectedKey.id)) || '' : '';
  const hasKeys = keys && keys.length > 0;
  const showUnavailable = mode === 'saved' && Boolean(selectedKey) && !revealLoadingId && revealFailedId === String(selectedKey?.id);

  useEffect(() => {
    if (!value || !keys) {
      setSelectValue('');
      return;
    }
    const match = keys.find((key) => {
      const secret = revealedSecrets.get(String(key.id));
      return secret ? secret === value : key.key_prefix && value.startsWith(key.key_prefix);
    });
    setSelectValue(match ? String(match.id) : '');
  }, [value, keys, revealedSecrets]);

  const switchMode = (nextMode: ApiKeyMode) => {
    setMode(nextMode);
    if (nextMode === 'saved' && selectedFullKey) {
      onChange(selectedFullKey);
    }
  };

  const handleSelect = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    const id = event.target.value;
    setSelectValue(id);
    if (!id) {
      onChange('');
      return;
    }
    const cached = revealedSecrets.get(id);
    if (cached) {
      onChange(cached);
      return;
    }
    setRevealLoadingId(id);
    setRevealFailedId(null);
    try {
      const data = await api<{ plain_key: string }>(`/api/api-keys/${id}/reveal`, { method: 'POST', body: JSON.stringify({}) });
      setRevealedSecrets((prev) => {
        const next = new Map(prev);
        next.set(id, data.plain_key);
        return next;
      });
      onChange(data.plain_key);
    } catch {
      setRevealFailedId(id);
      toast.error(text.apiDocs.apiKeyRevealFailed);
    } finally {
      setRevealLoadingId(null);
    }
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
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
            value={value}
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
          disabled={isLoading || Boolean(error) || !hasKeys || Boolean(revealLoadingId)}
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

      {revealLoadingId && (
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
