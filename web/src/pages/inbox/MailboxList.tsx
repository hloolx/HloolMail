import type { Dispatch, SetStateAction } from 'react';
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
  total: number;
  page: number;
  totalPages: number;
  isLoading: boolean;
  confirmingId: number | null;
  onSearchChange: (value: string) => void;
  onPageChange: (page: number) => void;
  onSelectMailbox: (email: string) => void;
  onDeleteMailbox: (mailbox: MailboxInfo, row: HTMLElement | null) => void;
  setConfirmingId: Dispatch<SetStateAction<number | null>>;
};

export function MailboxList({
  text,
  items,
  selectedEmail,
  search,
  total,
  page,
  totalPages,
  isLoading,
  confirmingId,
  onSearchChange,
  onPageChange,
  onSelectMailbox,
  onDeleteMailbox,
  setConfirmingId
}: MailboxListProps) {
  if (!isLoading && !search && total <= 0) return null;

  return (
    <div className="mb-4">
      <div className="inbox-section-heading">
        <p>{text.inbox.myMailboxes}</p>
        <span>{formatCount(text.inbox.mailboxCount, total)}</span>
      </div>
      <div className="inbox-search">
        <Search size={15} className="shrink-0 text-[var(--muted)]" />
        <input
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
      {isLoading ? (
        <EmptyState label={text.common.loading} />
      ) : items.length > 0 ? (
        <div className="grid gap-1" role="list">
          {items.map((mailbox) => (
            <MailboxRow
              key={mailbox.id}
              text={text}
              mailbox={mailbox}
              active={mailbox.email === selectedEmail}
              confirming={confirmingId === mailbox.id}
              onSelect={() => onSelectMailbox(mailbox.email)}
              onDelete={(row) => onDeleteMailbox(mailbox, row)}
              setConfirmingId={setConfirmingId}
            />
          ))}
        </div>
      ) : (
        <EmptyState label={search ? text.inbox.mailboxSearchEmpty : text.inbox.start} />
      )}
      <PaginationControls
        page={page}
        totalPages={totalPages}
        onPageChange={onPageChange}
      />
    </div>
  );
}

type MailboxRowProps = {
  text: InboxText;
  mailbox: MailboxInfo;
  active: boolean;
  confirming: boolean;
  onSelect: () => void;
  onDelete: (row: HTMLElement | null) => void;
  setConfirmingId: Dispatch<SetStateAction<number | null>>;
};

export function MailboxRow({
  text,
  mailbox,
  active,
  confirming,
  onSelect,
  onDelete,
  setConfirmingId
}: MailboxRowProps) {
  return (
    <div
      className={`mailbox-row ${active ? 'mailbox-row-active' : ''}`}
      role="listitem"
    >
      <button
        className="mailbox-row-main"
        onClick={onSelect}
      >
        <Inbox size={16} className="shrink-0 text-[var(--muted)]" />
        <span className="min-w-0 flex-1 truncate font-medium">{mailbox.email}</span>
        <span className="badge shrink-0">{mailbox.message_count}</span>
      </button>
      <button
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
    </div>
  );
}
