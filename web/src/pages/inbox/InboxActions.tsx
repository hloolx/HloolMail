import { RefreshCw, Trash2 } from 'lucide-react';
import { IconButton } from '../../components/shared';
import type { InboxText } from './types';

type InboxActionsProps = {
  text: InboxText;
  confirmClear: boolean;
  clearDisabled: boolean;
  isRefetching: boolean;
  onRefresh: () => void;
  onClear: () => void;
};

export function InboxActions({
  text,
  confirmClear,
  clearDisabled,
  isRefetching,
  onRefresh,
  onClear
}: InboxActionsProps) {
  return (
    <div className="flex gap-2">
      <IconButton title={text.common.refresh} onClick={onRefresh} className={isRefetching ? 'is-refetching' : ''}>
        <RefreshCw size={16} />
      </IconButton>
      <IconButton
        title={confirmClear ? `${text.inbox.confirmClear} (3s)` : text.common.clear}
        onClick={onClear}
        disabled={clearDisabled}
        className={confirmClear ? 'text-[var(--bad)]' : ''}
      >
        <Trash2 size={16} />
      </IconButton>
    </div>
  );
}
