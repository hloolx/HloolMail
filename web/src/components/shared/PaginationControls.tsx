import { ChevronDown } from 'lucide-react';
import { useText } from '../../locales';

interface PaginationControlsProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export function PaginationControls({ page, totalPages, onPageChange }: PaginationControlsProps) {
  const text = useText();
  if (totalPages <= 1) return null;
  return (
    <div className="pagination">
      <button className="btn-ghost" disabled={page <= 1} onClick={() => onPageChange(Math.max(1, page - 1))}>
        <ChevronDown className="rotate-90" size={14} />
        {text.dashboard.prev}
      </button>
      <span className="pagination-info">
        {text.dashboard.pageOf.replace('{current}', String(page)).replace('{total}', String(totalPages))}
      </span>
      <button className="btn-ghost" disabled={page >= totalPages} onClick={() => onPageChange(Math.min(totalPages, page + 1))}>
        {text.dashboard.next}
        <ChevronDown className="-rotate-90" size={14} />
      </button>
    </div>
  );
}
