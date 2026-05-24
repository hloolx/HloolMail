import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { isValidElement, type CSSProperties, type ReactNode } from 'react';
import { useText } from '../../locales';

export type DataTableSortDirection = 'asc' | 'desc';

export type DataTableSortState = {
  key: string;
  direction: DataTableSortDirection;
};

export type DataTableColumn = {
  key: string;
  header: ReactNode;
  viewLabel?: ReactNode;
  align?: 'left' | 'center' | 'right';
  width?: string;
  minWidth?: string;
  className?: string;
  headerClassName?: string;
  cellClassName?: string;
  hideable?: boolean;
  sortable?: boolean;
  sortLabel?: string;
  mobileTitle?: boolean;
  mobileSubtitle?: boolean;
  mobileBadge?: boolean;
  mobileHidden?: boolean;
  mobilePriority?: number;
  mobileLabel?: ReactNode;
};

export type DataTableCell = {
  content: ReactNode;
  align?: 'left' | 'center' | 'right';
  className?: string;
  title?: string;
  colSpan?: number;
};

export type DataTableRow = {
  key: string | number;
  cells: Array<ReactNode | DataTableCell>;
  className?: string;
  selected?: boolean;
};

export type DataTableProps = {
  columns: DataTableColumn[];
  rows: DataTableRow[];
  emptyLabel?: ReactNode;
  hiddenLabel?: ReactNode;
  showAllColumnsLabel?: ReactNode;
  ariaLabel?: string;
  className?: string;
  density?: 'default' | 'compact';
  stickyHeader?: boolean;
  stickyActions?: boolean;
  stickyLastColumn?: boolean;
  hiddenColumnKeys?: readonly string[];
  onHiddenColumnKeysChange?: (hiddenColumnKeys: string[]) => void;
  sortState?: DataTableSortState | null;
  onSortChange?: (sortState: DataTableSortState, column: DataTableColumn) => void;
};

