import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { useText } from '../../locales';

export interface PaginationControlsProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
  rowsPerPage?: number;
  rowsPerPageOptions?: number[];
  onRowsPerPageChange?: (rowsPerPage: number) => void;
  rowsPerPageLabel?: ReactNode;
}

type PageItem = number | 'start-gap' | 'end-gap';

export function PaginationControls({
  page,
  totalPages,
  onPageChange,
  className,
  rowsPerPage,
  rowsPerPageOptions,
  onRowsPerPageChange,
  rowsPerPageLabel
}: PaginationControlsProps) {
  const text = useText();
  const resolvedRowsPerPageLabel = rowsPerPageLabel ?? text.common.rowsPerPage;
  const safeTotal = Math.max(1, Math.floor(totalPages || 1));
  const safePage = Math.min(Math.max(1, Math.floor(page || 1)), safeTotal);
  const pageSizeOptions = normalizedRowsPerPageOptions(rowsPerPageOptions, rowsPerPage);
  const safeRowsPerPage = normalizePositiveInteger(rowsPerPage);
  const showRowsPerPage = Boolean(safeRowsPerPage && onRowsPerPageChange && pageSizeOptions.length > 0);
  const pageItems = paginationItems(safePage, safeTotal);
  const compactPageItems = compactPaginationItems(safePage, safeTotal);
  const pageLabel = (targetPage: number) => text.dashboard.pageOf
    .replace('{current}', String(targetPage))
    .replace('{total}', String(safeTotal));

  if (safeTotal <= 1 && !showRowsPerPage) return null;

  const goToPage = (nextPage: number) => {
    const target = Math.min(Math.max(1, nextPage), safeTotal);
    if (target !== safePage) onPageChange(target);
  };

  const changeRowsPerPage = (nextRowsPerPage: number) => {
    if (nextRowsPerPage !== safeRowsPerPage) {
      onRowsPerPageChange?.(nextRowsPerPage);
    }
  };

  const renderPageItems = (items: PageItem[], keyPrefix: string) => items.map((item) => item === 'start-gap' || item === 'end-gap' ? (
    <span className="pagination-gap" key={`${keyPrefix}-${item}`}>...</span>
  ) : (
    <button
      className="pagination-page"
      key={`${keyPrefix}-${item}`}
      type="button"
      aria-current={item === safePage ? 'page' : undefined}
      aria-label={pageLabel(item)}
      onClick={() => goToPage(item)}
    >
      {item}
    </button>
  ));

  return (
    <nav className={['pagination', className || ''].filter(Boolean).join(' ')} aria-label={text.common.pagination}>
      {showRowsPerPage ? (
        <div className="pagination-meta">
          <label className="pagination-page-size">
            <span>{resolvedRowsPerPageLabel}</span>
            <select
              value={safeRowsPerPage}
              aria-label={typeof resolvedRowsPerPageLabel === 'string' ? resolvedRowsPerPageLabel : text.common.rowsPerPage}
              onChange={(event) => changeRowsPerPage(Number(event.currentTarget.value))}
            >
              {pageSizeOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
          <span className="pagination-info">
            {pageLabel(safePage)}
          </span>
        </div>
      ) : (
        <span className="pagination-info">
          {pageLabel(safePage)}
        </span>
      )}
      {safeTotal > 1 ? (
        <div className="pagination-controls">
          <button className="pagination-btn" type="button" disabled={safePage <= 1} onClick={() => goToPage(1)} title={pageLabel(1)} aria-label={pageLabel(1)}>
            <ChevronsLeft size={15} aria-hidden="true" />
            <span className="sr-only">{pageLabel(1)}</span>
          </button>
          <button className="pagination-btn" type="button" disabled={safePage <= 1} onClick={() => goToPage(safePage - 1)} title={text.dashboard.prev} aria-label={text.dashboard.prev}>
            <ChevronLeft size={15} aria-hidden="true" />
            <span className="sr-only">{text.dashboard.prev}</span>
          </button>
          <div className="pagination-pages pagination-pages-full">
            {renderPageItems(pageItems, 'full')}
          </div>
          <div className="pagination-pages pagination-pages-compact">
            {renderPageItems(compactPageItems, 'compact')}
          </div>
          <button className="pagination-btn" type="button" disabled={safePage >= safeTotal} onClick={() => goToPage(safePage + 1)} title={text.dashboard.next} aria-label={text.dashboard.next}>
            <ChevronRight size={15} aria-hidden="true" />
            <span className="sr-only">{text.dashboard.next}</span>
          </button>
          <button className="pagination-btn" type="button" disabled={safePage >= safeTotal} onClick={() => goToPage(safeTotal)} title={pageLabel(safeTotal)} aria-label={pageLabel(safeTotal)}>
            <ChevronsRight size={15} aria-hidden="true" />
            <span className="sr-only">{pageLabel(safeTotal)}</span>
          </button>
        </div>
      ) : null}
    </nav>
  );
}

function paginationItems(page: number, totalPages: number): PageItem[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const items = new Set<number>([1, totalPages, page - 1, page, page + 1]);
  if (page <= 3) {
    items.add(2);
    items.add(3);
    items.add(4);
  }
  if (page >= totalPages - 2) {
    items.add(totalPages - 1);
    items.add(totalPages - 2);
    items.add(totalPages - 3);
  }

  const sorted = [...items]
    .filter((item) => item >= 1 && item <= totalPages)
    .sort((a, b) => a - b);

  return sorted.reduce<PageItem[]>((result, item, index) => {
    const previous = sorted[index - 1];
    if (index > 0 && item - previous > 1) {
      result.push(previous === 1 ? 'start-gap' : 'end-gap');
    }
    result.push(item);
    return result;
  }, []);
}

function compactPaginationItems(page: number, totalPages: number): PageItem[] {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  if (page <= 3) {
    return [1, 2, 3, 'end-gap', totalPages];
  }

  if (page >= totalPages - 2) {
    return [1, 'start-gap', totalPages - 2, totalPages - 1, totalPages];
  }

  return [1, 'start-gap', page, 'end-gap', totalPages];
}

function normalizedRowsPerPageOptions(options: number[] | undefined, rowsPerPage: number | undefined) {
  const values = options?.length ? options : [10, 20, 50];
  return uniquePositiveIntegers([...values, rowsPerPage]);
}

function uniquePositiveIntegers(values: Array<number | undefined>) {
  const result: number[] = [];
  for (const value of values) {
    const normalized = normalizePositiveInteger(value);
    if (normalized && !result.includes(normalized)) {
      result.push(normalized);
    }
  }
  return result;
}

function normalizePositiveInteger(value: number | undefined) {
  if (!Number.isFinite(value)) return undefined;
  const normalized = Math.floor(Number(value));
  return normalized > 0 ? normalized : undefined;
}
