import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check, Clipboard, Database, Globe2, Loader2, Lock, RefreshCw, Server } from 'lucide-react';
import { toast } from 'sonner';
import type { InstallDNSCheckResult, InstallResult, InstallStatus } from '../api';
import { postJSON } from '../api';
import { useText } from '../locales';
import { copy } from '../lib/clipboard';
import { launchSuccessBurst } from '../lib/confetti';
import { AppLogo, CodeBlock, Field, StatusPill } from '../components/shared';

type InstallForm = {
  admin_email: string;
  admin_password: string;
  database_driver: string;
  database_url: string;
  database_host: string;
  database_port: string;
  database_name: string;
  database_user: string;
  database_password: string;
  database_sslmode: string;
  public_base_url: string;
  mail_hostname: string;
  expected_mx: string;
  setup_domain: string;
  server_ip: string;
  check_wildcard: boolean;
  http_addr: string;
  smtp_addr: string;
  frontend_dist: string;
  dev_mode: boolean;
};

type DNSState = {
  key: string;
  result: InstallDNSCheckResult;
};

export function InstallPage({ status, onDone }: { status?: InstallStatus; onDone: () => void }) {
  const text = useText();
  const installButtonRef = useRef<HTMLButtonElement>(null);
  const runtimeConfigLocked = Boolean(status?.deployment?.config_locked);
  const [mailHostEdited, setMailHostEdited] = useState(false);
  const [dnsState, setDNSState] = useState<DNSState | null>(null);
  const [installResult, setInstallResult] = useState<InstallResult | null>(null);
  const [form, setForm] = useState<InstallForm>(() => buildInitialForm(status));

  const databaseURL = databaseURLFor(form);
  const dnsKey = makeDNSKey(form);
  const dnsVerified = dnsState?.key === dnsKey && dnsState.result.verified;

  const set = (changes: Partial<InstallForm>, dnsAffectsInstall = false) => {
    setForm((current) => ({ ...current, ...changes }));
    if (dnsAffectsInstall) setDNSState(null);
  };

  const setPublicURL = (value: string) => {
    setForm((current) => {
      const next: InstallForm = { ...current, public_base_url: value };
      const host = hostnameFromURL(value);
      if (host && !mailHostEdited) {
        next.mail_hostname = host;
        next.expected_mx = host;
        next.setup_domain = current.setup_domain || rootDomainGuess(host);
      }
      return next;
    });
    setDNSState(null);
  };

  const setMailHostname = (value: string) => {
    const host = cleanHost(value);
    setMailHostEdited(true);
    set({
      mail_hostname: host,
      expected_mx: host,
      setup_domain: form.setup_domain || rootDomainGuess(host)
    }, true);
  };

  const dnsCheck = useMutation({
    mutationFn: () => postJSON<InstallDNSCheckResult>('/api/install/dns-check', {
      domain: form.setup_domain,
      mail_hostname: form.mail_hostname,
      expected_mx: form.expected_mx,
      server_ip: form.server_ip,
      check_wildcard: form.check_wildcard,
      dev_mode: form.dev_mode
    }),
    onSuccess: (result) => {
      setDNSState({ key: makeDNSKey(form), result });
      if (result.verified) {
        toast.success('DNS 检测通过');
      } else {
        toast.error(result.message || 'DNS 还没有完全生效');
      }
    },
    onError: (error) => toast.error(error.message)
  });

  const install = useMutation({
    mutationFn: () => postJSON<InstallResult>('/api/install', {
      ...form,
      database_url: databaseURL
    }),
    onSuccess: (data) => {
      setInstallResult(data);
      const message = data.restart_required ? text.toast.installDoneRestart : text.toast.installDone;
      launchSuccessBurst({ origin: installButtonRef.current, label: text.toast.installDone });
      toast.success(message);
    },
    onError: (error) => toast.error(error.message)
  });

  if (installResult) {
    return (
      <InstallShell status={status} runtimeConfigLocked={runtimeConfigLocked}>
        <section className="panel install-complete-panel">
          <div className="panel-header">
            <div>
              <h2>安装已完成</h2>
              <p>{installResult.restart_required ? '数据库或运行时配置变更后，需要重启服务再进入控制台。' : '管理员账号已创建，下面是本次安装生成的 env 内容。'}</p>
            </div>
            <StatusPill ok>{installResult.env_written ? 'env 已写入' : '手动写入 env'}</StatusPill>
          </div>

          <div className="install-env-guidance">
            <div>
              <strong>{installResult.env_written ? '已写入配置文件' : '没有写入权限，请手动保存'}</strong>
              <span>
                目标路径：<code>{installResult.env_path || status?.config.env_path || '.env'}</code>
                {installResult.env_error ? `。写入失败：${installResult.env_error}` : ''}
              </span>
            </div>
            <button className="btn-secondary" onClick={(event) => copy(installResult.env_content, { event, celebrate: true, label: 'env 已复制' })}>
              <Clipboard size={16} />
              复制 env
            </button>
          </div>

          {installResult.deployment_kind === 'docker' && (
            <p className="install-note">
              Docker Compose 部署时，数据库、域名、端口这类运行时配置以宿主机项目目录的 <code>.env</code> 为准；安装器写入的 <code>{installResult.env_path}</code> 主要用于保存生成的密钥。修改宿主机 <code>.env</code> 后请执行 <code>docker compose up -d</code>。
            </p>
          )}

          <pre className="install-env-output">{installResult.env_content}</pre>

          <div className="install-actions">
            <button className="btn-primary" onClick={onDone}>
              <Check size={16} />
              我已确认 env，进入系统
            </button>
            {installResult.restart_required && <span className="install-warning-text">重启服务后再刷新页面，新的数据库与端口配置才会生效。</span>}
          </div>
        </section>
      </InstallShell>
    );
  }

  return (
    <InstallShell status={status} runtimeConfigLocked={runtimeConfigLocked}>
      <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[minmax(0,1fr)_25rem]">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>{text.install.title}</h2>
              <p>先填管理员与数据库，再确认 DNS 已经指向这台 HLOOL Mail 服务。</p>
            </div>
            <StatusPill ok>{runtimeConfigLocked ? 'Docker' : 'Install'}</StatusPill>
          </div>
          {runtimeConfigLocked && (
            <div className="install-lock-notice" role="status">
              <Lock size={18} />
              <span>
                <strong>{text.install.dockerManagedTitle}</strong>
                <small>{text.install.dockerManagedDesc}</small>
              </span>
            </div>
          )}

          <div className="install-section-title">
            <Server size={16} />
            管理员
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={text.install.adminEmail} value={form.admin_email} onChange={(value) => set({ admin_email: value })} />
            <Field label={text.install.adminPassword} value={form.admin_password} type="password" onChange={(value) => set({ admin_password: value })} />
          </div>

          <div className="install-section-title">
            <Database size={16} />
            数据库
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className="text-[var(--muted)]">{text.install.databaseType}</span>
              <select className="input" value={form.database_driver} disabled={runtimeConfigLocked} onChange={(event) => set({ database_driver: event.target.value })}>
                <option value="sqlite">SQLite</option>
                <option value="postgres">PostgreSQL</option>
              </select>
              {runtimeConfigLocked && <span className="text-xs leading-5 text-[var(--muted)]">{text.install.dockerManagedFieldHint}</span>}
            </label>
            {form.database_driver === 'sqlite' ? (
              <Field
                label="SQLite 数据库文件"
                value={form.database_url}
                onChange={(value) => set({ database_url: value })}
                disabled={runtimeConfigLocked}
                hint={runtimeConfigLocked ? text.install.dockerManagedFieldHint : '二进制部署可直接使用本地文件路径，例如 storage/hlool-mail.db。'}
              />
            ) : (
              <>
                <Field label="数据库主机" value={form.database_host} onChange={(value) => set({ database_host: value })} disabled={runtimeConfigLocked} />
                <Field label="数据库端口" value={form.database_port} onChange={(value) => set({ database_port: value })} disabled={runtimeConfigLocked} />
                <Field label="数据库名称" value={form.database_name} onChange={(value) => set({ database_name: value })} disabled={runtimeConfigLocked} />
                <Field label="数据库账号" value={form.database_user} onChange={(value) => set({ database_user: value })} disabled={runtimeConfigLocked} />
                <Field label="数据库密码" value={form.database_password} type="password" onChange={(value) => set({ database_password: value })} disabled={runtimeConfigLocked} />
                <Field label="SSL 模式" value={form.database_sslmode} onChange={(value) => set({ database_sslmode: value })} disabled={runtimeConfigLocked} hint="本机或 Compose 内网通常填 disable；云数据库通常填 require。" />
              </>
            )}
          </div>
          {form.database_driver === 'postgres' && (
            <div className="install-generated-line">
              <span>将写入 DATABASE_URL</span>
              <code>{runtimeConfigLocked ? status?.config.database_url || databaseURL : databaseURL}</code>
            </div>
          )}

          <div className="install-section-title">
            <Globe2 size={16} />
            访问与端口
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field
              label={text.install.publicURL}
              value={form.public_base_url}
              onChange={setPublicURL}
              disabled={runtimeConfigLocked}
              hint="网页打开这个地址，API 也用同一个地址再加 /api/...，例如 https://mail.xx.com/api/generate-email。"
            />
            <Field
              label="收信主机名 / MX 指向"
              value={form.mail_hostname}
              onChange={setMailHostname}
              disabled={runtimeConfigLocked}
              hint="通常就是上面访问地址里的主机名，但不要带 https://。MX 记录默认也指向它。"
            />
            <Field
              label={text.install.httpAddr}
              value={form.http_addr}
              onChange={(value) => set({ http_addr: value })}
              disabled={runtimeConfigLocked}
              hint="一般只影响二进制直跑监听端口。使用 Nginx、Caddy、宝塔等反向代理时，外部 HTTPS 端口在反代里处理，这里通常不用动。"
            />
            <label className="grid gap-1 text-sm">
              <span className="install-danger-label">{text.install.smtpAddr}</span>
              <input className="input install-danger-input" value={form.smtp_addr} disabled={runtimeConfigLocked} onChange={(event) => set({ smtp_addr: event.target.value })} />
              <span className="install-danger-hint">正式接收互联网邮件需要公网 TCP 25。测试可用 :2525；生产要么程序监听 :25，要么公网 25 转发到这里。</span>
            </label>
          </div>

          <label className="toggle-row mt-3">
            <input type="checkbox" checked={form.dev_mode} disabled={runtimeConfigLocked} onChange={(event) => set({ dev_mode: event.target.checked }, true)} />
            <span>{text.install.devMode}</span>
          </label>
          <button ref={installButtonRef} className="btn-primary mt-4" onClick={() => install.mutate()} disabled={install.isPending || !dnsVerified}>
            {install.isPending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            {dnsVerified ? text.install.finish : '先完成 DNS 检测'}
          </button>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>{text.install.dnsTitle}</h2>
              <p>检测通过后才可以完成安装。</p>
            </div>
            <StatusPill ok={Boolean(dnsVerified)}>{dnsVerified ? '已通过' : '待检测'}</StatusPill>
          </div>
          <div className="grid gap-3 text-sm">
            <Field label="要接入的邮箱域名" value={form.setup_domain} onChange={(value) => set({ setup_domain: cleanHost(value) }, true)} hint="例如要收 user@xx.com，就填 xx.com。" />
            <Field label="服务器公网 IP" value={form.server_ip} onChange={(value) => set({ server_ip: value.trim() }, true)} hint="用于确认收信主机名的 A/AAAA 记录确实指向这台服务器。" />
            <label className="toggle-row">
              <input type="checkbox" checked={form.check_wildcard} onChange={(event) => set({ check_wildcard: event.target.checked }, true)} />
              <span>同时检测泛域名 MX（用于 user@abc.xx.com）</span>
            </label>

            <CodeBlock>{`${form.mail_hostname || 'mail.xx.com'}. A ${form.server_ip || '你的服务器公网 IP'}`}</CodeBlock>
            <CodeBlock>{`${form.setup_domain || 'xx.com'}. MX 10 ${form.expected_mx || form.mail_hostname || 'mail.xx.com'}.`}</CodeBlock>
            {form.check_wildcard && <CodeBlock>{`*.${form.setup_domain || 'xx.com'}. MX 10 ${form.expected_mx || form.mail_hostname || 'mail.xx.com'}.`}</CodeBlock>}

            <button className="btn-secondary" onClick={() => dnsCheck.mutate()} disabled={dnsCheck.isPending}>
              {dnsCheck.isPending ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              检测 DNS
            </button>

            {dnsState?.key === dnsKey && <DNSCheckDetails result={dnsState.result} />}
            <p className="text-xs leading-5 text-[var(--muted)]">
              公开访问地址和收信主机名经常是同一个主机，比如 <code>https://hlool.00a.chat</code> 与 <code>hlool.00a.chat</code>。区别只是前者是带协议的 Web/API URL，后者是 DNS 里给 A/MX 使用的主机名。
            </p>
          </div>
        </section>
      </div>
    </InstallShell>
  );
}

function InstallShell({
  status,
  runtimeConfigLocked,
  children
}: {
  status?: InstallStatus;
  runtimeConfigLocked: boolean;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[var(--background)] px-4 py-8 text-[var(--foreground)]">
      <div className="install-brand mx-auto max-w-6xl">
        <AppLogo />
        <div className="install-brand-copy">
          <strong>HLOOL Mail</strong>
          <span>{runtimeConfigLocked ? 'Docker Compose 初始化' : '首次安装向导'}</span>
        </div>
        {status?.deployment?.kind && <StatusPill ok>{status.deployment.kind}</StatusPill>}
      </div>
      {children}
    </div>
  );
}

function DNSCheckDetails({ result }: { result: InstallDNSCheckResult }) {
  return (
    <div className="install-dns-result">
      <div className={result.verified ? 'install-dns-ok' : 'install-dns-bad'}>{result.message}</div>
      {result.address_check && (
        <DNSLine
          label="A/AAAA"
          ok={result.address_check.verified}
          value={result.address_check.addresses?.length ? result.address_check.addresses.join(', ') : result.address_check.error || '未查询到地址记录'}
        />
      )}
      {result.mx_check && (
        <DNSLine
          label="根域 MX"
          ok={result.mx_check.mx_verified}
          value={result.mx_check.mx_records?.length ? result.mx_check.mx_records.join(', ') : result.mx_check.check_message || '未查询到 MX'}
        />
      )}
      {result.wildcard_check && (
        <DNSLine
          label="泛域名 MX"
          ok={result.wildcard_check.mx_verified}
          value={result.wildcard_check.mx_records?.length ? result.wildcard_check.mx_records.join(', ') : result.wildcard_check.check_message || '未查询到 MX'}
        />
      )}
    </div>
  );
}

function DNSLine({ label, ok, value }: { label: string; ok: boolean; value: string }) {
  return (
    <div className="install-dns-line">
      <span className={ok ? 'install-dot-ok' : 'install-dot-bad'} />
      <strong>{label}</strong>
      <code>{value}</code>
    </div>
  );
}

function buildInitialForm(status?: InstallStatus): InstallForm {
  const publicURL = status?.config.public_base_url || 'http://localhost:3000';
  const host = cleanHost(status?.config.mail_hostname || hostnameFromURL(publicURL) || 'mail.example.com');
  const databaseDriver = status?.config.database_driver || 'sqlite';
  const postgres = parsePostgresURL(status?.config.database_url || '');
  return {
    admin_email: 'admin@example.com',
    admin_password: '',
    database_driver: databaseDriver,
    database_url: databaseDriver === 'postgres' ? '' : status?.config.database_url || 'storage/hlool-mail.db',
    database_host: postgres.host || '127.0.0.1',
    database_port: postgres.port || '5432',
    database_name: postgres.name || 'hloolmail',
    database_user: postgres.user || 'hloolmail',
    database_password: postgres.password || '',
    database_sslmode: postgres.sslmode || 'disable',
    public_base_url: publicURL,
    mail_hostname: host,
    expected_mx: cleanHost(status?.config.expected_mx || host),
    setup_domain: rootDomainGuess(host),
    server_ip: '',
    check_wildcard: true,
    http_addr: status?.config.http_addr || ':3000',
    smtp_addr: status?.config.smtp_addr || ':2525',
    frontend_dist: 'web/dist',
    dev_mode: true
  };
}

function parsePostgresURL(value: string): Partial<{ host: string; port: string; name: string; user: string; password: string; sslmode: string }> {
  if (!value || value.includes('***')) return {};
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') return {};
    return {
      host: parsed.hostname,
      port: parsed.port,
      name: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      sslmode: parsed.searchParams.get('sslmode') || 'disable'
    };
  } catch {
    return {};
  }
}

function databaseURLFor(form: InstallForm) {
  if (form.database_driver !== 'postgres') return form.database_url;
  const host = form.database_port ? `${form.database_host}:${form.database_port}` : form.database_host;
  const auth = `${encodeURIComponent(form.database_user)}:${encodeURIComponent(form.database_password)}@`;
  const dbName = encodeURIComponent(form.database_name || 'hloolmail');
  const sslmode = encodeURIComponent(form.database_sslmode || 'disable');
  return `postgres://${auth}${host}/${dbName}?sslmode=${sslmode}`;
}

function hostnameFromURL(value: string) {
  const input = value.trim();
  if (!input) return '';
  try {
    return cleanHost(new URL(input.includes('://') ? input : `https://${input}`).hostname);
  } catch {
    return '';
  }
}

function cleanHost(value: string) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '');
}

function rootDomainGuess(host: string) {
  const parts = cleanHost(host).split('.').filter(Boolean);
  if (parts.length < 2) return '';
  return parts.slice(-2).join('.');
}

function makeDNSKey(form: InstallForm) {
  return [form.setup_domain, form.mail_hostname, form.expected_mx, form.server_ip, String(form.check_wildcard), String(form.dev_mode)].join('|');
}
