import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'framer-motion';
import type { Variants } from 'framer-motion';
import { Check, ChevronDown, Copy, Inbox, Loader2, MailOpen, MailPlus, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import type { DomainAvailability, InboxSSEEvent, MailboxInfo, MessageDetail, MessageSummary, PaginatedResponse, PublicDomainItem } from '../api';
import { ApiError, api, parseFromAddress, postJSON } from '../api';
import { useText } from '../locales';
import { useAppStore, type Language } from '../store';
import { useCopyState } from '../hooks/useCopyState';
import { useVisibleRefetchInterval } from '../hooks/useVisibleRefetchInterval';
import { copy } from '../lib/clipboard';
import { domainModeLabel, extractCode, relativeTime } from '../lib/display';
import { sseStream } from '../lib/sse';
import { dissolveContainer, dissolveElement } from '../lib/dissolve';
import { EmptyState, IconButton, PaginationControls } from '../components/shared';
import { MessageDrawer } from './MessageDrawer';

const MAILBOX_PAGE_SIZE = 8;
const EMAIL_PAGE_SIZE = 8;

const mailListVariants = (reduce: boolean, itemCount: number): Variants => ({
  hidden: {},
  show: {
    transition: {
      staggerChildren: reduce || itemCount > 40 ? 0 : 0.03
    }
  }
});

const mailRowVariants = (reduce: boolean): Variants => ({
  hidden: reduce ? { opacity: 0 } : { opacity: 0, y: 8 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: reduce ? 0.08 : 0.22, ease: 'easeOut' }
  }
});

const MAX_GENERATE_EMAIL_CONFLICT_RETRIES = 3;

const isConflictError = (error: Error) => error instanceof ApiError && error.status === 409;

