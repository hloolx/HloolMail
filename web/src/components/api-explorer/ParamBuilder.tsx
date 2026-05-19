import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2, ToggleLeft, ToggleRight } from 'lucide-react';
import { dissolveElement } from '../../lib/dissolve';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type ParamBuilderProps = {
  value: string;
  mode: 'query' | 'json';
  onChange: (value: string) => void;
  disabled?: boolean;
};

type QueryRow = {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
};

type JsonValue = string | number | boolean | null;

type JsonRow = {
  id: string;
  key: string;
  value: JsonValue;
  enabled: boolean;
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

let idCounter = 0;
function uid() {
  return `pb-${++idCounter}-${Date.now().toString(36)}`;
}

/* ----- Query ----- */

function parseQueryString(input: string): QueryRow[] {
  const trimmed = input.trim();
  if (!trimmed) return [];
  return trimmed.split('&').map((part) => {
    const idx = part.indexOf('=');
    const key = idx === -1 ? decodeURIComponent(part) : decodeURIComponent(part.slice(0, idx));
    const value = idx === -1 ? '' : decodeURIComponent(part.slice(idx + 1));
    return { id: uid(), key, value, enabled: true };
  });
}

function buildQueryString(rows: QueryRow[]): string {
  return rows
    .filter((r) => r.enabled && r.key !== '')
    .map((r) => `${encodeURIComponent(r.key)}=${encodeURIComponent(r.value)}`)
    .join('&');
}

/* ----- JSON ----- */

function isFlatObject(v: unknown): v is Record<string, JsonValue> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  return Object.values(v).every(
    (val) =>
      typeof val === 'string' ||
      typeof val === 'number' ||
      typeof val === 'boolean' ||
      val === null,
  );
}

function parseJsonString(input: string): { rows: JsonRow[]; flat: boolean } {
  const trimmed = input.trim();
  if (!trimmed) {
    return { rows: [], flat: true };
  }
  try {
    const parsed = JSON.parse(input);
    if (isFlatObject(parsed)) {
      const rows = Object.entries(parsed).map(([key, val]) => ({
        id: uid(),
        key,
        value: val as JsonValue,
        enabled: true,
      }));
      return { rows, flat: true };
    }
    return { rows: [], flat: false };
  } catch {
    return { rows: [], flat: false };
  }
}

