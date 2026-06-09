import type { Dispatch, RefObject, SetStateAction } from 'react';
import { Inbox, Search, Trash2, X } from 'lucide-react';
import type { MailboxInfo } from '../../api';
import { EmptyState, IconButton, PaginationControls } from '../../components/shared';
import { formatCount } from './utils';
import type { InboxText } from './types';

type MailboxListProps = {
  text: InboxText;
  items: MailboxInfo[];
  selectedEmail: string;
  search: string;
  searchInputRef?: RefObject<HTMLInputElement | null>;
  total: number;
  page: number;
  totalPages: number;
  isLoading: boolean;
  error: unknown;
  showWhenEmpty?: boolean;
  emptyLabel?: string;
  searchEmptyLabel?: string;
  onRetry: () => void;
  confirmingId?: number | null;
  onSearchChange: (value: string) => void;
  onPageChange: (page: number) => void;
  onSelectMailbox: (mailbox: MailboxInfo) => void;
  onDeleteMailbox?: (mailbox: MailboxInfo, row: HTMLElement | null) => void;
  setConfirmingId?: Dispatch<SetStateAction<number | null>>;
};

export function MailboxList({
  text,
  items,
  selectedEmail,
  search,
  searchInputRef,
  total,
  page,
  totalPages,
  isLoading,
  error,
  showWhenEmpty = false,
  emptyLabel,
  searchEmptyLabel,
  onRetry,
  confirmingId,
  onSearchChange,
  onPageChange,
  onSelectMailbox,
  onDeleteMailbox,
  setConfirmingId
}: MailboxListProps) {
  const showDeleteAction = Boolean(onDeleteMailbox && setConfirmingId);
  if (!showWhenEmpty && !isLoading && !error && !search && total <= 0) return null;

  return (
    <div className="inbox-list-section inbox-mailbox-list-section">
      <div className="inbox-section-heading">
        <p>{text.inbox.myMailboxes}</p>
        <span>{formatCount(text.inbox.mailboxCount, total)}</span>
      </div>
      <div className="inbox-search">
        <Search size={15} className="shrink-0 text-[var(--muted)]" />
        <input
          ref={searchInputRef}
          className="input inbox-search-input"
          placeholder={text.inbox.searchMailboxes}
          aria-label={text.inbox.searchMailboxes}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
        />
        {search && (
          <IconButton title={text.common.clear} onClick={() => onSearchChange('')}>
            <X size={15} />
          </IconButton>
        )}
      </div>
      {error ? (
        <InboxListError label={readErrorMessage(error)} actionLabel={text.common.refresh} onRetry={onRetry} />
      ) : isLoading ? (
        <EmptyState label={text.common.loading} />
      ) : items.length > 0 ? (
        <div className="inbox-scroll-list inbox-mailbox-list" role="list">
          {items.map((mailbox) => (
            <MailboxRow
              key={mailbox.id}
              text={text}
              mailbox={mailbox}
              active={mailbox.email === selectedEmail}
              confirming={showDeleteAction && confirmingId === mailbox.id}
              onSelect={() => onSelectMailbox(mailbox)}
              onDelete={showDeleteAction ? (row) => onDeleteMailbox?.(mailbox, row) : undefined}
              setConfirmingId={setConfirmingId}
              showDeleteAction={showDeleteAction}
            />
          ))}
        </div>
      ) : (
        <EmptyState label={search ? (searchEmptyLabel || text.inbox.mailboxSearchEmpty) : (emptyLabel || text.inbox.start)} />
      )}
      <PaginationControls
        page={page}
        totalPages={totalPages}
        onPageChange={onPageChange}
      />
    </div>
  );
}

function InboxListError({ label, actionLabel, onRetry }: { label: string; actionLabel: string; onRetry: () => void }) {
  return (
    <div className="inbox-list-error" role="alert">
      <span>{label}</span>
      <button className="btn-secondary btn-sm" type="button" onClick={onRetry}>
        {actionLabel}
      </button>
    </div>
  );
}

function readErrorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : 'Request failed';
}

type MailboxRowProps = {
  text: InboxText;
  mailbox: MailboxInfo;
  active: boolean;
  confirming: boolean;
  onSelect: () => void;
  onDelete?: (row: HTMLElement | null) => void;
  setConfirmingId?: Dispatch<SetStateAction<number | null>>;
  showDeleteAction?: boolean;
};

export function MailboxRow({
  text,
  mailbox,
  active,
  confirming,
  onSelect,
  onDelete,
  setConfirmingId,
  showDeleteAction = true
}: MailboxRowProps) {
  return (
    <div
      className={[
        'mailbox-row',
        active ? 'mailbox-row-active' : '',
        showDeleteAction ? '' : 'mailbox-row-select-only'
      ].filter(Boolean).join(' ')}
      role="listitem"
    >
      <button
        type="button"
        className="mailbox-row-main"
        onClick={onSelect}
      >
        <Inbox size={16} className="shrink-0 text-[var(--muted)]" />
        <span className="min-w-0 flex-1 truncate font-medium">{mailbox.email}</span>
        <span className="badge shrink-0">{mailbox.message_count}</span>
      </button>
      {showDeleteAction && onDelete && setConfirmingId && (
        <button
          type="button"
          className={`mailbox-delete-btn ${confirming ? 'text-[var(--bad)]' : 'text-[var(--muted)] hover:text-[var(--bad)]'}`}
          aria-label={confirming ? text.inbox.confirmDelete : text.inbox.deleteMailbox}
          title={confirming ? `${text.inbox.confirmDelete} (3s)` : text.inbox.deleteMailbox}
          onClick={(event) => {
            event.stopPropagation();
            if (confirming) {
              const row = (event.currentTarget as HTMLElement).closest('.mailbox-row') as HTMLElement | null;
              setConfirmingId(null);
              onDelete(row);
            } else {
              setConfirmingId(mailbox.id);
              setTimeout(() => setConfirmingId((id) => id === mailbox.id ? null : id), 3000);
            }
          }}
        >
          {confirming ? <Trash2 size={14} /> : <X size={14} />}
        </button>
      )}
    </div>
  );
}
