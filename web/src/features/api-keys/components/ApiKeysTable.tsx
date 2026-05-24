import { useMemo, useRef, useState } from 'react';
import type { Dispatch, MouseEvent, SetStateAction } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { DataTable, DataTableToolbar, DataTableViewOptions, IconButton, QuotaThermometer } from '../../../components/shared';
import type { DataTableColumn, DataTableSortState } from '../../../components/shared';
import { Switch } from '../../../components/ui';
import { copy } from '../../../lib/clipboard';
import { formatAPIKeyExpiry, relativeTime } from '../../../lib/display';
import { notifySuccess } from '../../../lib/feedback';
import { cn } from '../../../lib/utils';
import { useText } from '../../../locales';
import { apiKeysQueryKey, revealApiKey, setApiKeyEnabled } from '../queries';
import type { APIKey } from '../types';

type ApiKeysTableProps = {
  keys: APIKey[];
  isLoading: boolean;
  selectedKeyIds: number[];
  onSelectedKeyIdsChange: Dispatch<SetStateAction<number[]>>;
  deletePending: boolean;
  onRequestDelete: (targets: APIKey[], targetElement: HTMLElement | null) => void;
};

export function ApiKeysTable({
  keys,
  isLoading,
  selectedKeyIds,
  onSelectedKeyIdsChange,
  deletePending,
  onRequestDelete
}: ApiKeysTableProps) {
  const queryClient = useQueryClient();
  const text = useText();
  const [copyingKeyId, setCopyingKeyId] = useState<number | null>(null);
  const [hiddenColumnKeys, setHiddenColumnKeys] = useState<string[]>([]);
  const [sortState, setSortState] = useState<DataTableSortState | null>(null);
  const feedbackOriginRef = useRef<HTMLElement | null>(null);
  const selectedCount = keys.filter((key) => selectedKeyIds.includes(key.id)).length;
  const allKeysSelected = keys.length > 0 && selectedCount === keys.length;
  const someKeysSelected = selectedCount > 0 && !allKeysSelected;
  const toggleKey = useMutation({
    mutationFn: (key: APIKey) => setApiKeyEnabled(key, !key.enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: apiKeysQueryKey });
      notifySuccess(text.toast.apiKeyUpdated, { origin: feedbackOriginRef.current });
      feedbackOriginRef.current = null;
    },
    onError: (error) => {
      feedbackOriginRef.current = null;
      toast.error(error.message);
    }
  });

  const handleCopyKey = async (key: APIKey, event: MouseEvent<Element>) => {
    setCopyingKeyId(key.id);
    try {
      const data = await revealApiKey(key.id);
      await copy(data.plain_key, {
        celebrate: true,
        event,
        label: text.apiKeys.copiedSecret,
        toastMessage: text.apiKeys.copiedSecret
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text.apiKeys.copyUnavailable);
    } finally {
      setCopyingKeyId(null);
    }
  };

  const toggleSelectedKey = (id: number) => {
    onSelectedKeyIdsChange((current) => (
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    ));
  };

  const toggleSelectAllKeys = () => {
    onSelectedKeyIdsChange(allKeysSelected ? [] : keys.map((key) => key.id));
  };

  const columns = useMemo<DataTableColumn[]>(() => [
    {
      key: 'select',
      align: 'center',
      width: '5.5rem',
      hideable: false,
      mobileBadge: true,
      header: (
        <label className="table-select">
          <input
            type="checkbox"
            checked={allKeysSelected}
            disabled={keys.length === 0 || deletePending}
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
    { key: 'name', header: text.apiKeys.name, minWidth: '9rem', sortable: true, sortLabel: String(text.apiKeys.name), mobileTitle: true },
    { key: 'key', header: text.apiKeys.key, minWidth: '13rem', mobileSubtitle: true },
    { key: 'enabled', header: text.apiKeys.enabled, align: 'center', width: '6rem', sortable: true, sortLabel: String(text.apiKeys.enabled), mobileBadge: true },
    { key: 'today', header: text.apiKeys.today, align: 'center', width: '8rem', sortable: true, sortLabel: String(text.apiKeys.today), mobilePriority: 1 },
    { key: 'total', header: text.apiKeys.total, align: 'center', width: '8rem', sortable: true, sortLabel: String(text.apiKeys.total), mobilePriority: 2 },
    { key: 'expires', header: text.apiKeys.expires, width: '8rem', sortable: true, sortLabel: String(text.apiKeys.expires), mobilePriority: 3 },
    { key: 'created', header: text.common.createdAt, width: '8rem', sortable: true, sortLabel: String(text.common.createdAt), mobilePriority: 4 },
    { key: 'last-used', header: text.apiKeys.lastUsed, width: '8rem', sortable: true, sortLabel: String(text.apiKeys.lastUsed), mobilePriority: 5 },
    { key: 'actions', header: text.apiKeys.actions, align: 'right', width: '5rem', hideable: false }
  ], [allKeysSelected, deletePending, keys.length, someKeysSelected, text]);
  const sortedKeys = useMemo(
    () => sortApiKeys(keys, sortState),
    [keys, sortState]
  );

  return (
    <>
      <DataTableToolbar
        viewOptions={(
          <DataTableViewOptions
            columns={columns}
            hiddenColumnKeys={hiddenColumnKeys}
            onHiddenColumnKeysChange={setHiddenColumnKeys}
            label={text.common.view}
            menuLabel={text.common.toggleColumns}
            resetLabel={text.common.reset}
          />
        )}
      />
      <DataTable
      ariaLabel={text.apiKeys.title}
      columns={columns}
      hiddenColumnKeys={hiddenColumnKeys}
      onHiddenColumnKeysChange={setHiddenColumnKeys}
      sortState={sortState}
      onSortChange={setSortState}
      hiddenLabel={text.common.noColumnsSelected}
      showAllColumnsLabel={text.common.showAllColumns}
      emptyLabel={isLoading ? text.common.loading : text.apiKeys.empty}
      rows={sortedKeys.map((key) => {
        const maskedKey = maskAPIKey(key.key_prefix);
        return {
          key: key.id,
          selected: selectedKeyIds.includes(key.id),
          cells: [
            <label className="table-select">
              <input
                type="checkbox"
                checked={selectedKeyIds.includes(key.id)}
                disabled={deletePending}
                onChange={() => toggleSelectedKey(key.id)}
                aria-label={`${text.apiKeys.selectKey} ${key.name}`}
              />
            </label>,
            key.name,
            <button
              onClick={(event) => {
                event.preventDefault();
                handleCopyKey(key, event);
              }}
              disabled={copyingKeyId === key.id}
              className={cn('key-copy', copyingKeyId === key.id && 'key-copy-loading')}
            >
              <span className="key-copy-mask">{maskedKey}</span>
              {copyingKeyId === key.id ? <Loader2 size={13} className="animate-spin" /> : <Copy size={13} />}
            </button>,
            <Switch
              size="sm"
              checked={key.enabled}
              onClick={(event) => {
                feedbackOriginRef.current = event.currentTarget;
              }}
              onCheckedChange={() => toggleKey.mutate(key)}
              disabled={toggleKey.isPending}
              aria-label={key.enabled ? text.common.enabled : text.common.disabled}
            />,
            <QuotaThermometer used={key.used_today} limit={key.daily_limit} />,
            <QuotaThermometer used={key.total_used} limit={key.total_limit} />,
            formatAPIKeyExpiry(key.expires_at),
            relativeTime(key.created_at),
            key.last_used_at ? relativeTime(key.last_used_at) : '-',
            <div className="table-actions" data-key-id={key.id}>
              <IconButton
                title={`${text.apiKeys.deleteKey}: ${key.name}`}
                aria-label={`${text.apiKeys.deleteKey} ${key.name}`}
                onClick={(event) => {
                  const row = (event.currentTarget as HTMLElement).closest('tr, .data-table-mobile-card') as HTMLElement | null;
                  onRequestDelete([key], row);
                }}
                disabled={deletePending}
              >
                <Trash2 size={14} />
              </IconButton>
            </div>
          ]
        };
      })}
      />
    </>
  );
}

function sortApiKeys(keys: APIKey[], sortState: DataTableSortState | null) {
  if (!sortState) return keys;
  const direction = sortState.direction === 'asc' ? 1 : -1;
  return [...keys].sort((a, b) => compareApiKeys(a, b, sortState.key) * direction);
}

function compareApiKeys(a: APIKey, b: APIKey, key: string) {
  switch (key) {
    case 'name':
      return compareText(a.name, b.name);
    case 'enabled':
      return compareNumber(Number(a.enabled), Number(b.enabled));
    case 'today':
      return compareNumber(a.used_today, b.used_today);
    case 'total':
      return compareNumber(a.total_used, b.total_used);
    case 'expires':
      return compareOptionalTime(a.expires_at, b.expires_at);
    case 'created':
      return compareOptionalTime(a.created_at, b.created_at);
    case 'last-used':
      return compareOptionalTime(a.last_used_at, b.last_used_at);
    default:
      return 0;
  }
}

function compareText(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function compareNumber(a: number, b: number) {
  return a - b;
}

function compareOptionalTime(a?: string, b?: string) {
  const aTime = a ? Date.parse(a) : 0;
  const bTime = b ? Date.parse(b) : 0;
  return compareNumber(Number.isFinite(aTime) ? aTime : 0, Number.isFinite(bTime) ? bTime : 0);
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
