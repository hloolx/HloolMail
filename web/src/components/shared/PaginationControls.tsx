import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useText } from '../../locales';

interface PaginationControlsProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
}

type PageItem = number | 'start-gap' | 'end-gap';

export function PaginationControls({ page, totalPages, onPageChange, className }: PaginationControlsProps) {
  const text = useText();
  const safeTotal = Math.max(1, Math.floor(totalPages || 1));
  const safePage = Math.min(Math.max(1, Math.floor(page || 1)), safeTotal);
  const pageItems = paginationItems(safePage, safeTotal);

  if (safeTotal <= 1) return null;

  const goToPage = (nextPage: number) => {
    const target = Math.min(Math.max(1, nextPage), safeTotal);
    if (target !== safePage) onPageChange(target);
  };

  return (
    <nav className={['pagination', className || ''].filter(Boolean).join(' ')} aria-label="Pagination">
      <span className="pagination-info">
        {text.dashboard.pageOf.replace('{current}', String(safePage)).replace('{total}', String(safeTotal))}
      </span>
      <div className="pagination-controls">
        <button className="pagination-btn" disabled={safePage <= 1} onClick={() => goToPage(1)} title={text.dashboard.prev} aria-label={text.dashboard.prev}>
          <ChevronsLeft size={15} aria-hidden="true" />
          <span className="sr-only">{text.dashboard.prev}</span>
        </button>
        <button className="pagination-btn" disabled={safePage <= 1} onClick={() => goToPage(safePage - 1)} title={text.dashboard.prev} aria-label={text.dashboard.prev}>
          <ChevronLeft size={15} aria-hidden="true" />
          <span className="sr-only">{text.dashboard.prev}</span>
        </button>
        <div className="pagination-pages" aria-hidden={safeTotal <= 1}>
          {pageItems.map((item) => item === 'start-gap' || item === 'end-gap' ? (
            <span className="pagination-gap" key={item}>...</span>
          ) : (
            <button
              className="pagination-page"
              key={item}
              type="button"
              aria-current={item === safePage ? 'page' : undefined}
              onClick={() => goToPage(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <button className="pagination-btn" disabled={safePage >= safeTotal} onClick={() => goToPage(safePage + 1)} title={text.dashboard.next} aria-label={text.dashboard.next}>
          <ChevronRight size={15} aria-hidden="true" />
          <span className="sr-only">{text.dashboard.next}</span>
        </button>
        <button className="pagination-btn" disabled={safePage >= safeTotal} onClick={() => goToPage(safeTotal)} title={text.dashboard.next} aria-label={text.dashboard.next}>
          <ChevronsRight size={15} aria-hidden="true" />
          <span className="sr-only">{text.dashboard.next}</span>
        </button>
      </div>
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
