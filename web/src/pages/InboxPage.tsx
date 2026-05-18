import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'framer-motion';
import type { Variants } from 'framer-motion';
import { Check, Copy, Inbox, Loader2, MailPlus, RefreshCw, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import type { Domain, DomainAvailability, MailboxInfo, MessageDetail, MessageSummary } from '../api';
import { ApiError, api, postJSON } from '../api';
import { useText } from '../locales';
import { useAppStore, type Language } from '../store';
import { useCopyState } from '../hooks/useCopyState';
import { useVisibleRefetchInterval } from '../hooks/useVisibleRefetchInterval';
import { copy } from '../lib/clipboard';
import { domainModeLabel, extractCode, relativeTime } from '../lib/display';
import { sseStream } from '../lib/sse';
import { EmptyState, IconButton } from '../components/shared';

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
  const { email, setEmail, apiKey, language } = useAppStore();
  const shouldReduceMotion = useReducedMotion();
  const text = useText();
  const [prefix, setPrefix] = useState('');
  const [domainName, setDomainName] = useState('');
  const [selectedID, setSelectedID] = useState('');
  const [pulseIds, setPulseIds] = useState<Set<string>>(new Set());
  const prevIdsRef = useRef<Set<string>>(new Set());
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [emailCopied, markEmailCopied] = useCopyState();
  const mailboxesInterval = useVisibleRefetchInterval(10000);
  const emailsInterval = useVisibleRefetchInterval(5000);
  const generateRequestRef = useRef({ prefix: '', domain: '' });
  const domains = useQuery({
    queryKey: ['domains-available', apiKey],
    queryFn: () => api<DomainAvailability>('/api/domains/available', { apiKey })
  });
  const mailboxes = useQuery({
    queryKey: ['mailboxes', apiKey],
    queryFn: () => api<MailboxInfo[]>('/api/mailboxes', { apiKey }),
    refetchInterval: mailboxesInterval
  });
  const emails = useQuery({
    queryKey: ['emails', email, apiKey],
    queryFn: () => api<MessageSummary[]>(`/api/emails?email=${encodeURIComponent(email)}`, { apiKey }),
    enabled: Boolean(email),
    refetchInterval: emailsInterval
  });
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
      queryClient.invalidateQueries({ queryKey: ['mailboxes'] });
      toast.success(data.reuse ? text.inbox.emailReuse : text.toast.emailGenerated);
    },
    onError: (error) => toast.error(error.message)
  });
  const clear = useMutation({
    mutationFn: () => api(`/api/emails/clear?email=${encodeURIComponent(email)}`, { method: 'DELETE', apiKey }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emails'] });
      setSelectedID('');
      toast.success(text.toast.inboxCleared);
    },
    onError: (error) => toast.error(error.message)
  });
  const deleteMailbox = useMutation({
    mutationFn: (id: number) => api(`/api/mailboxes/${id}`, { method: 'DELETE', apiKey }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mailboxes'] });
      if ((mailboxes.data || []).length <= 1) setEmail('');
      toast.success(text.inbox.mailboxDeleted);
    },
    onError: (error) => toast.error(error.message)
  });

  const sseErrorCooldownRef = useRef(0);

  useEffect(() => {
    if (!email) return;
    const controller = new AbortController();
    const url = new URL('/api/inbox-stream', window.location.origin);
    url.searchParams.set('email', email);
    void (async () => {
      try {
        for await (const _event of sseStream(url.toString(), { apiKey, signal: controller.signal })) {
          queryClient.invalidateQueries({ queryKey: ['emails'] });
          toast.info(text.toast.newMail);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        const now = Date.now();
        if (now - sseErrorCooldownRef.current < 30000) return;
        sseErrorCooldownRef.current = now;
        toast.error(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => controller.abort();
  }, [email, apiKey, queryClient, text.toast.newMail]);

  useEffect(() => {
    if (!emails.data) {
      prevIdsRef.current = new Set();
      return;
    }
    const currentIds = new Set(emails.data.map((m) => m.id));
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
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_28rem]">
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>{text.page.inbox}</h2>
            <p>{email || text.inbox.noEmail}</p>
          </div>
          <div className="flex gap-2">
            <IconButton title={text.common.refresh} onClick={() => emails.refetch()} className={emails.isRefetching ? 'is-refetching' : ''}>
              <RefreshCw size={16} />
            </IconButton>
            <IconButton title={confirmClear ? text.inbox.confirmClear : text.common.clear} onClick={() => {
              if (confirmClear) { clear.mutate(); setConfirmClear(false); }
              else { setConfirmClear(true); setTimeout(() => setConfirmClear(false), 3000); }
            }} disabled={!email || !(emails.data || []).length} className={confirmClear ? 'text-red-500' : ''}>
              <Trash2 size={16} />
            </IconButton>
          </div>
        </div>
        <div className="mb-4 grid gap-2 rounded-lg border border-[var(--border)] bg-[var(--soft)] p-3 lg:grid-cols-[1fr_14rem_auto]">
          <input className="input" placeholder={text.inbox.customPrefix} value={prefix} onChange={(event) => setPrefix(event.target.value)} />
          <select className="input" value={domainName} onChange={(event) => setDomainName(event.target.value)}>
            <option value="">{text.inbox.randomDomain}</option>
            {renderDomainOptions(domains.data?.private_domains || [], text.domains.modePrivate, language)}
            {renderDomainOptions(domains.data?.public_domains || [], text.domains.modePublic, language)}
          </select>
          <button className="btn-primary" onClick={() => generate.mutate()} disabled={generate.isPending}>
            {generate.isPending ? <Loader2 size={16} className="animate-spin" /> : <MailPlus size={16} />}
            {text.inbox.generate}
          </button>
        </div>
        {(mailboxes.data || []).length > 0 && (
          <div className="mb-4">
            <p className="text-[11px] font-medium tracking-wider uppercase text-[var(--muted)] mb-2">{text.inbox.myMailboxes}</p>
            <div className="grid gap-1">
              {(mailboxes.data || []).map((mb) => (
                <button
                  key={mb.id}
                  className={`flex items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--soft)] ${mb.email === email ? 'bg-[var(--soft)] ring-1 ring-inset ring-[var(--border)]' : ''}`}
                  onClick={() => { setEmail(mb.email); setSelectedID(''); }}
                >
                  <Inbox size={16} className="shrink-0 text-[var(--muted)]" />
                  <span className="min-w-0 flex-1 truncate font-medium">{mb.email}</span>
                  <span className="badge shrink-0">{mb.message_count}</span>
                  <button
                    className={`shrink-0 p-0.5 ${confirmingId === mb.id ? 'text-red-500' : 'text-[var(--muted)] hover:text-red-500'}`}
                    title={confirmingId === mb.id ? text.inbox.confirmDelete : text.inbox.deleteMailbox}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirmingId === mb.id) { deleteMailbox.mutate(mb.id); setConfirmingId(null); }
                      else { setConfirmingId(mb.id); setTimeout(() => setConfirmingId((id) => id === mb.id ? null : id), 3000); }
                    }}
                  >
                    {confirmingId === mb.id ? <Trash2 size={14} /> : <X size={14} />}
                  </button>
                </button>
              ))}
            </div>
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
        <motion.div className="mail-list" variants={mailListVariants(Boolean(shouldReduceMotion), (emails.data || []).length)} initial="hidden" animate="show">
          {(emails.data || []).map((message) => {
            const code = extractCode(message);
            return (
              <motion.button
                key={message.id}
                variants={mailRowVariants(Boolean(shouldReduceMotion))}
                className={`mail-row ${selectedID === message.id ? 'mail-row-active' : ''}`}
                style={pulseIds.has(message.id) ? { animation: 'mail-pulse 2.5s ease-out both' } : undefined}
                onClick={() => setSelectedID(message.id)}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{message.subject || text.common.noSubject}</span>
                    {code && <span className="badge strong">{code}</span>}
                  </div>
                  <div className="truncate text-xs text-[var(--muted)]">
                    {message.from_address || 'unknown'} · {message.preview}
                  </div>
                </div>
                <time className="text-xs text-[var(--muted)]">{relativeTime(message.created_at)}</time>
              </motion.button>
            );
          })}
          {email && !emails.isLoading && (emails.data || []).length === 0 && <EmptyState label={text.inbox.empty} />}
          {!email && <EmptyState label={text.inbox.start} />}
        </motion.div>
      </section>
      <MessageDrawer message={detail.data} loading={detail.isLoading} apiKey={apiKey} />
    </div>
  );
}

function injectApiKeyIntoHtml(html: string, apiKey: string): string {
  if (!apiKey) return html;
  return html.replace(
    /(<a\s[^>]*href\s*=\s*["'])(\/api\/[^"']+)(["'])/gi,
    (_m, prefix, url, suffix) => {
      const sep = url.includes('?') ? '&' : '?';
      return `${prefix}${url}${sep}api_key=${encodeURIComponent(apiKey)}${suffix}`;
    }
  );
}

function renderDomainOptions(domains: Domain[], label: string, language: Language) {
  if (!domains.length) return null;
  return (
    <optgroup label={label}>
      {domains.map((domain) => (
        <option key={domain.id} value={domain.domain}>
          {domain.domain} - {domainModeLabel(domain.mode, language)}
        </option>
      ))}
    </optgroup>
  );
}

function MessageDrawer({ message, loading, apiKey }: { message?: MessageDetail; loading: boolean; apiKey: string }) {
  const text = useText();
  const [codeCopied, markCodeCopied] = useCopyState();
  if (loading) return <aside className="panel min-h-96">{text.common.loading}</aside>;
  if (!message) return <aside className="panel min-h-96 text-sm text-[var(--muted)]">{text.inbox.selectMessage}</aside>;
  return (
    <aside className="panel min-h-96">
      <div className="panel-header">
        <div className="min-w-0">
          <h2 className="truncate">{message.subject || text.common.noSubject}</h2>
          <p className="truncate">{message.from_address}</p>
        </div>
        <IconButton title={codeCopied ? text.common.copied : text.inbox.copyCode} onClick={() => { copy(extractCode(message) || message.subject || ''); markCodeCopied(); }}>
          {codeCopied ? <Check size={16} /> : <Copy size={16} />}
        </IconButton>
      </div>
      <div className="mb-3 grid gap-1 text-xs text-[var(--muted)]">
        <div>To: {message.recipient}</div>
        <div>{new Date(message.created_at).toLocaleString()}</div>
      </div>
      {message.text_content && <pre className="message-text">{message.text_content}</pre>}
      {message.html_content && <iframe className="message-frame" sandbox="allow-downloads" srcDoc={injectApiKeyIntoHtml(message.html_content, apiKey)} />}
    </aside>
  );
}