export function InboxPage() {
  const queryClient = useQueryClient();
  const { email, setEmail, apiKey, language, addMailNotification } = useAppStore();
  const shouldReduceMotion = useReducedMotion();
  const text = useText();
  const [prefix, setPrefix] = useState('');
  const [domainName, setDomainName] = useState('');
  const [mailboxSearch, setMailboxSearch] = useState('');
  const mailboxQuery = useDeferredValue(mailboxSearch.trim());
  const [mailboxPage, setMailboxPage] = useState(1);
  const [emailPage, setEmailPage] = useState(1);
  const [selectedID, setSelectedID] = useState('');
  const [pulseIds, setPulseIds] = useState<Set<string>>(new Set());
  const prevIdsRef = useRef<Set<string>>(new Set());
  const mailListRef = useRef<HTMLDivElement>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [emailCopied, markEmailCopied] = useCopyState();
  const mailboxesInterval = useVisibleRefetchInterval(10000);
  const emailsInterval = useVisibleRefetchInterval(5000);
  const generateRequestRef = useRef({ prefix: '', domain: '' });
  const domains = useQuery({
    queryKey: ['domains-available', apiKey],
    queryFn: () => api<DomainAvailability>('/api/domains/available', { apiKey }),
    staleTime: 10_000
  });
  const availabilityGroups = useMemo(
    () => domainAvailabilityGroups(domains.data),
    [domains.data]
  );
  const mailboxes = useQuery({
    queryKey: ['mailboxes', apiKey, mailboxQuery, mailboxPage],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(mailboxPage),
        per_page: String(MAILBOX_PAGE_SIZE)
      });
      if (mailboxQuery) params.set('q', mailboxQuery);
      return api<PaginatedResponse<MailboxInfo>>(`/api/mailboxes?${params.toString()}`, { apiKey });
    },
    staleTime: 10_000,
    refetchInterval: mailboxesInterval
  });
  const emails = useQuery({
    queryKey: ['emails', email, emailPage, apiKey],
    queryFn: () => {
      const params = new URLSearchParams({
        email,
        page: String(emailPage),
        per_page: String(EMAIL_PAGE_SIZE)
      });
      return api<PaginatedResponse<MessageSummary>>(`/api/emails?${params.toString()}`, { apiKey });
    },
    enabled: Boolean(email),
    staleTime: 10_000,
    refetchInterval: emailsInterval
  });
  const mailboxItems = mailboxes.data?.items || [];
  const emailItems = emails.data?.items || [];
  const mailboxTotal = mailboxes.data?.total ?? mailboxItems.length;
  const emailTotal = emails.data?.total ?? emailItems.length;
  const detail = useQuery({
    queryKey: ['email-detail', selectedID, apiKey],
    queryFn: () => api<MessageDetail>(`/api/email/${selectedID}`, { apiKey }),
    enabled: Boolean(selectedID)
  });
  const generate = useMutation({
    mutationFn: () => postJSON<{ email: string; domain_id: number; reuse?: boolean }>('/api/generate-email', generateRequestRef.current, { apiKey }),
    onMutate: () => {
      generateRequestRef.current = { prefix, domain: domainName };
    },
    retry: (failureCount, error) => {
      if (!isConflictError(error) || failureCount >= MAX_GENERATE_EMAIL_CONFLICT_RETRIES) return false;
      generateRequestRef.current = { ...generateRequestRef.current, prefix: '' };
      setPrefix('');
      return true;
    },
    retryDelay: (failureCount) => Math.min(500 * 2 ** failureCount, 2000),
    onSuccess: (data) => {
      setEmail(data.email);
      setSelectedID('');
      setEmailPage(1);
      setMailboxPage(1);
      setMailboxSearch('');
      queryClient.invalidateQueries({ queryKey: ['mailboxes'] });
      toast.success(data.reuse ? text.inbox.emailReuse : text.toast.emailGenerated);
    },
    onError: (error) => toast.error(error.message)
  });
  const clear = useMutation({
    mutationFn: () => api(`/api/emails/clear?email=${encodeURIComponent(email)}`, { method: 'DELETE', apiKey }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emails'] });
      queryClient.invalidateQueries({ queryKey: ['mailboxes'] });
      setSelectedID('');
      setEmailPage(1);
      toast.success(text.toast.inboxCleared);
    },
    onError: (error) => toast.error(error.message)
  });
  const deleteMailbox = useMutation({
    mutationFn: (mailbox: MailboxInfo) => api(`/api/mailboxes/${mailbox.id}`, { method: 'DELETE', apiKey }),
    onSuccess: (_data, mailbox) => {
      queryClient.invalidateQueries({ queryKey: ['mailboxes'] });
      if (mailbox.email === email) {
        setEmail('');
        setSelectedID('');
      }
      if (mailboxItems.length <= 1 && mailboxPage > 1) {
        setMailboxPage((page) => Math.max(1, page - 1));
      }
      toast.success(text.inbox.mailboxDeleted);
    },
    onError: (error) => toast.error(error.message)
  });

  const sseErrorCooldownRef = useRef(0);
  const [sseGen, setSseGen] = useState(0);
  const toastNewMailRef = useRef(text.toast.newMail);
  toastNewMailRef.current = text.toast.newMail;

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
    if (mailboxes.data && mailboxes.data.page !== mailboxPage) {
      setMailboxPage(mailboxes.data.page);
    }
  }, [mailboxes.data, mailboxPage]);

  useEffect(() => {
    if (emails.data && emails.data.page !== emailPage) {
      setEmailPage(emails.data.page);
    }
  }, [emails.data, emailPage]);

  useEffect(() => {
    setPulseIds(new Set());
    prevIdsRef.current = new Set();
  }, [emailPage]);

  useEffect(() => {
    if (!email) return;
    const controller = new AbortController();
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    const url = new URL('/api/inbox-stream', window.location.origin);
    url.searchParams.set('email', email);
    void (async () => {
      try {
        for await (const event of sseStream<InboxSSEEvent>(url.toString(), { signal: controller.signal })) {
          setEmailPage(1);
          queryClient.invalidateQueries({ queryKey: ['emails'] });
          queryClient.invalidateQueries({ queryKey: ['mailboxes'] });
          toast.info(toastNewMailRef.current);
          const parsed = parseFromAddress(event.from);
          addMailNotification({
            id: event.id,
            from_address: parsed.from_address,
            from_name: parsed.from_name,
            subject: event.subject,
            mailbox_email: event.recipient,
            created_at: event.created_at
          });
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        const now = Date.now();
        if (now - sseErrorCooldownRef.current < 30000) return;
        sseErrorCooldownRef.current = now;
        toast.error(error instanceof Error ? error.message : String(error));
        reconnectTimer = setTimeout(() => setSseGen((g) => g + 1), 5000);
      }
    })();
    return () => {
      controller.abort();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [email, queryClient, sseGen]);

  useEffect(() => {
    if (!emails.data) {
      prevIdsRef.current = new Set();
      return;
    }
    const currentIds = new Set(emails.data.items.map((m) => m.id));
    const newIds = new Set<string>();
    for (const id of currentIds) {
      if (!prevIdsRef.current.has(id)) newIds.add(id);
    }
    const isFirstLoad = prevIdsRef.current.size === 0;
    prevIdsRef.current = currentIds;
    if (newIds.size === 0 || isFirstLoad) return;
    setPulseIds((prev) => {
      const next = new Set(prev);
      for (const id of newIds) next.add(id);
      return next;
    });
    const timer = setTimeout(() => {
      setPulseIds((prev) => {
        const next = new Set(prev);
        for (const id of newIds) next.delete(id);
        return next;
      });
    }, 3000);
    return () => clearTimeout(timer);
  }, [emails.data]);

  return (
    <div className="inbox-layout grid gap-4 xl:grid-cols-[minmax(0,1fr)_30rem]">
      <section className="panel min-w-0">
        <div className="panel-header">
          <div>
            <h2>{text.page.inbox}</h2>
            <p>{email || text.inbox.noEmail}</p>
          </div>
          <div className="flex gap-2">
            <IconButton title={text.common.refresh} onClick={() => emails.refetch()} className={emails.isRefetching ? 'is-refetching' : ''}>
              <RefreshCw size={16} />
            </IconButton>
            <IconButton title={confirmClear ? `${text.inbox.confirmClear} (3s)` : text.common.clear} onClick={async () => {
              if (confirmClear) {
                if (mailListRef.current && emailItems.length > 0) {
                  await dissolveContainer(mailListRef.current, { duration: 700, blockSize: 6 });
                }
                clear.mutate(); setConfirmClear(false);
              }
              else { setConfirmClear(true); setTimeout(() => setConfirmClear(false), 3000); }
            }} disabled={!email || emailTotal === 0} className={confirmClear ? 'text-[var(--bad)]' : ''}>
              <Trash2 size={16} />
            </IconButton>
          </div>
        </div>
        <div className="mb-4 grid gap-2 rounded-lg border border-[var(--border)] bg-[var(--soft)] p-3 md:grid-cols-2 lg:grid-cols-[1fr_14rem_auto]">
          <input className="input" placeholder={text.inbox.customPrefix} aria-label={text.inbox.customPrefix} value={prefix} onChange={(event) => setPrefix(event.target.value)} />
          <select className="input" value={domainName} onChange={(event) => setDomainName(event.target.value)}>
            <option value="">{text.inbox.randomDomain}</option>
            {renderDomainOptions(availabilityGroups.privateDomains, text.domains.modePrivate, language)}
            {renderDomainOptions(availabilityGroups.publicDomains, text.domains.modePublic, language)}
          </select>
          <button className="btn-primary md:col-span-2 lg:col-span-1" onClick={() => generate.mutate()} disabled={generate.isPending}>
            {generate.isPending ? <Loader2 size={16} className="animate-spin" /> : <MailPlus size={16} />}
            {text.inbox.generate}
          </button>
        </div>

        {(mailboxes.isLoading || mailboxSearch || mailboxTotal > 0) && (
          <div className="mb-4">
            <div className="inbox-section-heading">
              <p>{text.inbox.myMailboxes}</p>
              <span>{formatCount(text.inbox.mailboxCount, mailboxTotal)}</span>
            </div>
            <div className="inbox-search">
              <Search size={15} className="shrink-0 text-[var(--muted)]" />
              <input
                className="input inbox-search-input"
                placeholder={text.inbox.searchMailboxes}
                aria-label={text.inbox.searchMailboxes}
                value={mailboxSearch}
                onChange={(event) => setMailboxSearch(event.target.value)}
              />
              {mailboxSearch && (
                <IconButton title={text.common.clear} onClick={() => setMailboxSearch('')}>
                  <X size={15} />
                </IconButton>
              )}
            </div>
            {mailboxes.isLoading ? (
              <EmptyState label={text.common.loading} />
            ) : mailboxItems.length > 0 ? (
              <div className="grid gap-1" role="list">
                {mailboxItems.map((mb) => (
                  <div
                    key={mb.id}
                    className={`mailbox-row ${mb.email === email ? 'mailbox-row-active' : ''}`}
                    role="listitem"
                  >
                    <button
                      className="mailbox-row-main"
                      onClick={() => { setEmail(mb.email); setSelectedID(''); }}
                    >
                      <Inbox size={16} className="shrink-0 text-[var(--muted)]" />
                      <span className="min-w-0 flex-1 truncate font-medium">{mb.email}</span>
                      <span className="badge shrink-0">{mb.message_count}</span>
                    </button>
                    <button
                      className={`mailbox-delete-btn ${confirmingId === mb.id ? 'text-[var(--bad)]' : 'text-[var(--muted)] hover:text-[var(--bad)]'}`}
                      aria-label={confirmingId === mb.id ? text.inbox.confirmDelete : text.inbox.deleteMailbox}
                      title={confirmingId === mb.id ? `${text.inbox.confirmDelete} (3s)` : text.inbox.deleteMailbox}
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (confirmingId === mb.id) {
                          const row = (e.currentTarget as HTMLElement).closest('.mailbox-row') as HTMLElement | null;
                          setConfirmingId(null);
                          deleteMailbox.mutate(mb, {
                            onSuccess: async () => {
                              if (row && row.isConnected) await dissolveElement(row, { duration: 400, blockSize: 4, direction: 'out' });
                            }
                          });
                        }
                        else { setConfirmingId(mb.id); setTimeout(() => setConfirmingId((id) => id === mb.id ? null : id), 3000); }
                      }}
                    >
                      {confirmingId === mb.id ? <Trash2 size={14} /> : <X size={14} />}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState label={mailboxSearch ? text.inbox.mailboxSearchEmpty : text.inbox.start} />
            )}
            <PaginationControls
              page={mailboxes.data?.page || 1}
              totalPages={mailboxes.data?.total_pages || 1}
              onPageChange={setMailboxPage}
            />
          </div>
        )}

        {email && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-2">
            <code className="min-w-0 flex-1 truncate px-2 text-sm">{email}</code>
            <IconButton title={emailCopied ? text.common.copied : text.inbox.copyEmail} onClick={() => { copy(email); markEmailCopied(); }}>
              {emailCopied ? <Check size={16} /> : <Copy size={16} />}
            </IconButton>
          </div>
        )}

        <div className="inbox-section-heading">
          <p>{text.inbox.messages}</p>
          <span>{formatCount(text.inbox.messageCount, emailTotal)}</span>
        </div>
        <motion.div ref={mailListRef} className="mail-list" variants={mailListVariants(Boolean(shouldReduceMotion), emailItems.length)} initial="hidden" animate="show" role="list">
          {emailItems.map((message) => {
            const code = extractCode(message);
            const expanded = selectedID === message.id;
            return (
              <motion.div
                key={message.id}
                variants={mailRowVariants(Boolean(shouldReduceMotion))}
                className="mail-row-card"
                style={pulseIds.has(message.id) ? { animation: 'mail-pulse 2.5s ease-out both' } : undefined}
                role="listitem"
              >
                <button
                  className={`mail-row ${expanded ? 'mail-row-active' : ''}`}
                  onClick={() => setSelectedID(expanded ? '' : message.id)}
                  aria-expanded={expanded}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {expanded ? <MailOpen size={15} className="shrink-0 text-[var(--focus)]" /> : null}
                      <span className="truncate text-sm font-medium">{message.subject || text.common.noSubject}</span>
                      {code && <span className="badge strong">{code}</span>}
                    </div>
                    <div className="truncate text-xs text-[var(--muted)]">
                      {message.from_address || 'unknown'}
                    </div>
                  </div>
                  <div className="mail-row-side">
                    <time className="text-xs text-[var(--muted)]">{relativeTime(message.created_at)}</time>
                    <ChevronDown size={15} className={expanded ? 'rotate-180' : ''} />
                  </div>
                </button>
                {expanded && (
                  <motion.div
                    className="mail-row-details"
                    initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
                    animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, height: 'auto' }}
                    transition={{ duration: shouldReduceMotion ? 0.08 : 0.18, ease: 'easeOut' }}
                  >
                    <div className="truncate">{message.recipient}</div>
                    {message.preview && <p>{message.preview}</p>}
                  </motion.div>
                )}
              </motion.div>
            );
          })}
          {email && (emails.isLoading || emails.isFetching) && emailItems.length === 0 && <EmptyState label={text.common.loading} />}
          {email && !emails.isLoading && !emails.isFetching && emailItems.length === 0 && <EmptyState label={text.inbox.empty} />}
          {!email && <EmptyState label={text.inbox.start} />}
        </motion.div>
        {email && (
          <PaginationControls
            page={emails.data?.page || 1}
            totalPages={emails.data?.total_pages || 1}
            onPageChange={(page) => {
              setSelectedID('');
              setEmailPage(page);
            }}
          />
        )}
      </section>
      <MessageDrawer message={selectedID ? detail.data : undefined} loading={Boolean(selectedID) && detail.isLoading} apiKey={apiKey} />
    </div>
  );
}

function domainAvailabilityGroups(data?: DomainAvailability) {
  if (!data) return { publicDomains: [] as PublicDomainItem[], privateDomains: [] as PublicDomainItem[] };
  if ('domains' in data) {
    return {
      publicDomains: data.domains.map((domain) => ({ domain, mode: 'public' as const })),
      privateDomains: [] as PublicDomainItem[]
    };
  }
  return {
    publicDomains: data.public_domains || [],
    privateDomains: data.private_domains || []
  };
}

function renderDomainOptions(domains: PublicDomainItem[], label: string, language: Language) {
  if (!domains.length) return null;
  return (
    <optgroup label={label}>
      {domains.map((domain) => (
        <option key={domain.id ?? domain.domain} value={domain.domain}>
          {domain.domain} - {domainModeLabel(domain.mode, language)}
        </option>
      ))}
    </optgroup>
  );
}

function formatCount(template: string, count: number) {
  return template.replace('{count}', new Intl.NumberFormat().format(count));
}