function buildJsonString(rows: JsonRow[]): string {
  const obj: Record<string, JsonValue> = {};
  for (const row of rows) {
    if (row.enabled && row.key !== '') {
      obj[row.key] = row.value;
    }
  }
  return JSON.stringify(obj, null, 2);
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function ParamBuilder({ value, mode, onChange, disabled }: ParamBuilderProps) {
  const lastGenerated = useRef(value);
  const [isRaw, setIsRaw] = useState(false);

  const [queryRows, setQueryRows] = useState<QueryRow[]>([]);
  const [jsonRows, setJsonRows] = useState<JsonRow[]>([]);
  const [jsonFlat, setJsonFlat] = useState(true);

  /* Sync from external value */
  useEffect(() => {
    if (value === lastGenerated.current) return;
    lastGenerated.current = value;

    if (mode === 'query') {
      setQueryRows(parseQueryString(value));
      setIsRaw(false);
    } else {
      const { rows, flat } = parseJsonString(value);
      setJsonRows(rows);
      setJsonFlat(flat);
      setIsRaw(!flat);
    }
  }, [value, mode]);

  /* ----- Query handlers ----- */

  const updateQueryRows = (updater: (prev: QueryRow[]) => QueryRow[]) => {
    setQueryRows((prev) => {
      const next = updater(prev);
      const generated = buildQueryString(next);
      lastGenerated.current = generated;
      onChange(generated);
      return next;
    });
  };

  const addQueryRow = () => {
    updateQueryRows((prev) => [...prev, { id: uid(), key: '', value: '', enabled: true }]);
  };

  const removeQueryRow = (id: string) => {
    updateQueryRows((prev) => prev.filter((r) => r.id !== id));
  };

  const patchQueryRow = (id: string, patch: Partial<QueryRow>) => {
    updateQueryRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  /* ----- JSON handlers ----- */

  const updateJsonRows = (updater: (prev: JsonRow[]) => JsonRow[]) => {
    setJsonRows((prev) => {
      const next = updater(prev);
      const generated = buildJsonString(next);
      lastGenerated.current = generated;
      onChange(generated);
      return next;
    });
  };

  const addJsonRow = () => {
    updateJsonRows((prev) => [...prev, { id: uid(), key: '', value: '', enabled: true }]);
  };

  const removeJsonRow = (id: string) => {
    updateJsonRows((prev) => prev.filter((r) => r.id !== id));
  };

  const patchJsonRow = (id: string, patch: Partial<JsonRow>) => {
    updateJsonRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  /* ----- Raw handlers ----- */

  const handleRawChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    lastGenerated.current = newValue;
    onChange(newValue);
  };

  const toggleRaw = () => {
    const nextRaw = !isRaw;
    if (nextRaw) {
      setIsRaw(true);
    } else {
      if (mode === 'query') {
        setQueryRows(parseQueryString(value));
        setIsRaw(false);
      } else {
        const { rows, flat } = parseJsonString(value);
        if (flat) {
          setJsonRows(rows);
          setJsonFlat(true);
          setIsRaw(false);
        }
        /* if not flat, stay in raw mode */
      }
    }
  };

  /* ----- Render helpers ----- */

  const isFormAvailable = mode === 'query' || (mode === 'json' && jsonFlat);
  const showForm = !isRaw && isFormAvailable;

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleRaw}
            disabled={disabled || !isFormAvailable}
            aria-pressed={isRaw}
            className="flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 py-1.5 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--soft)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isRaw ? (
              <ToggleRight size={16} className="text-[var(--focus)]" />
            ) : (
              <ToggleLeft size={16} className="text-[var(--muted)]" />
            )}
            <span>{isRaw ? 'Raw' : 'Form'}</span>
          </button>

          {mode === 'json' && !jsonFlat && (
            <span className="text-xs text-[var(--bad)]">Nested object — raw only</span>
          )}
        </div>
      </div>

      {/* Body */}
      {showForm ? (
        mode === 'query' ? (
          <QueryForm
            rows={queryRows}
            disabled={disabled}
            onAdd={addQueryRow}
            onRemove={removeQueryRow}
            onPatch={patchQueryRow}
          />
        ) : (
          <JsonForm
            rows={jsonRows}
            disabled={disabled}
            onAdd={addJsonRow}
            onRemove={removeJsonRow}
            onPatch={patchJsonRow}
          />
        )
      ) : (
        <RawArea value={value} disabled={disabled} onChange={handleRawChange} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                      */
/* ------------------------------------------------------------------ */

function QueryForm({
  rows,
  disabled,
  onAdd,
  onRemove,
  onPatch,
}: {
  rows: QueryRow[];
  disabled?: boolean;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onPatch: (id: string, patch: Partial<QueryRow>) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) => (
        <div
          key={row.id}
          className="group flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--panel)] p-2 transition-colors hover:border-[var(--focus)]"
        >
          <input
            type="checkbox"
            checked={row.enabled}
            onChange={(e) => onPatch(row.id, { enabled: e.target.checked })}
            disabled={disabled}
            title="Include in output"
            className="h-4 w-4 shrink-0 cursor-pointer accent-[var(--focus)] disabled:cursor-not-allowed"
          />
          <input
            type="text"
            value={row.key}
            onChange={(e) => onPatch(row.id, { key: e.target.value })}
            disabled={disabled}
            placeholder="key"
            className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] outline-none focus:border-[var(--focus)] disabled:cursor-not-allowed disabled:opacity-50"
          />
          <input
            type="text"
            value={row.value}
            onChange={(e) => onPatch(row.id, { value: e.target.value })}
            disabled={disabled}
            placeholder="value"
            className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] outline-none focus:border-[var(--focus)] disabled:cursor-not-allowed disabled:opacity-50"
          />
          <button
            type="button"
            onClick={async (e) => {
              const rowEl = (e.currentTarget as HTMLElement).closest('.group') as HTMLElement | null;
              if (rowEl) await dissolveElement(rowEl, { duration: 300, blockSize: 4, direction: 'out' });
              onRemove(row.id);
            }}
            disabled={disabled}
            title="Remove"
            className="shrink-0 rounded p-1 text-[var(--muted)] transition-colors hover:bg-[var(--bad)]/10 hover:text-[var(--bad)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 size={16} />
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={onAdd}
        disabled={disabled}
        className="flex items-center justify-center gap-1.5 rounded-md border border-dashed border-[var(--border)] bg-[var(--panel)] py-2 text-sm text-[var(--muted)] transition-colors hover:border-[var(--focus)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus size={16} />
        Add parameter
      </button>
    </div>
  );
}

