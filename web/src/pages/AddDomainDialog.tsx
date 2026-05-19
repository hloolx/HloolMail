import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Globe2, Plus, ShieldCheck, X } from 'lucide-react';
import { toast } from 'sonner';
import type { Domain, InstallStatus } from '../api';
import { api, postJSON } from '../api';
import type { BatchDomainInput, BatchDomainItemResult, BatchDomainResponse } from '../types';
import { currentText, useText } from '../locales';
import { useCopyState } from '../hooks/useCopyState';
import { copy } from '../lib/clipboard';
import { domainInputWantsWildcard, normalizeDomainInput } from '../lib/domain';
import { notifySuccess } from '../lib/feedback';
import { IconButton, InfoTip, LoadingIndicator } from '../components/shared';

const MAX_BATCH_SIZE = 50;

/** Split pasted text into individual domain entries by common separators. */
function splitDomainText(raw: string): string[] {
  return raw
    .split(/[\n\r]+|[;,；，]+|(?<!\s)\s{2,}(?!\s)/)
    .map((s) => s.replace(/[\s​‌‍﻿]+/g, ' ').trim())
    .filter((s) => s.length > 0);
}

function parseDomainsFromInput(text: string): BatchDomainInput[] {
  const rawList = splitDomainText(text);
  const seen = new Set<string>();
  const result: BatchDomainInput[] = [];
  for (const raw of rawList) {
    const normalized = normalizeDomainInput(raw);
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push({
      raw,
      domain: normalized,
      wildcard: domainInputWantsWildcard(raw),
    });
  }
  // Truncate at MAX_BATCH_SIZE
  return result.slice(0, MAX_BATCH_SIZE);
}

function isValidDomain(domainName: string) {
  const labels = domainName.split('.');
  return labels.length > 1 && labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}

