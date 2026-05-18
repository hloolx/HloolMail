import type { ReactNode } from 'react';

export type DataTableColumn = {
  key: string;
  header: ReactNode;
};

export type DataTableRow = {
  key: string | number;
  cells: ReactNode[];
};

export function DataTable({ columns, rows, emptyLabel = '-' }: { columns: DataTableColumn[]; rows: DataTableRow[]; emptyLabel?: ReactNode }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{columns.map((column) => <th key={column.key}>{column.header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length > 0 ? (
            rows.map((row) => (
              <tr key={row.key}>{row.cells.map((cell, cellIndex) => <td key={columns[cellIndex].key}>{cell}</td>)}</tr>
            ))
          ) : (
            <tr>
              <td className="table-empty" colSpan={columns.length}>{emptyLabel}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
