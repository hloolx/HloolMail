import { useCallback, useDeferredValue, useEffect, useRef, useState } from 'react';
import type { MessageSummary } from '../../api';

type MailboxSelectionOptions = {
  email: string;
};

export function useMailboxSelection({ email }: MailboxSelectionOptions) {
  const [mailboxSearch, setMailboxSearch] = useState('');
  const mailboxQuery = useDeferredValue(mailboxSearch.trim());
  const [mailboxPage, setMailboxPage] = useState(1);
  const [emailPage, setEmailPage] = useState(1);
  const [selectedID, setSelectedID] = useState('');
  const [pulseIds, setPulseIds] = useState<Set<string>>(new Set());
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const prevIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setMailboxPage(1);
  }, [mailboxQuery]);

  useEffect(() => {
    setEmailPage(1);
    setSelectedID('');
    setPulseIds(new Set());
    prevIdsRef.current = new Set();
  }, [email]);

  useEffect(() => {
    setPulseIds(new Set());
    prevIdsRef.current = new Set();
  }, [emailPage]);

  const resetAfterGenerate = useCallback(() => {
    setSelectedID('');
    setEmailPage(1);
    setMailboxPage(1);
    setMailboxSearch('');
  }, []);

  const trackMessageItems = useCallback((messages?: MessageSummary[]) => {
    if (!messages) {
      prevIdsRef.current = new Set();
      return;
    }
    const currentIds = new Set(messages.map((m) => m.id));
    const newIds = new Set<string>();
    for (const id of currentIds) {
      if (!prevIdsRef.current.has(id)) newIds.add(id);
    }
    const isFirstLoad = prevIdsRef.current.size === 0;
    prevIdsRef.current = currentIds;
    if (newIds.size === 0 || isFirstLoad) return undefined;

    setPulseIds((prev) => {
      const next = new Set(prev);
      for (const id of newIds) next.add(id);
      return next;
    });

    const timer = window.setTimeout(() => {
      setPulseIds((prev) => {
        const next = new Set(prev);
        for (const id of newIds) next.delete(id);
        return next;
      });
    }, 3000);

    return () => window.clearTimeout(timer);
  }, []);

  return {
    mailboxSearch,
    mailboxQuery,
    mailboxPage,
    emailPage,
    selectedID,
    pulseIds,
    confirmingId,
    setMailboxSearch,
    setMailboxPage,
    setEmailPage,
    setSelectedID,
    setConfirmingId,
    resetAfterGenerate,
    trackMessageItems
  };
}
