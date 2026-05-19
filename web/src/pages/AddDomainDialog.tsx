import { Fragment, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Clock3, Copy, Globe2, Info, Loader2, Plus, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { toast } from 'sonner';
import type { Domain, InstallStatus } from '../api';
import { api, postJSON } from '../api';
import type { DNSInstructions, DNSProbe, DomainCheckResult, DomainCreateResult } from '../types';
import { useText, currentText } from '../locales';
import { useAppStore } from '../store';
import { useCopyState } from '../hooks/useCopyState';
import { copy } from '../lib/clipboard';
import { launchSuccessBurst } from '../lib/confetti';
import { domainInputWantsWildcard, normalizeDomainInput } from '../lib/domain';
import { IconButton, StatusPill } from '../components/shared';

export function AddDomainDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const text = useText();
  const language = useAppStore((state) => state.language);
  const [domainName, setDomainName] = useState('example.test');
  const [mode, setMode] = useState<Domain['mode']>('private');
  const [dns, setDNS] = useState<DNSInstructions | null>(null);
  const [submittedDomain, setSubmittedDomain] = useState<Domain | null>(null);
  const [checkResult, setCheckResult] = useState<DomainCheckResult | null>(null);
  const [mxCopied, markMxCopied] = useCopyState();
  const successRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const domainInputRef = useRef<HTMLInputElement | null>(null);
  const installStatus = useQuery({ queryKey: ['install-status'], queryFn: () => api<InstallStatus>('/api/install/status'), retry: false, enabled: open });
  const normalizedDomain = normalizeDomainInput(domainName);
  const domainValid = isValidDomain(normalizedDomain);
  const inputTouched = domainName.trim().length > 0;
  const validationMessage = inputTouched && !domainValid ? text.domains.invalidDomain : '';
  const cfg = installStatus.data?.config;
  const mxTarget = (dns?.mx.value || cfg?.expected_mx || 'mail.example.com').replace(/\.$/, '');
  const activeDomain = submittedDomain?.domain || normalizedDomain || 'example.com';
  const verified = isDomainReady(checkResult, submittedDomain);
  const submitted = Boolean(submittedDomain);

  // Focus panel and first input when dialog opens; implement focus trap
  useEffect(() => {
    if (!open) return;
    // Focus the panel so it can receive keyboard events
    panelRef.current?.focus();
    // Focus the domain input after a short delay
    const timer = setTimeout(() => domainInputRef.current?.focus(), 50);

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab') return;

      const focusableElements = panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
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
    setDomainName('example.test');
    setMode('private');
    setDNS(null);
    setSubmittedDomain(null);
    setCheckResult(null);
  };

  const checkMX = useMutation({
    mutationFn: (domain: string) => postJSON<DomainCheckResult>('/api/domains/check-mx', { domain }),
    onSuccess: (data) => {
      setCheckResult(data);
      setSubmittedDomain((current) => {
        if (!current) return current;
        return {
          ...current,
          mx_verified: data.mx_verified,
          wildcard_enabled: data.wildcard_enabled,
          mx_auto_retry_enabled: isCheckReady(data) ? false : current.mx_auto_retry_enabled,
          last_check_message: data.check_message
        };
      });
      invalidateDomainQueries(queryClient);
      if (isCheckReady(data)) {
        window.setTimeout(() => launchSuccessBurst({ origin: successRef.current, label: text.domains.mxWorking }), 40);
      }
    },
    onError: (error) => toast.error(error.message)
  });

  const createDomain = useMutation({
    mutationFn: () => postJSON<DomainCreateResult>('/api/domains/request', { domain: domainName, mode, wildcard_enabled: domainInputWantsWildcard(domainName) }),
    onSuccess: (data) => {
      setDNS(data.dns);
      setSubmittedDomain(data.domain);
      setCheckResult(null);
      invalidateDomainQueries(queryClient);
      checkMX.mutate(data.domain.domain);
    },
    onError: (error) => toast.error(error.message)
  });

  const toggleAutoRetry = useMutation({
    mutationFn: (enabled: boolean) => {
      if (!submittedDomain?.id) {
        throw new Error(text.domains.domainLoadError);
      }
      return postJSON<Domain | { deleted: boolean }>(`/api/domains/${submittedDomain.id}/mx-auto-retry`, { enabled });
    },
    onSuccess: (domain) => {
      if ('deleted' in domain) {
        setSubmittedDomain(null);
        setCheckResult(null);
        toast.error(text.domains.autoRetryTimedOut);
      } else {
        setSubmittedDomain(domain);
        toast.success(domain.mx_auto_retry_enabled ? text.domains.autoRetryEnabled : text.domains.autoRetryDisabled);
      }
      invalidateDomainQueries(queryClient);
    },
    onError: (error) => toast.error(error.message)
  });

  const busy = createDomain.isPending || checkMX.isPending;
  const autoRetryBusy = toggleAutoRetry.isPending;
  const submitDisabled = submitted || !domainValid || busy;
  const statusMessage = checkResult?.check_message || (submitted ? text.domains.submittedDesc : text.domains.submitAndVerifyDesc);
  const autoRetryActive = Boolean(submittedDomain?.mx_auto_retry_enabled);
  const submittedPendingDeleteAt = submittedDomain ? pendingDeleteAt(submittedDomain) : undefined;
  const nextCheckTime = formatRelativeTime(submittedDomain?.mx_auto_retry_next_at, text.domains.aboutToCheck);
  const autoDeleteTime = formatRelativeTime(submittedPendingDeleteAt, text.domains.aboutToDelete);
  const autoRetryMeta = autoRetryActive
    ? text.domains.autoRetryOn
        .replace('{count}', String(submittedDomain?.mx_auto_retry_count ?? 0))
        .replace('{next}', nextCheckTime)
        .replace('{autoDelete}', autoDeleteTime)
    : text.domains.autoRetryOff.replace('{autoDeleteTime}', autoDeleteTime);

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
                <p>{text.domains.dialogDesc}</p>
              </div>
              <IconButton title={text.domains.closeTitle} onClick={onClose}>
                <X size={16} />
              </IconButton>
            </div>

            <div className="add-domain-form">
              <label className="api-key-field">
                {text.domains.domainLabel}
                <input ref={domainInputRef} className="input" value={domainName} disabled={submitted} onChange={(event) => setDomainName(event.target.value)} placeholder={text.domains.domainPlaceholder} />
              </label>
              <p className="domain-input-hint">{text.domains.inputHint}</p>
              {validationMessage && <p className="domain-field-error">{validationMessage}</p>}

              <div className="segmented-control" role="group" aria-label={text.domains.domainTypeAria}>
                <button type="button" className={`segment-choice ${mode === 'private' ? 'segment-choice-active' : ''}`} disabled={submitted} onClick={() => setMode('private')}>
                  <ShieldCheck size={15} />
                  {text.domains.modePrivateShort}
                </button>
                <button type="button" className={`segment-choice ${mode === 'public' ? 'segment-choice-active' : ''}`} disabled={submitted} onClick={() => setMode('public')}>
                  <Globe2 size={15} />
                  {text.domains.modePublicShort}
                </button>
              </div>

              <div className="domain-modal-section">
                <div className="domain-modal-section-title">{text.domains.mxSettings}</div>
                <div className="mx-target-card">
                  <span>{text.domains.mxPointTo}</span>
                  <code>{mxTarget}</code>
                  <button className="btn-secondary" onClick={() => { copy(mxTarget); markMxCopied(); }}>
                    {mxCopied ? <Check size={16} /> : <Copy size={16} />}
                    {mxCopied ? text.common.copied : text.common.copy}
                  </button>
                </div>
                <p className="dns-note">
                  {renderDnsNote(text.domains.dnsNote, activeDomain, mxTarget)}
                </p>
              </div>

              <div ref={successRef} className={`domain-verification-card ${verified && checkResult?.dns_status !== 'propagating' ? 'domain-verification-card-ok' : ''}`}>
                <div className="domain-verification-head">
                  {dnsStatusPill(checkResult, verified, submitted, text)}
                  <code>@{activeDomain}</code>
                </div>
                <p>{statusMessage}</p>
                {submitted && <DNSCheckDetails result={checkResult} text={text} />}
                {submitted && !verified && (
                  <div className="domain-auto-retry-note">
                    <Clock3 size={14} />
                    <span>{autoRetryMeta}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="add-domain-actions">
              <button className="btn-secondary" onClick={onClose}>
                {verified ? text.domains.finish : text.common.cancel}
              </button>
              {verified ? (
                <button className="btn-primary" onClick={resetForm}>
                  <Plus size={16} />
                  {text.domains.addNext}
                </button>
              ) : submittedDomain ? (
                <>
                  <button className="btn-secondary" onClick={() => toggleAutoRetry.mutate(!autoRetryActive)} disabled={busy || autoRetryBusy}>
                    {autoRetryBusy ? <Loader2 size={16} className="animate-spin" /> : <Clock3 size={16} />}
                    {autoRetryActive ? text.domains.stopWait : text.domains.bgWait}
                  </button>
                  <button className="btn-primary" onClick={() => checkMX.mutate(submittedDomain.domain)} disabled={busy || autoRetryBusy}>
                    {checkMX.isPending ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                    {text.domains.recheck}
                  </button>
                </>
              ) : (
                <button className="btn-primary" onClick={() => createDomain.mutate()} disabled={submitDisabled}>
                  {createDomain.isPending || checkMX.isPending ? <Loader2 size={16} className="animate-spin" /> : <Globe2 size={16} />}
                  {text.domains.submitAndVerify}
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

/** Renders the dnsNote i18n string with `[[domain]]`, `[[mx]]`, `[[wildcard]]` replaced by <code> elements. */
function renderDnsNote(template: string, activeDomain: string, mxTarget: string) {
  const parts = template.split(/(\[\[domain\]\]|\[\[mx\]\]|\[\[wildcard\]\])/g);
  return parts.map((part, i) => {
    if (part === '[[domain]]') return <code key={`d-${i}`}>{activeDomain}</code>;
    if (part === '[[mx]]') return <code key={`m-${i}`}>{mxTarget}</code>;
    if (part === '[[wildcard]]') return <code key={`w-${i}`}>*.{activeDomain}</code>;
    return <Fragment key={`t-${i}`}>{part}</Fragment>;
  });
}

function DNSCheckDetails({ result, text }: { result: DomainCheckResult | null; text: ReturnType<typeof useText> }) {
  const rootChecks = result?.dns_checks || [];
  const wildcardChecks = result?.wildcard_dns_checks || [];
  if (!rootChecks.length && !wildcardChecks.length) return null;
  return (
    <details className="dns-check-details">
      <summary>
        <Info size={14} />
        {text.domains.dnsPropagationDetail}
      </summary>
      <DNSProbeList title={text.domains.dnsRootMX} probes={rootChecks} text={text} />
      {wildcardChecks.length > 0 && <DNSProbeList title={text.domains.dnsWildcardMX} probes={wildcardChecks} text={text} />}
    </details>
  );
}

function DNSProbeList({ title, probes, text }: { title: string; probes: DNSProbe[]; text: ReturnType<typeof useText> }) {
  return (
    <div className="dns-probe-group">
      <div className="dns-probe-title">{title}</div>
      <div className="dns-probe-list">
        {probes.map((probe, index) => (
          <div className="dns-probe-row" key={`${probe.source}-${probe.resolver || index}`}>
            <span className={`dns-probe-state ${probe.verified ? 'dns-probe-ok' : probe.mx_records?.length ? 'dns-probe-warn' : 'dns-probe-bad'}`} />
            <span className="dns-probe-source">{probe.authoritative ? `${probe.source} ${probe.resolver || ''}` : probe.source}</span>
            <code>{probe.mx_records?.length ? probe.mx_records.join(', ') : probe.error || text.domains.dnsProbeNoMX}</code>
          </div>
        ))}
      </div>
    </div>
  );
}

export function invalidateDomainQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['domains-all'] });
  queryClient.invalidateQueries({ queryKey: ['domains-available'] });
}

export function pendingDeleteAt(domain: Domain) {
  if (domain.pending_delete_at) return domain.pending_delete_at;
  if (!domain.created_at) return undefined;
  const createdAt = new Date(domain.created_at);
  if (Number.isNaN(createdAt.getTime())) return undefined;
  return new Date(createdAt.getTime() + 2 * 60 * 60 * 1000).toISOString();
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

export function isCheckReady(result: DomainCheckResult | null | undefined) {
  return Boolean(result?.mx_verified && (!result.wildcard_checked || result.wildcard_enabled));
}

function isDomainReady(result: DomainCheckResult | null, domain: Domain | null) {
  if (result) return isCheckReady(result);
  return Boolean(domain?.mx_verified && (!domain.wildcard_requested || domain.wildcard_enabled));
}

function dnsStatusPill(result: DomainCheckResult | null, verified: boolean, submitted: boolean, text: ReturnType<typeof useText>) {
  const status = result?.dns_status;
  if (status === 'propagating') {
    return (
      <span className="status-pill status-warn">
        <Clock3 size={13} />
        {result?.mx_verified ? text.domains.authorityReady : text.domains.propagating}
      </span>
    );
  }
  if (verified) {
    return <StatusPill ok>{text.domains.mxWorking}</StatusPill>;
  }
  if (status === 'misconfigured') {
    return <StatusPill>{text.domains.misconfigured}</StatusPill>;
  }
  if (status === 'not_found') {
    return <StatusPill>{text.domains.mxNotFound}</StatusPill>;
  }
  return <StatusPill>{submitted ? text.domains.awaitingMX : text.domains.pendingSubmit}</StatusPill>;
}

function isValidDomain(domainName: string) {
  const labels = domainName.split('.');
  return labels.length > 1 && labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}
