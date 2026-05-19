import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Clock3, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import type { Domain, User } from '../api';
import { api, patchJSON, postJSON } from '../api';
import type { DomainCheckResult } from '../types';
import { useText } from '../locales';
import type { Language } from '../store';
import { useAppStore } from '../store';
import { dissolveElement } from '../lib/dissolve';
import { boolBadge, domainModeLabel, formatDomainExpiry } from '../lib/display';
import { DataTable, EmptyState, IconButton } from '../components/shared';
import { AddDomainDialog, formatRelativeTime, invalidateDomainQueries, isCheckReady, pendingDeleteAt } from './AddDomainDialog';

export function DomainManagementPage({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const text = useText();
  const language = useAppStore((state) => state.language);
  const [addOpen, setAddOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const domains = useQuery({ queryKey: ['domains-all'], queryFn: () => api<Domain[]>('/api/domains'), retry: false, staleTime: 30_000 });
  const managedDomains = (domains.data || []).filter(isReadyDomain);
  const waitingDomains = (domains.data || []).filter((domain) => isWaitingDomain(domain) && canDeleteWaitingDomain(domain, user));
  const inactiveDomains = (domains.data || []).filter((domain) => !domain.active && (user.role === 'admin' || domain.owner_id === user.id));

  const refreshAllDomains = useMutation({
    mutationFn: async () => {
      const targets = managedDomains.map((domain) => domain.domain);
      const results: PromiseSettledResult<DomainCheckResult>[] = [];
      const batchSize = 5;
      for (let i = 0; i < targets.length; i += batchSize) {
        const batch = targets.slice(i, i + batchSize);
        const batchResults = await Promise.allSettled(
          batch.map((domain) => postJSON<DomainCheckResult>('/api/domains/check-mx', { domain }))
        );
        results.push(...batchResults);
      }
      const rejected = results.filter((result) => result.status === 'rejected').length;
      const failed = results.filter((result) => result.status === 'rejected' || (result.status === 'fulfilled' && !result.value.mx_verified)).length;
      if (targets.length > 0 && rejected === targets.length) {
        const firstFailure = results.find((result) => result.status === 'rejected');
        if (firstFailure?.status === 'rejected' && firstFailure.reason instanceof Error) {
          throw firstFailure.reason;
        }
        throw new Error(text.domains.refreshFailed);
      }
      return { total: targets.length, failed, success: targets.length - failed };
    },
    onSuccess: ({ total, failed, success }) => {
      invalidateDomainQueries(queryClient);
      if (total === 0) {
        toast.success(text.domains.refreshNone);
      } else if (failed > 0) {
        toast.error(text.domains.refreshPartial.replace('{success}', String(success)).replace('{total}', String(total)));
      } else {
        toast.success(text.domains.refreshAllDone.replace('{total}', String(total)));
      }
    },
    onError: (error) => toast.error(error.message)
  });
  const updateDomain = useMutation({
    mutationFn: ({ id, mode }: { id: number; mode: Domain['mode'] }) => patchJSON(`/api/domains/${id}`, { mode }),
    onSuccess: () => {
      invalidateDomainQueries(queryClient);
      toast.success(text.domains.domainUpdated);
    },
    onError: (error) => toast.error(error.message)
  });
  const checkWaitingMX = useMutation({
    mutationFn: (domain: string) => postJSON<DomainCheckResult>('/api/domains/check-mx', { domain }),
    onSuccess: (result) => {
      invalidateDomainQueries(queryClient);
      if (isCheckReady(result)) {
        toast.success(result.check_message || text.domains.mxWorkingToast);
      } else {
        toast.error(result.check_message || text.domains.mxNotReadyToast);
      }
    },
    onError: (error) => toast.error(error.message)
  });
  const deleteWaitingDomain = useMutation({
    mutationFn: (domain: Domain) => api(`/api/domains/${domain.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setConfirmDeleteId(null);
      invalidateDomainQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
      queryClient.invalidateQueries({ queryKey: ['admin-domain-health'] });
      toast.success(text.domains.domainDeleted);
    },
    onError: (error) => {
      setConfirmDeleteId(null);
      toast.error(error.message);
    }
  });
  const reactivateDomain = useMutation({
    mutationFn: (domain: Domain) => patchJSON(`/api/domains/${domain.id}`, { active: true }),
    onSuccess: () => {
      invalidateDomainQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
      queryClient.invalidateQueries({ queryKey: ['admin-domain-health'] });
      toast.success(text.domains.reactivated);
    },
    onError: (error) => toast.error(error.message)
  });

  // Reset delete confirmation when data reloads (e.g. after another delete)
  useEffect(() => {
    setConfirmDeleteId(null);
  }, [domains.dataUpdatedAt]);

  return (
    <>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>{text.domains.manageTitle}</h2>
            <p>{text.domains.manageDesc}</p>
          </div>
          <div className="domain-management-actions">
            <button className="btn-primary" onClick={() => setAddOpen(true)}>
              <Plus size={16} />
              {text.domains.addButton}
            </button>
            <IconButton title={text.domains.refreshAll} onClick={() => refreshAllDomains.mutate()} disabled={refreshAllDomains.isPending || !managedDomains.length} className={refreshAllDomains.isPending ? 'is-pending' : ''}>
              <RefreshCw size={16} />
            </IconButton>
          </div>
        </div>
        {domains.isLoading ? (
          <EmptyState label={text.domains.domainListLoading} />
        ) : domains.isError ? (
          <EmptyState label={text.domains.domainsError} />
        ) : (
          <DataTable
            columns={[
              { key: 'domain', header: text.domains.domain },
              { key: 'effective', header: text.domains.effective },
              { key: 'mode', header: text.domains.mode },
              { key: 'expiry', header: text.domains.expiry },
              { key: 'mail', header: text.domains.mail },
            ]}
            rows={managedDomains.map((domain) => {
              const canEdit = user.role === 'admin' || domain.owner_id === user.id;
              return {
                key: domain.id,
                cells: [
                  <span className="domain-name-cell font-medium" style={{ display: 'inline-block', maxWidth: '100%' }}>{domain.domain}</span>,
                  domainHealthBadge(domain, text),
                  <div className="segmented-control">
                    <button type="button" className={`segment-choice ${domain.mode === 'private' ? 'segment-choice-active' : ''}`} style={{ fontSize: '0.75rem' }} disabled={!canEdit} onClick={() => updateDomain.mutate({ id: domain.id, mode: 'private' })}>
                      {text.domains.modePrivate}
                    </button>
                    <button type="button" className={`segment-choice ${domain.mode === 'public' ? 'segment-choice-active' : ''}`} style={{ fontSize: '0.75rem' }} disabled={!canEdit} onClick={() => updateDomain.mutate({ id: domain.id, mode: 'public' })}>
                      {text.domains.modePublic}
                    </button>
                  </div>,
                  formatDomainExpiry(domain.domain_expires_at, language),
                  domain.message_count ?? 0,
                ],
              };
            })}
            emptyLabel={text.domains.noDomains}
          />
        )}
      </section>
      {!domains.isLoading && !domains.isError && waitingDomains.length > 0 && (
        <section className="panel domain-waiting-panel">
          <div className="panel-header">
            <div>
              <h2>{text.domains.waitingTitle}</h2>
              <p>{text.domains.waitingDesc}</p>
            </div>
          </div>
          <DataTable
            columns={[
              { key: 'domain', header: text.domains.domain },
              { key: 'status', header: text.domains.status },
              { key: 'mode', header: text.domains.mode },
              { key: 'autoDelete', header: text.domains.autoDelete },
              { key: 'actions', header: text.domains.actions },
            ]}
            rows={waitingDomains.map((domain) => {
              const isConfirming = confirmDeleteId === domain.id;
              const busy = checkWaitingMX.isPending || deleteWaitingDomain.isPending;
              return {
                key: domain.id,
                cells: [
                  <span className="domain-name-cell font-medium" style={{ display: 'inline-block', maxWidth: '100%' }}>{domain.domain}</span>,
                  <span className={`status-pill ${domain.mx_verified ? 'status-warn' : 'status-bad'}`}>
                    {domain.mx_verified ? <Clock3 size={13} /> : <X size={13} />}
                    {domain.mx_verified ? text.domains.randomSubdomainNotReady : text.domains.mxNotReady}
                  </span>,
                  domainModeLabel(domain.mode, language),
                  <span title={formatDateTime(pendingDeleteAt(domain), language)}>{formatAutoDeleteTime(domain, text.domains.aboutToDelete)}</span>,
                  <div className="table-actions">
                    <button className="btn-ghost" onClick={() => checkWaitingMX.mutate(domain.domain)} disabled={busy}>
                      {text.domains.recheck}
                    </button>
                    {isConfirming ? (
                      <>
                        <button className="btn-ghost" onClick={() => setConfirmDeleteId(null)} disabled={deleteWaitingDomain.isPending}>
                          {text.common.cancel}
                        </button>
                        <button className="btn-ghost" aria-label={text.domains.deleteConfirm} onClick={async (e) => {
                          const row = (e.currentTarget as HTMLElement).closest('tr') as HTMLElement | null;
                          if (row) await dissolveElement(row, { duration: 400, blockSize: 4, direction: 'out' });
                          deleteWaitingDomain.mutate(domain);
                        }} disabled={deleteWaitingDomain.isPending}>
                          <Trash2 size={14} />
                          {text.domains.deleteConfirm}
                        </button>
                      </>
                    ) : (
                      <button className="btn-ghost" onClick={() => setConfirmDeleteId(domain.id)} disabled={busy}>
                        <Trash2 size={14} />
                        {text.domains.deleteDomain}
                      </button>
                    )}
                  </div>,
                ],
              };
            })}
          />
        </section>
      )}
      {!domains.isLoading && !domains.isError && inactiveDomains.length > 0 && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>{text.domains.inactiveTitle}</h2>
              <p>{text.domains.inactiveDesc}</p>
            </div>
          </div>
          <DataTable
            columns={[
              { key: 'domain', header: text.domains.domain },
              { key: 'status', header: text.domains.status },
              { key: 'mode', header: text.domains.mode },
              { key: 'expiry', header: text.domains.expiry },
              { key: 'actions', header: text.domains.actions },
            ]}
            rows={inactiveDomains.map((domain) => ({
              key: domain.id,
              cells: [
                <span className="domain-name-cell font-medium" style={{ display: 'inline-block', maxWidth: '100%' }}>{domain.domain}</span>,
                <span className="status-pill status-bad">
                  <X size={13} />
                  {text.domains.inactive}
                </span>,
                domainModeLabel(domain.mode, language),
                formatDomainExpiry(domain.domain_expires_at, language),
                <button
                  className="btn-ghost"
                  onClick={() => reactivateDomain.mutate(domain)}
                  disabled={reactivateDomain.isPending}
                >
                  <RefreshCw size={14} />
                  {text.domains.reactivate}
                </button>,
              ],
            }))}
          />
        </section>
      )}
      <AddDomainDialog open={addOpen} onClose={() => setAddOpen(false)} />
    </>
  );
}

function isReadyDomain(domain: Domain) {
  return domain.active && domain.mx_verified && (!domain.wildcard_requested || domain.wildcard_enabled);
}

function isWaitingDomain(domain: Domain) {
  return domain.active && (!domain.mx_verified || (Boolean(domain.wildcard_requested) && !domain.wildcard_enabled));
}

function canDeleteWaitingDomain(domain: Domain, user: User) {
  return user.role === 'admin' || domain.owner_id === user.id;
}

function formatAutoDeleteTime(domain: Domain, pastLabel: string) {
  return formatRelativeTime(pendingDeleteAt(domain), pastLabel);
}

function domainHealthBadge(domain: Domain, text: ReturnType<typeof useText>) {
  if (!domain.active || !domain.mx_verified) return boolBadge(false);
  const expiresAt = domain.domain_expires_at ? new Date(domain.domain_expires_at) : null;
  const expiring = expiresAt && expiresAt.getTime() > Date.now() && expiresAt.getTime() < Date.now() + 30 * 24 * 60 * 60 * 1000;
  if (expiring) {
    return (
      <span className="status-pill status-warn">
        <AlertTriangle size={13} />
        {text.domains.expiring}
      </span>
    );
  }
  return boolBadge(true);
}

function formatDateTime(value?: string, language?: Language) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const locale = language === 'en-US' ? 'en-US' : 'zh-CN';
  return date.toLocaleString(locale, { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