export function DataTable({
  columns,
  rows,
  emptyLabel = '-',
  hiddenLabel = 'No columns selected',
  showAllColumnsLabel = 'Show all columns',
  ariaLabel,
  className,
  density = 'default',
  stickyHeader = true,
  stickyActions = true,
  stickyLastColumn = false,
  hiddenColumnKeys = [],
  onHiddenColumnKeysChange,
  sortState,
  onSortChange
}: DataTableProps) {
  const text = useText();
  const hiddenColumnSet = new Set(hiddenColumnKeys);
  const visibleColumns = columns
    .map((column, index) => ({ column, index }))
    .filter(({ column }) => !hiddenColumnSet.has(column.key));
  const visibleColumnCount = Math.max(visibleColumns.length, 1);
  const lastColumn = visibleColumns[visibleColumns.length - 1]?.column;
  const shouldStickLastColumn = visibleColumns.length > 0 && (stickyLastColumn || (stickyActions && lastColumn?.key === 'actions'));
  const shellClassName = [
    'table-wrap',
    'data-table-shell',
    shouldStickLastColumn ? 'data-table-shell-sticky-last' : ''
  ].filter(Boolean).join(' ');
  const tableClassName = [
    'data-table',
    `data-table-${density}`,
    stickyHeader ? 'data-table-sticky' : '',
    shouldStickLastColumn ? 'data-table-sticky-last' : '',
    visibleColumns.length === 0 ? 'data-table-all-hidden' : '',
    className || ''
  ].filter(Boolean).join(' ');

  const renderHiddenState = () => (
    <>
      <span>{hiddenLabel}</span>
      {onHiddenColumnKeysChange ? (
        <button className="data-table-empty-action" type="button" onClick={() => onHiddenColumnKeysChange([])}>
          {showAllColumnsLabel}
        </button>
      ) : null}
    </>
  );

  return (
    <div className={shellClassName}>
      <table className={tableClassName} aria-label={ariaLabel}>
        <thead>
          <tr>
            {visibleColumns.length > 0 ? visibleColumns.map(({ column }) => {
              const columnSortDirection = sortState?.key === column.key ? sortState.direction : undefined;
              return (
                <th
                  key={column.key}
                  className={[column.className, column.headerClassName].filter(Boolean).join(' ') || undefined}
                  data-align={column.align || 'left'}
                  data-column-key={column.key}
                  data-sortable={column.sortable ? 'true' : undefined}
                  data-sort-state={columnSortDirection || undefined}
                  aria-sort={ariaSortValue(column, columnSortDirection)}
                  style={columnStyle(column)}
                  scope="col"
                >
                  {renderHeader(column, columnSortDirection, onSortChange, text)}
                </th>
              );
            }) : (
              <th className="sr-only" scope="col">Columns</th>
            )}
          </tr>
        </thead>
        <tbody>
          {visibleColumns.length === 0 ? (
            <tr>
              <td className="table-empty data-table-hidden-empty" colSpan={visibleColumnCount}>{renderHiddenState()}</td>
            </tr>
          ) : rows.length > 0 ? (
            rows.map((row) => (
              <tr
                key={row.key}
                className={row.className}
                data-selected={row.selected ? 'true' : undefined}
              >
                {renderRowCells(row, visibleColumns)}
              </tr>
            ))
          ) : (
            <tr>
              <td className="table-empty" colSpan={visibleColumnCount}>{emptyLabel}</td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="data-table-mobile-list" aria-label={ariaLabel}>
        {renderMobileRows({
          rows,
          visibleColumns,
          emptyLabel,
          hiddenLabel,
          showAllColumnsLabel,
          onHiddenColumnKeysChange,
          renderHiddenState
        })}
      </div>
    </div>
  );
}

function renderMobileRows({
  rows,
  visibleColumns,
  emptyLabel,
  hiddenLabel,
  showAllColumnsLabel,
  onHiddenColumnKeysChange,
  renderHiddenState
}: {
  rows: DataTableRow[];
  visibleColumns: Array<{ column: DataTableColumn; index: number }>;
  emptyLabel: ReactNode;
  hiddenLabel: ReactNode;
  showAllColumnsLabel: ReactNode;
  onHiddenColumnKeysChange: DataTableProps['onHiddenColumnKeysChange'];
  renderHiddenState: () => ReactNode;
}) {
  if (visibleColumns.length === 0) {
    return (
      <div className="table-empty data-table-mobile-empty data-table-hidden-empty">
        {onHiddenColumnKeysChange ? renderHiddenState() : (
          <>
            <span>{hiddenLabel}</span>
            <span>{showAllColumnsLabel}</span>
          </>
        )}
      </div>
    );
  }

  if (rows.length === 0) {
    return <div className="table-empty data-table-mobile-empty">{emptyLabel}</div>;
  }

  return rows.map((row) => renderMobileCard(row, visibleColumns));
}

function renderMobileCard(
  row: DataTableRow,
  visibleColumns: Array<{ column: DataTableColumn; index: number }>
) {
  const items = visibleColumns.map(({ column, index }, visibleIndex) => {
    const cell = normalizeCell(row.cells[index]);
    return {
      column,
      cell,
      visibleIndex,
      align: cell.align || column.align || 'left',
      label: mobileColumnLabel(column)
    };
  });
  const spanningItem = items.find((item) => (item.cell.colSpan || 1) >= visibleColumns.length);
  if (spanningItem) {
    return (
      <article
        className={['data-table-mobile-card', 'data-table-mobile-card-span', row.className || ''].filter(Boolean).join(' ')}
        data-selected={row.selected ? 'true' : undefined}
        key={row.key}
      >
        <div className={spanningItem.cell.className}>{spanningItem.cell.content}</div>
      </article>
    );
  }

  const mobileItems = items.filter((item) => !item.column.mobileHidden);
  const titleItem = mobileItems.find((item) => item.column.mobileTitle) || mobileItems.find((item) => item.column.key !== 'actions') || mobileItems[0];
  const subtitleItems = mobileItems.filter((item) => item.column.mobileSubtitle && item !== titleItem);
  const badgeItems = mobileItems.filter((item) => item.column.mobileBadge && item !== titleItem && !subtitleItems.includes(item));
  const actionItems = mobileItems.filter((item) => item.column.key === 'actions');
  const summaryItems = new Set([...subtitleItems, ...badgeItems, ...actionItems, titleItem].filter(Boolean));
  const detailItems = mobileItems
    .filter((item) => !summaryItems.has(item))
    .sort((a, b) => (a.column.mobilePriority ?? a.visibleIndex) - (b.column.mobilePriority ?? b.visibleIndex));

  return (
    <article
      className={['data-table-mobile-card', row.className || ''].filter(Boolean).join(' ')}
      data-selected={row.selected ? 'true' : undefined}
      key={row.key}
    >
      <div className="data-table-mobile-card-head">
        <div className="data-table-mobile-card-title-group">
          {titleItem ? (
            <div className="data-table-mobile-card-title">{titleItem.cell.content}</div>
          ) : null}
          {subtitleItems.length > 0 ? (
            <div className="data-table-mobile-card-subtitle">
              {subtitleItems.map((item) => (
                <span key={item.column.key}>{item.cell.content}</span>
              ))}
            </div>
          ) : null}
        </div>
        {badgeItems.length > 0 ? (
          <div className="data-table-mobile-card-badges">
            {badgeItems.map((item) => (
              <span key={item.column.key}>{item.cell.content}</span>
            ))}
          </div>
        ) : null}
      </div>
      {detailItems.length > 0 ? (
        <dl className="data-table-mobile-card-fields">
          {detailItems.map((item) => (
            <div
              className={['data-table-mobile-card-field', item.cell.className || ''].filter(Boolean).join(' ')}
              data-align={item.align}
              key={item.column.key}
              title={item.cell.title}
            >
              <dt>{item.label}</dt>
              <dd>{item.cell.content}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {actionItems.length > 0 ? (
        <div className="data-table-mobile-card-actions">
          {actionItems.map((item) => (
            <div key={item.column.key}>{item.cell.content}</div>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function renderRowCells(
  row: DataTableRow,
  visibleColumns: Array<{ column: DataTableColumn; index: number }>
) {
  const cells: ReactNode[] = [];
  for (let visibleIndex = 0; visibleIndex < visibleColumns.length; visibleIndex += 1) {
    const { column, index } = visibleColumns[visibleIndex];
    const cell = normalizeCell(row.cells[index]);
    const align = cell.align || column.align || 'left';
    const classNames = [column.className, column.cellClassName, cell.className].filter(Boolean).join(' ');
    const colSpan = Math.max(1, Math.min(cell.colSpan || 1, visibleColumns.length - visibleIndex));
    cells.push(
      <td
        key={column.key}
        className={classNames || undefined}
        data-align={align}
        data-column-key={column.key}
        title={cell.title}
        colSpan={colSpan > 1 ? colSpan : undefined}
      >
        {cell.content}
      </td>
    );
    visibleIndex += colSpan - 1;
  }
  return cells;
}

function normalizeCell(cell: ReactNode | DataTableCell | undefined): DataTableCell {
  if (
    cell &&
    typeof cell === 'object' &&
    !isValidElement(cell) &&
    'content' in cell
  ) {
    return cell as DataTableCell;
  }
  return { content: cell ?? '' };
}

function columnStyle(column: DataTableColumn): CSSProperties | undefined {
  if (!column.width && !column.minWidth) return undefined;
  return {
    width: column.width,
    minWidth: column.minWidth
  };
}

function mobileColumnLabel(column: DataTableColumn) {
  return column.mobileLabel ?? column.viewLabel ?? column.header;
}

function renderHeader(
  column: DataTableColumn,
  sortDirection: DataTableSortDirection | undefined,
  onSortChange: DataTableProps['onSortChange'],
  text: ReturnType<typeof useText>
) {
  if (!column.sortable) return column.header;

  const nextDirection: DataTableSortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
  const Icon = sortDirection === 'asc' ? ArrowUp : sortDirection === 'desc' ? ArrowDown : ArrowUpDown;
  const label = column.sortLabel || (typeof column.header === 'string' ? column.header : column.key);
  const directionLabel = nextDirection === 'asc' ? text.common.ascending : text.common.descending;

  return (
    <button
      className="data-table-sort"
      type="button"
      data-sort-state={sortDirection || 'none'}
      disabled={!onSortChange}
      aria-label={text.common.sortBy.replace('{label}', label).replace('{direction}', directionLabel)}
      onClick={() => onSortChange?.({ key: column.key, direction: nextDirection }, column)}
    >
      <span className="data-table-sort-label">{column.header}</span>
      <Icon className="data-table-sort-icon" size={14} aria-hidden="true" />
    </button>
  );
}

function ariaSortValue(column: DataTableColumn, sortDirection: DataTableSortDirection | undefined) {
  if (!column.sortable) return undefined;
  if (sortDirection === 'asc') return 'ascending';
  if (sortDirection === 'desc') return 'descending';
  return 'none';
}
