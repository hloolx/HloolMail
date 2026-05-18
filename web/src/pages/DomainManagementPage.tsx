import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Clock3, Copy, Globe2, Info, Loader2, Plus, RefreshCw, ShieldCheck, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import type { Domain, InstallStatus, User } from '../api';
import { api, patchJSON, postJSON } from '../api';
import type { DNSInstructions, DNSProbe, DomainCheckResult, DomainCreateResult } from '../types';
import { useText } from '../locales';
import { useAppStore } from '../store';
import { useCopyState } from '../hooks/useCopyState';
import { copy } from '../lib/clipboard';
import { launchSuccessBurst } from '../lib/confetti';
import { domainInputWantsWildcard, normalizeDomainInput } from '../lib/domain';
import { boolBadge, domainModeLabel, formatDomainExpiry } from '../lib/display';
import { EmptyState, IconButton, StatusPill } from '../components/shared';

export function DomainManagementPage({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const text = useText();
  const language = useAppStore((state) => state.language);
  const [addOpen, setAddOpen] = useState(false);
  const domains = useQuery({ queryKey: ['domains-all'], queryFn: () => api<Domain[]>('/api/domains'), retry: false });
  const managedDomains = (domains.data || []).filter(isReadyDomain);
  const waitingDomains = (domains.data || []).filter((domain) => isWaitingDomain(domain) && canDeleteWaitingDomain(domain, user));
  const inactiveDomains = (domains.data || []).filter((domain) => !domain.active && (user.role === 'admin' || domain.owner_id === user.id));
  const refreshAllDomains = useMutation({
    mutationFn: async () => {
      const targets = managedDomains.map((domain) => domain.domain);
      const results = await Promise.allSettled(targets.map((domain) => postJSON<DomainCheckResult>('/api/domains/check-mx', { domain })));
      const rejected = results.filter((result) => result.status === 'rejected').length;
      const failed = results.filter((result) => result.status === 'rejected' || (result.status === 'fulfilled' && !result.value.mx_verified)).length;
      if (targets.length > 0 && rejected === targets.length) {
        const firstFailure = results.find((result) => result.status === 'rejected');
        if (firstFailure?.status === 'rejected' && firstFailure.reason instanceof Error) {
          throw firstFailure.reason;
        }
        throw new Error('域名状态刷新失败');
      }
      return { total: targets.length, failed };
    },
    onSuccess: ({ total, failed }) => {
      invalidateDomainQueries(queryClient);
      if (total === 0) {
        toast.success('暂无域名需要刷新');
      } else if (failed > 0) {
        toast.error(`已刷新 ${total - failed}/${total} 个域名状态，部分域名 MX 未通过`);
      } else {
        toast.success(`已刷新 ${total} 个域名状态`);
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
        toast.success(result.check_message || 'MX 已生效');
      } else {
        toast.error(result.check_message || 'MX 还未生效');
      }
    },
    onError: (error) => toast.error(error.message)
  });
  const deleteWaitingDomain = useMutation({
    mutationFn: (domain: Domain) => api(`/api/domains/${domain.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      invalidateDomainQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
      queryClient.invalidateQueries({ queryKey: ['admin-domain-health'] });
      toast.success('域名已删除');
    },
    onError: (error) => toast.error(error.message)
  });
  const reactivateDomain = useMutation({
    mutationFn: (domain: Domain) => patchJSON(`/api/domains/${domain.id}`, { active: true }),
    onSuccess: () => {
      invalidateDomainQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
      queryClient.invalidateQueries({ queryKey: ['admin-domain-health'] });
      toast.success('域名已重新激活');
    },
    onError: (error) => toast.error(error.message)
  });
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
        {managedDomains.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{text.domains.domain}</th>
                  <th>{text.domains.effective}</th>
                  <th>{text.domains.mode}</th>
                  <th>{text.domains.expiry}</th>
                  <th>{text.domains.mail}</th>
                </tr>
              </thead>
              <tbody>
                {managedDomains.map((domain) => {
                  const canEdit = user.role === 'admin' || domain.owner_id === user.id;
                  return (
                    <tr key={domain.id}>
                      <td className="font-medium">{domain.domain}</td>
                      <td title={domain.last_check_message || domain.last_mx_records || undefined}>{domainHealthBadge(domain)}</td>
                      <td>
                        <select className="input" value={domain.mode} disabled={!canEdit} onChange={(event) => updateDomain.mutate({ id: domain.id, mode: event.target.value as Domain['mode'] })}>
                          <option value="private">{text.domains.modePrivate}</option>
                          <option value="public">{text.domains.modePublic}</option>
                        </select>
                      </td>
                      <td>{formatDomainExpiry(domain.domain_expires_at, language)}</td>
                      <td>{domain.message_count ?? 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState label={text.domains.noDomains} />
        )}
      </section>
      {waitingDomains.length > 0 && (
        <section className="panel domain-waiting-panel">
          <div className="panel-header">
            <div>
              <h2>等待验证</h2>
              <p>这些域名还没有通过 MX 验证，可手动检测；未验证域名会在提交后 2 小时自动删除。</p>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{text.domains.domain}</th>
                  <th>状态</th>
                  <th>{text.domains.mode}</th>
                  <th>自动重试</th>
                  <th>预计自动删除</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {waitingDomains.map((domain) => (
                  <tr key={domain.id}>
                    <td className="font-medium">{domain.domain}</td>
                    <td title={domain.last_check_message || domain.last_mx_records || undefined}>
                      <span className={`status-pill ${domain.mx_auto_retry_enabled ? 'status-warn' : 'status-bad'}`}>
                        {domain.mx_auto_retry_enabled ? <Clock3 size={13} /> : <X size={13} />}
                        {domain.mx_auto_retry_enabled ? '后台等待中' : domain.mx_verified ? '随机子域名未生效' : '未生效'}
                      </span>
                    </td>
                    <td>{domainModeLabel(domain.mode, language)}</td>
                    <td>{retrySummary(domain)}</td>
                    <td title={formatDateTime(pendingDeleteAt(domain))}>{formatAutoDeleteTime(domain)}</td>
                    <td>
                      <div className="table-actions">
                        <button className="btn-ghost" onClick={() => checkWaitingMX.mutate(domain.domain)} disabled={checkWaitingMX.isPending || deleteWaitingDomain.isPending}>
                          重新检测
                        </button>
                        <button className="btn-ghost" onClick={() => deleteWaitingDomain.mutate(domain)} disabled={deleteWaitingDomain.isPending || checkWaitingMX.isPending}>
                          <Trash2 size={14} />
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {inactiveDomains.length > 0 && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>不活跃域名</h2>
              <p>这些域名已被禁用，无法收发邮件。可重新激活恢复使用。</p>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{text.domains.domain}</th>
                  <th>状态</th>
                  <th>{text.domains.mode}</th>
                  <th>{text.domains.expiry}</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {inactiveDomains.map((domain) => (
                  <tr key={domain.id}>
                    <td className="font-medium">{domain.domain}</td>
                    <td>
                      <span className="status-pill status-bad">
                        <X size={13} />
                        不活跃
                      </span>
                    </td>
                    <td>{domainModeLabel(domain.mode, language)}</td>
                    <td>{formatDomainExpiry(domain.domain_expires_at, language)}</td>
                    <td>
                      <button
                        className="btn-ghost"
                        onClick={() => reactivateDomain.mutate(domain)}
                        disabled={reactivateDomain.isPending}
                      >
                        <RefreshCw size={14} />
                        重新激活
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {addOpen && <AddDomainDialog onClose={() => setAddOpen(false)} />}
    </>
  );
}

function AddDomainDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const text = useText();
  const [domainName, setDomainName] = useState('example.test');
  const [mode, setMode] = useState<Domain['mode']>('private');
  const [dns, setDNS] = useState<DNSInstructions | null>(null);
  const [submittedDomain, setSubmittedDomain] = useState<Domain | null>(null);
  const [checkResult, setCheckResult] = useState<DomainCheckResult | null>(null);
  const [mxCopied, markMxCopied] = useCopyState();
  const successRef = useRef<HTMLDivElement | null>(null);
  const installStatus = useQuery({ queryKey: ['install-status'], queryFn: () => api<InstallStatus>('/api/install/status'), retry: false });
  const normalizedDomain = normalizeDomainInput(domainName);
  const domainValid = isValidDomain(normalizedDomain);
  const inputTouched = domainName.trim().length > 0;
  const validationMessage = inputTouched && !domainValid ? '请输入有效域名，例如 example.com 或 *.example.com' : '';
  const cfg = installStatus.data?.config;
  const mxTarget = (dns?.mx.value || cfg?.expected_mx || 'mail.example.com').replace(/\.$/, '');
  const activeDomain = submittedDomain?.domain || normalizedDomain || 'example.com';
  const verified = isDomainReady(checkResult, submittedDomain);
  const submitted = Boolean(submittedDomain);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

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
        window.setTimeout(() => launchSuccessBurst({ origin: successRef.current, label: 'MX 已生效' }), 40);
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
        throw new Error('域名信息尚未加载完成，请重新打开弹窗后再试');
      }
      return postJSON<Domain | { deleted: boolean }>(`/api/domains/${submittedDomain.id}/mx-auto-retry`, { enabled });
    },
    onSuccess: (domain) => {
      if ('deleted' in domain) {
        setSubmittedDomain(null);
        setCheckResult(null);
        toast.error('等待验证已超时，域名已自动删除');
      } else {
        setSubmittedDomain(domain);
        toast.success(domain.mx_auto_retry_enabled ? '已开启后台等待验证' : '已停止后台等待验证');
      }
      invalidateDomainQueries(queryClient);
    },
    onError: (error) => toast.error(error.message)
  });

  const busy = createDomain.isPending || checkMX.isPending;
  const autoRetryBusy = toggleAutoRetry.isPending;
  const submitDisabled = submitted || !domainValid || busy;
  const statusMessage = checkResult?.check_message || (submitted ? '域名已提交。完成 DNS 设置后，在这里重新检测 MX。' : '提交后会立即在弹窗内检测 MX。');
  const autoRetryActive = Boolean(submittedDomain?.mx_auto_retry_enabled);
  const submittedPendingDeleteAt = submittedDomain ? pendingDeleteAt(submittedDomain) : undefined;
  const autoRetryMeta = autoRetryActive
    ? `后台将每 10 分钟检测一次，已重试 ${submittedDomain?.mx_auto_retry_count ?? 0} 次；下次检测：${formatRelativeTime(submittedDomain?.mx_auto_retry_next_at)}；预计自动删除：${formatRelativeTime(submittedPendingDeleteAt, '即将删除')}。`
    : `如果 DNS 服务商需要传播时间，可以让后台每 10 分钟自动检测一次。未验证域名会在 ${formatRelativeTime(submittedPendingDeleteAt, '即将删除')} 自动删除。`;

  return createPortal(
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal-panel add-domain-modal" role="dialog" aria-modal="true" aria-labelledby="add-domain-title">
        <div className="modal-header">
          <div>
            <h2 id="add-domain-title">添加域名</h2>
            <p>每次只添加一个域名，验证通过后才可以继续添加下一个。</p>
          </div>
          <IconButton title="关闭" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>

        <div className="add-domain-form">
          <label className="api-key-field">
            域名
            <input className="input" value={domainName} disabled={submitted} onChange={(event) => setDomainName(event.target.value)} placeholder="example.com 或 *.example.com" />
          </label>
          <p className="domain-input-hint">填写 <code>example.com</code> 表示接入 xxx@example.com；填写 <code>*.example.com</code> 表示接入任意子域名邮箱。</p>
          {validationMessage && <p className="domain-field-error">{validationMessage}</p>}

          <div className="segmented-control" role="group" aria-label="域名类型">
            <button type="button" className={`segment-choice ${mode === 'private' ? 'segment-choice-active' : ''}`} disabled={submitted} onClick={() => setMode('private')}>
              <ShieldCheck size={15} />
              私有域名
            </button>
            <button type="button" className={`segment-choice ${mode === 'public' ? 'segment-choice-active' : ''}`} disabled={submitted} onClick={() => setMode('public')}>
              <Globe2 size={15} />
              公开域名
            </button>
          </div>

          <div className="domain-modal-section">
            <div className="domain-modal-section-title">MX 设置</div>
            <div className="mx-target-card">
              <span>MX 指向</span>
              <code>{mxTarget}</code>
              <button className="btn-secondary" onClick={() => { copy(mxTarget); markMxCopied(); }}>
                {mxCopied ? <Check size={16} /> : <Copy size={16} />}
                {mxCopied ? text.common.copied : text.common.copy}
              </button>
            </div>
            <p className="dns-note">
              收普通邮箱时，把 <code>{activeDomain}</code> 的 MX 指到 <code>{mxTarget}</code>。如果添加的是 <code>*.{activeDomain}</code>，再给 <code>*.{activeDomain}</code> 添加同样的 MX。
            </p>
          </div>

          <div ref={successRef} className={`domain-verification-card ${verified && checkResult?.dns_status !== 'propagating' ? 'domain-verification-card-ok' : ''}`}>
            <div className="domain-verification-head">
              {dnsStatusPill(checkResult, verified, submitted)}
              <code>@{activeDomain}</code>
            </div>
            <p>{statusMessage}</p>
            {submitted && <DNSCheckDetails result={checkResult} />}
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
            {verified ? '完成' : text.common.cancel}
          </button>
          {verified ? (
            <button className="btn-primary" onClick={resetForm}>
              <Plus size={16} />
              添加下一个
            </button>
          ) : submittedDomain ? (
            <>
              <button className="btn-secondary" onClick={() => toggleAutoRetry.mutate(!autoRetryActive)} disabled={busy || autoRetryBusy}>
                {autoRetryBusy ? <Loader2 size={16} className="animate-spin" /> : <Clock3 size={16} />}
                {autoRetryActive ? '停止等待' : '后台等待'}
              </button>
              <button className="btn-primary" onClick={() => checkMX.mutate(submittedDomain.domain)} disabled={busy || autoRetryBusy}>
                {checkMX.isPending ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                重新检测
              </button>
            </>
          ) : (
            <button className="btn-primary" onClick={() => createDomain.mutate()} disabled={submitDisabled}>
              {createDomain.isPending || checkMX.isPending ? <Loader2 size={16} className="animate-spin" /> : <Globe2 size={16} />}
              提交并验证
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

function DNSCheckDetails({ result }: { result: DomainCheckResult | null }) {
  const rootChecks = result?.dns_checks || [];
  const wildcardChecks = result?.wildcard_dns_checks || [];
  if (!rootChecks.length && !wildcardChecks.length) return null;
  return (
    <details className="dns-check-details">
      <summary>
        <Info size={14} />
        DNS 传播详情
      </summary>
      <DNSProbeList title="根域 MX" probes={rootChecks} />
      {wildcardChecks.length > 0 && <DNSProbeList title="随机子域名 MX" probes={wildcardChecks} />}
    </details>
  );
}

function DNSProbeList({ title, probes }: { title: string; probes: DNSProbe[] }) {
  return (
    <div className="dns-probe-group">
      <div className="dns-probe-title">{title}</div>
      <div className="dns-probe-list">
        {probes.map((probe, index) => (
          <div className="dns-probe-row" key={`${probe.source}-${probe.resolver || index}`}>
            <span className={`dns-probe-state ${probe.verified ? 'dns-probe-ok' : probe.mx_records?.length ? 'dns-probe-warn' : 'dns-probe-bad'}`} />
            <span className="dns-probe-source">{probe.authoritative ? `${probe.source} ${probe.resolver || ''}` : probe.source}</span>
            <code>{probe.mx_records?.length ? probe.mx_records.join(', ') : probe.error || '未查询到 MX'}</code>
          </div>
        ))}
      </div>
    </div>
  );
}

function invalidateDomainQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['domains-all'] });
  queryClient.invalidateQueries({ queryKey: ['domains-available'] });
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

function retrySummary(domain: Domain) {
  const count = domain.mx_auto_retry_count ?? 0;
  if (domain.mx_auto_retry_enabled) {
    return `已重试 ${count} 次 · 下次 ${formatRelativeTime(domain.mx_auto_retry_next_at)}`;
  }
  return `已重试 ${count} 次 · 未开启`;
}

function pendingDeleteAt(domain: Domain) {
  if (domain.pending_delete_at) return domain.pending_delete_at;
  if (!domain.created_at) return undefined;
  const createdAt = new Date(domain.created_at);
  if (Number.isNaN(createdAt.getTime())) return undefined;
  return new Date(createdAt.getTime() + 2 * 60 * 60 * 1000).toISOString();
}

function formatAutoDeleteTime(domain: Domain) {
  return formatRelativeTime(pendingDeleteAt(domain), '即将删除');
}

function domainHealthBadge(domain: Domain) {
  if (!domain.active || !domain.mx_verified) return boolBadge(false);
  const expiresAt = domain.domain_expires_at ? new Date(domain.domain_expires_at) : null;
  const expiring = expiresAt && expiresAt.getTime() > Date.now() && expiresAt.getTime() < Date.now() + 30 * 24 * 60 * 60 * 1000;
  if (expiring) {
    return (
      <span className="status-pill status-warn">
        <AlertTriangle size={13} />
        Expiring
      </span>
    );
  }
  return boolBadge(true);
}

function isCheckReady(result: DomainCheckResult | null | undefined) {
  return Boolean(result?.mx_verified && (!result.wildcard_checked || result.wildcard_enabled));
}

function isDomainReady(result: DomainCheckResult | null, domain: Domain | null) {
  if (result) return isCheckReady(result);
  return Boolean(domain?.mx_verified && (!domain.wildcard_requested || domain.wildcard_enabled));
}

function dnsStatusPill(result: DomainCheckResult | null, verified: boolean, submitted: boolean) {
  const status = result?.dns_status;
  if (status === 'propagating') {
    return (
      <span className="status-pill status-warn">
        <Clock3 size={13} />
        {result?.mx_verified ? '权威已生效' : '传播中'}
      </span>
    );
  }
  if (verified) {
    return <StatusPill ok>MX 已生效</StatusPill>;
  }
  if (status === 'misconfigured') {
    return <StatusPill>配置不匹配</StatusPill>;
  }
  if (status === 'not_found') {
    return <StatusPill>未查询到 MX</StatusPill>;
  }
  return <StatusPill>{submitted ? '等待 MX 生效' : '待提交'}</StatusPill>;
}

function formatDateTime(value?: string) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function formatRelativeTime(value?: string, pastLabel = '即将检测') {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const diff = date.getTime() - Date.now();
  if (diff <= 0) return pastLabel;
  const minutes = Math.ceil(diff / 60000);
  if (minutes < 60) return `${minutes} 分钟后`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} 小时 ${rest} 分钟后` : `${hours} 小时后`;
}

function isValidDomain(domainName: string) {
  const labels = domainName.split('.');
  return labels.length > 1 && labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}