function JsonForm({
  rows,
  disabled,
  onAdd,
  onRemove,
  onPatch,
}: {
  rows: JsonRow[];
  disabled?: boolean;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onPatch: (id: string, patch: Partial<JsonRow>) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) => (
        <div
          key={row.id}
          className="group flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--panel)] p-2 transition-colors hover:border-[var(--focus)]"
        >
          <input
            type="checkbox"
            checked={row.enabled}
            onChange={(e) => onPatch(row.id, { enabled: e.target.checked })}
            disabled={disabled}
            title="Include in output"
            className="h-4 w-4 shrink-0 cursor-pointer accent-[var(--focus)] disabled:cursor-not-allowed"
          />
          <input
            type="text"
            value={row.key}
            onChange={(e) => onPatch(row.id, { key: e.target.value })}
            disabled={disabled}
            placeholder="key"
            className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] outline-none focus:border-[var(--focus)] disabled:cursor-not-allowed disabled:opacity-50"
          />

          {typeof row.value === 'boolean' ? (
            <select
              value={row.value ? 'true' : 'false'}
              onChange={(e) => onPatch(row.id, { value: e.target.value === 'true' })}
              disabled={disabled}
              className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm text-[var(--foreground)] outline-none focus:border-[var(--focus)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          ) : typeof row.value === 'number' ? (
            <input
              type="number"
              value={row.value}
              onChange={(e) => {
                const num = e.target.value === '' ? 0 : Number(e.target.value);
                onPatch(row.id, { value: num });
              }}
              disabled={disabled}
              placeholder="value"
              className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] outline-none focus:border-[var(--focus)] disabled:cursor-not-allowed disabled:opacity-50"
            />
          ) : (
            <input
              type="text"
              value={row.value === null ? '' : row.value}
              onChange={(e) => onPatch(row.id, { value: e.target.value })}
              disabled={disabled}
              placeholder={row.value === null ? 'null' : 'value'}
              className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] outline-none focus:border-[var(--focus)] disabled:cursor-not-allowed disabled:opacity-50"
            />
          )}

          <button
            type="button"
            onClick={async (e) => {
              const rowEl = (e.currentTarget as HTMLElement).closest('.group') as HTMLElement | null;
              if (rowEl) await dissolveElement(rowEl, { duration: 300, blockSize: 4, direction: 'out' });
              onRemove(row.id);
            }}
            disabled={disabled}
            title="Remove"
            className="shrink-0 rounded p-1 text-[var(--muted)] transition-colors hover:bg-[var(--bad)]/10 hover:text-[var(--bad)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 size={16} />
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={onAdd}
        disabled={disabled}
        className="flex items-center justify-center gap-1.5 rounded-md border border-dashed border-[var(--border)] bg-[var(--panel)] py-2 text-sm text-[var(--muted)] transition-colors hover:border-[var(--focus)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus size={16} />
        Add field
      </button>
    </div>
  );
}

function RawArea({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
}) {
  return (
    <textarea
      value={value}
      onChange={onChange}
      disabled={disabled}
      spellCheck={false}
      className="h-48 w-full resize-y rounded-md border border-[var(--border)] bg-[var(--background)] p-3 font-mono text-sm text-[var(--foreground)] outline-none focus:border-[var(--focus)] disabled:cursor-not-allowed disabled:opacity-50"
    />
  );
}
