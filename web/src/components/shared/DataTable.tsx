import { isValidElement, type CSSProperties, type ReactNode } from 'react';

export type DataTableColumn = {
  key: string;
  header: ReactNode;
  align?: 'left' | 'center' | 'right';
  width?: string;
  minWidth?: string;
  className?: string;
  headerClassName?: string;
  cellClassName?: string;
};

export type DataTableCell = {
  content: ReactNode;
  align?: 'left' | 'center' | 'right';
  className?: string;
  title?: string;
};

export type DataTableRow = {
  key: string | number;
  cells: Array<ReactNode | DataTableCell>;
  className?: string;
  selected?: boolean;
};

type DataTableProps = {
  columns: DataTableColumn[];
  rows: DataTableRow[];
  emptyLabel?: ReactNode;
  ariaLabel?: string;
  className?: string;
  density?: 'default' | 'compact';
  stickyHeader?: boolean;
};

export function DataTable({
  columns,
  rows,
  emptyLabel = '-',
  ariaLabel,
  className,
  density = 'default',
  stickyHeader = true
}: DataTableProps) {
  const tableClassName = [
    'data-table',
    `data-table-${density}`,
    stickyHeader ? 'data-table-sticky' : '',
    className || ''
  ].filter(Boolean).join(' ');

  return (
    <div className="table-wrap data-table-shell">
      <table className={tableClassName} aria-label={ariaLabel}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                className={[column.className, column.headerClassName].filter(Boolean).join(' ') || undefined}
                data-align={column.align || 'left'}
                style={columnStyle(column)}
                scope="col"
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length > 0 ? (
            rows.map((row) => (
              <tr
                key={row.key}
                className={row.className}
                data-selected={row.selected ? 'true' : undefined}
              >
                {columns.map((column, cellIndex) => {
                  const cell = normalizeCell(row.cells[cellIndex]);
                  const align = cell.align || column.align || 'left';
                  const classNames = [column.className, column.cellClassName, cell.className].filter(Boolean).join(' ');
                  return (
                    <td
                      key={column.key}
                      className={classNames || undefined}
                      data-align={align}
                      title={cell.title}
                    >
                      {cell.content}
                    </td>
                  );
                })}
              </tr>
            ))
          ) : (
            <tr>
              <td className="table-empty" colSpan={Math.max(columns.length, 1)}>{emptyLabel}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
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
