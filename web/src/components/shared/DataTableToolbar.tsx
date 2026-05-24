import { ChevronDown, Columns3 } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import type { DataTableColumn } from './DataTable';
import { FloatingDropdown } from './FloatingDropdown';

export type DataTableToolbarProps = {
  search?: ReactNode;
  filters?: ReactNode;
  state?: ReactNode;
  viewOptions?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
};

export function DataTableToolbar({
  search,
  filters,
  state,
  viewOptions,
  actions,
  children,
  className
}: DataTableToolbarProps) {
  const hasMain = Boolean(children || search || filters || state);
  const hasActions = Boolean(viewOptions || actions);

  return (
    <div className={['data-table-toolbar', className || ''].filter(Boolean).join(' ')}>
      {hasMain ? (
        <div className="data-table-toolbar-main">
          {children ? <div className="data-table-toolbar-content">{children}</div> : null}
          {search ? <div className="data-table-toolbar-search">{search}</div> : null}
          {filters ? <div className="data-table-toolbar-filters">{filters}</div> : null}
          {state ? <div className="data-table-toolbar-state">{state}</div> : null}
        </div>
      ) : null}
      {hasActions ? (
        <div className="data-table-toolbar-actions">
          {viewOptions}
          {actions}
        </div>
      ) : null}
    </div>
  );
}

export type DataTableViewOptionsProps = {
  columns: DataTableColumn[];
  hiddenColumnKeys?: readonly string[];
  onHiddenColumnKeysChange: (hiddenColumnKeys: string[]) => void;
  label?: ReactNode;
  menuLabel?: ReactNode;
  resetLabel?: ReactNode;
  emptyLabel?: ReactNode;
  className?: string;
  align?: 'start' | 'end';
  disabled?: boolean;
  getColumnLabel?: (column: DataTableColumn) => ReactNode;
};

export function DataTableViewOptions({
  columns,
  hiddenColumnKeys = [],
  onHiddenColumnKeysChange,
  label = 'View',
  menuLabel = 'Toggle columns',
  resetLabel = 'Reset',
  emptyLabel = 'No columns available',
  className,
  align = 'end',
  disabled = false,
  getColumnLabel
}: DataTableViewOptionsProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const hideableColumns = useMemo(
    () => columns.filter((column) => column.hideable !== false),
    [columns]
  );
  const normalizedHiddenKeys = useMemo(() => uniqueKeys(hiddenColumnKeys), [hiddenColumnKeys]);
  const hideableColumnKeys = useMemo(() => new Set(hideableColumns.map((column) => column.key)), [hideableColumns]);
  const hiddenColumnSet = useMemo(() => new Set(normalizedHiddenKeys), [normalizedHiddenKeys]);
  const visibleCount = hideableColumns.filter((column) => !hiddenColumnSet.has(column.key)).length;
  const hasHiddenHideableColumns = normalizedHiddenKeys.some((key) => hideableColumnKeys.has(key));
  const triggerDisabled = disabled || hideableColumns.length === 0;

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const setColumnVisible = (columnKey: string, visible: boolean) => {
    const nextHiddenKeys = visible
      ? normalizedHiddenKeys.filter((key) => key !== columnKey)
      : [...normalizedHiddenKeys, columnKey];
    onHiddenColumnKeysChange(uniqueKeys(nextHiddenKeys));
  };

  const resetHiddenColumns = () => {
    onHiddenColumnKeysChange(normalizedHiddenKeys.filter((key) => !hideableColumnKeys.has(key)));
  };

  const renderColumnLabel = (column: DataTableColumn) => (
    getColumnLabel?.(column) ?? column.viewLabel ?? column.header
  );

  return (
    <div className={['data-table-view', className || ''].filter(Boolean).join(' ')}>
      <button
        ref={triggerRef}
        className="data-table-view-trigger"
        type="button"
        disabled={triggerDisabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <Columns3 size={15} aria-hidden="true" />
        <span>{label}</span>
        <ChevronDown className="data-table-view-trigger-chevron" size={14} aria-hidden="true" data-open={open ? 'true' : undefined} />
      </button>
      <FloatingDropdown
        open={open}
        anchorRef={triggerRef}
        menuRef={menuRef}
        align={align}
        width={232}
        className="data-table-view-menu"
        id={id}
        role="dialog"
        labelledBy={`${id}-label`}
      >
        <div className="data-table-view-menu-head">
          <span id={`${id}-label`}>{menuLabel}</span>
          <span className="data-table-view-count">{visibleCount}/{hideableColumns.length}</span>
        </div>
        <div className="data-table-view-options">
          {hideableColumns.length > 0 ? hideableColumns.map((column) => {
            const visible = !hiddenColumnSet.has(column.key);
            return (
              <label className="data-table-view-option" key={column.key}>
                <input
                  type="checkbox"
                  checked={visible}
                  onChange={(event) => setColumnVisible(column.key, event.currentTarget.checked)}
                />
                <span>{renderColumnLabel(column)}</span>
              </label>
            );
          }) : (
            <div className="data-table-view-empty">{emptyLabel}</div>
          )}
        </div>
        <div className="data-table-view-menu-footer">
          <button className="data-table-view-reset" type="button" disabled={!hasHiddenHideableColumns} onClick={resetHiddenColumns}>
            {resetLabel}
          </button>
        </div>
      </FloatingDropdown>
    </div>
  );
}

function uniqueKeys(keys: readonly string[]) {
  return [...new Set(keys.filter(Boolean))];
}