export function AddDomainDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const text = useText();
  const [domainsText, setDomainsText] = useState('');
  const [mode, setMode] = useState<Domain['mode']>('private');
  const [results, setResults] = useState<BatchDomainItemResult[] | null>(null);
  const [mxCopied, markMxCopied] = useCopyState();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const submitButtonRef = useRef<HTMLButtonElement | null>(null);

  const installStatus = useQuery({
    queryKey: ['install-status'],
    queryFn: () => api<InstallStatus>('/api/install/status'),
    retry: false,
    enabled: open,
  });

  const parsedDomains = useMemo(() => parseDomainsFromInput(domainsText), [domainsText]);
  const parsedCount = parsedDomains.length;
  const overflowCount = Math.max(0, splitDomainText(domainsText).length - MAX_BATCH_SIZE);
  const invalidDomains = useMemo(
    () => parsedDomains.filter((d) => !isValidDomain(d.domain)),
    [parsedDomains]
  );
  const validDomains = useMemo(
    () => parsedDomains.filter((d) => isValidDomain(d.domain)),
    [parsedDomains]
  );
  const cfg = installStatus.data?.config;
  const mxTarget = (cfg?.expected_mx || 'mail.example.com').replace(/\.$/, '');
  const submitted = results !== null;

  // Focus trap and escape handling
  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const timer = setTimeout(() => textareaRef.current?.focus(), 50);

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusableElements = panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusableElements || focusableElements.length === 0) return;
      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKey);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open, onClose]);

  const resetForm = () => {
    setDomainsText('');
    setResults(null);
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  const batchCreate = useMutation({
    mutationFn: () =>
      postJSON<BatchDomainResponse>('/api/domains/batch-request', {
        domains: validDomains,
        mode,
      }),
    onSuccess: (data) => {
      setResults(data.results);
      invalidateDomainQueries(queryClient);
      const created = data.results.filter((r) => r.status === 'created').length;
      const alreadyExists = data.results.filter((r) => r.status === 'already_exists').length;
      const successful = created + alreadyExists;
      const failed = data.results.length - successful;
      if (successful > 0 && failed === 0) {
        notifySuccess(text.domains.batchDone.replace('{count}', String(successful)), { origin: submitButtonRef.current });
      } else if (successful > 0) {
        notifySuccess(text.domains.batchPartial.replace('{created}', String(successful)).replace('{failed}', String(failed)), { origin: submitButtonRef.current });
      } else {
        toast.error(text.domains.batchAllFailed);
      }
    },
    onError: (error) => toast.error(error.message),
  });

  const canSubmit = validDomains.length > 0 && !batchCreate.isPending;

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const clipboard = e.clipboardData.getData('text/plain');
    if (!clipboard) return;
    // If the clipboard already has newlines, let the default paste handle it
    const hasNewlines = /[\n\r]/.test(clipboard);
    if (hasNewlines) return;
    // Otherwise, process separators
    e.preventDefault();
    const lines = splitDomainText(clipboard);
    if (lines.length === 0) return;
    // Insert at cursor position
    const textarea = textareaRef.current;
    if (!textarea) {
      setDomainsText(lines.join('\n'));
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const before = domainsText.slice(0, start);
    const after = domainsText.slice(end);
    const insertText = lines.join('\n');
    const newText = before + (before && !before.endsWith('\n') ? '\n' : '') + insertText + (after && !after.startsWith('\n') ? '\n' : '') + after;
    setDomainsText(newText);
    // Restore cursor after the pasted content
    setTimeout(() => {
      const newCursor = start + insertText.length + (before && !before.endsWith('\n') ? 1 : 0);
      textarea.selectionStart = textarea.selectionEnd = newCursor;
    }, 0);
  }, [domainsText]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    // Truncate to roughly MAX_BATCH_SIZE lines to prevent performance issues
    const lines = value.split('\n');
    if (lines.length > MAX_BATCH_SIZE + 10) {
      setDomainsText(lines.slice(0, MAX_BATCH_SIZE + 10).join('\n'));
      return;
    }
    setDomainsText(value);
  };

  const backdropVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1 },
  };

  const panelVariants = {
    hidden: { opacity: 0, transform: 'translateY(0.55rem) scale(0.96)' },
    visible: { opacity: 1, transform: 'translateY(0) scale(1)' },
    exit: { opacity: 0, transform: 'translateY(0.55rem) scale(0.96)' },
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal-backdrop"
          style={{ animation: 'none' }}
          role="presentation"
          variants={backdropVariants}
          initial="hidden"
          animate="visible"
          exit="hidden"
          transition={{ duration: 0.15 }}
          onMouseDown={(event) => event.target === event.currentTarget && onClose()}
        >
          <motion.div
            ref={panelRef}
            className="modal-panel add-domain-modal"
            style={{ animation: 'none' }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-domain-title"
            tabIndex={-1}
            variants={panelVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            transition={{ duration: 0.18 }}
          >
            <div className="modal-header">
              <div>
                <h2 id="add-domain-title">{text.domains.dialogTitle}</h2>
                <p>{text.domains.batchDialogDesc}</p>
              </div>
              <IconButton title={text.domains.closeTitle} onClick={onClose}>
                <X size={16} />
              </IconButton>
            </div>

            <div className="add-domain-form">
              {/* Mode selector — compact pills */}
              <div className="segmented-control segmented-control-compact" role="group" aria-label={text.domains.domainTypeAria}>
                <button type="button" className={`segment-choice ${mode === 'private' ? 'segment-choice-active' : ''}`} disabled={batchCreate.isPending} onClick={() => setMode('private')}>
                  <ShieldCheck size={13} />
                  {text.domains.modePrivateShort}
                </button>
                <button type="button" className={`segment-choice ${mode === 'public' ? 'segment-choice-active' : ''}`} disabled={batchCreate.isPending} onClick={() => setMode('public')}>
                  <Globe2 size={13} />
                  {text.domains.modePublicShort}
                </button>
              </div>

              {/* Results summary (after submit) */}
              {submitted && (
                <div className="batch-results-card">
                  <div className="batch-results-summary">
                    {results.filter((r) => r.status === 'created').length > 0 && (
                      <span className="batch-count batch-count-ok">{text.domains.batchCreated.replace('{count}', String(results.filter((r) => r.status === 'created').length))}</span>
                    )}
                    {results.filter((r) => r.status === 'already_exists').length > 0 && (
                      <span className="batch-count batch-count-warn">{text.domains.batchExists.replace('{count}', String(results.filter((r) => r.status === 'already_exists').length))}</span>
                    )}
                    {results.filter((r) => r.status === 'invalid').length > 0 && (
                      <span className="batch-count batch-count-bad">{text.domains.batchInvalid.replace('{count}', String(results.filter((r) => r.status === 'invalid').length))}</span>
                    )}
                  </div>
                  {results.filter((r) => r.status !== 'created' && r.status !== 'already_exists').length > 0 && (
                    <div className="batch-failed-list">
                      {results.filter((r) => r.status !== 'created' && r.status !== 'already_exists').map((r, i) => (
                        <div key={i} className="batch-failed-row">
                          <span className="batch-failed-domain">{r.domain || r.raw}</span>
                          <span className="batch-failed-reason">{r.error || text.domains.batchUnknownError}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {results.some((r) => r.domain_record?.pending_delete_at) && (
                    <div className="batch-failed-list">
                      {results.filter((r) => r.domain_record?.pending_delete_at).map((r, i) => (
                        <div key={i} className="batch-failed-row">
                          <span className="batch-failed-domain">{r.domain || r.raw}</span>
                          <span className="batch-failed-reason">{text.domains.pendingAutoDeleteHint.replace('{time}', formatRelativeTime(r.domain_record?.pending_delete_at))}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Textarea input */}
              <label className="api-key-field">
                {text.domains.domainLabel}
                <textarea
                  ref={textareaRef}
                  className="input batch-domain-input"
                  value={domainsText}
                  onChange={handleInputChange}
                  onPaste={handlePaste}
                  disabled={batchCreate.isPending}
                  placeholder={text.domains.batchPlaceholder}
                  rows={8}
                  spellCheck={false}
                />
              </label>
              <div className="batch-input-footer">
                <span className="batch-input-count">
                  {parsedCount > 0
                    ? text.domains.batchCount.replace('{count}', String(parsedCount)).replace('{remaining}', String(MAX_BATCH_SIZE - parsedCount))
                    : text.domains.batchHint}
                </span>
                {overflowCount > 0 && (
                  <span className="batch-input-overflow">{text.domains.batchOverflow.replace('{count}', String(overflowCount))}</span>
                )}
                {invalidDomains.length > 0 && (
                  <span className="batch-input-invalid">{text.domains.batchInvalidCount.replace('{count}', String(invalidDomains.length))}</span>
                )}
              </div>

              {/* MX settings info */}
              <div className="domain-modal-section">
                <div className="domain-modal-section-title">{text.domains.mxSettings}<InfoTip text={text.domains.batchDNSNote.replace('[[mx]]', mxTarget)} /></div>
                <div className="mx-target-card">
                  <span>{text.domains.mxPointTo}</span>
                  <code>{mxTarget}</code>
                  <button className="btn-secondary" onClick={() => { copy(mxTarget); markMxCopied(); }}>
                    {mxCopied ? <Check size={16} /> : <Copy size={16} />}
                    {mxCopied ? text.common.copied : text.common.copy}
                  </button>
                </div>
                <p className="dns-note">
                  {text.domains.batchDNSNote.replace('[[mx]]', mxTarget)}
                </p>
              </div>
            </div>

            <div className="add-domain-actions">
              <button className="btn-secondary" onClick={onClose}>
                {submitted ? text.domains.finish : text.common.cancel}
              </button>
              {submitted ? (
                <button className="btn-primary" onClick={resetForm}>
                  <Plus size={16} />
                  {text.domains.addMore}
                </button>
              ) : (
                <button ref={submitButtonRef} className="btn-primary" onClick={() => batchCreate.mutate()} disabled={!canSubmit}>
                  {batchCreate.isPending ? <LoadingIndicator /> : <Globe2 size={16} />}
                  {text.domains.batchSubmit}
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

export function invalidateDomainQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['domains-all'] });
  queryClient.invalidateQueries({ queryKey: ['domains-available'] });
}

export function pendingDeleteAt(domain: Domain) {
  return domain.pending_delete_at;
}

export function formatRelativeTime(value?: string, pastLabel = ''): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const diff = date.getTime() - Date.now();
  if (diff <= 0) return pastLabel;
  const t = currentText();
  const minutes = Math.ceil(diff / 60000);
  if (minutes < 60) return t.domains.minutesLater.replace('{minutes}', String(minutes));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? t.domains.hoursMinLater.replace('{hours}', String(hours)).replace('{rest}', String(rest)) : t.domains.hoursLater.replace('{hours}', String(hours));
}

export function isCheckReady(result: { mx_verified?: boolean; wildcard_enabled?: boolean; wildcard_checked?: boolean } | null | undefined) {
  return Boolean(result?.mx_verified && (!result.wildcard_checked || result.wildcard_enabled));
}
