import { useRef, useState, useEffect, useCallback, type FormEvent } from 'react';
import type { ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check, Clipboard, Database, ExternalLink, Globe2, Lock, RefreshCw, Server, Shield } from 'lucide-react';
import { toast } from 'sonner';
import type { InstallDNSCheckResult, InstallResult, InstallStatus, User } from '../api';
import { postJSON } from '../api';
import { useText } from '../locales';
import { copy } from '../lib/clipboard';
import { notifySuccess } from '../lib/feedback';
import { AppLogo, CodeBlock, Field, LoadingIndicator, StatusPill } from '../components/shared';
import { StepIndicator } from './InstallStepIndicator';
import { DNSCheckDetails, installDNSMessage } from './InstallDNSVerify';

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

type InstallFieldErrors = Partial<Record<'admin_email' | 'admin_password', string>>;

const INSTALL_FORM_KEY = 'hlool:install-form';
const DEV_SKIP_INSTALL_KEY = 'hlool_skip_install';

export function InstallPage({ status, onDone }: { status?: InstallStatus; onDone: () => void }) {
  const text = useText();
  const installButtonRef = useRef<HTMLButtonElement>(null);
  const dnsCheckButtonRef = useRef<HTMLButtonElement>(null);
  const logoTapRef = useRef({ count: 0, since: 0 });
  const runtimeConfigLocked = Boolean(status?.deployment?.config_locked);
  const [mailHostEdited, setMailHostEdited] = useState(false);
  const [dnsState, setDNSState] = useState<DNSState | null>(null);
  const [installResult, setInstallResult] = useState<InstallResult | null>(null);
  const [form, setForm] = useState<InstallForm>(() => loadInstallForm(status));
  const [fieldErrors, setFieldErrors] = useState<InstallFieldErrors>({});

  // Persist form to sessionStorage on every change
  useEffect(() => {
    try { sessionStorage.setItem(INSTALL_FORM_KEY, JSON.stringify(sanitizeInstallFormForStorage(form))); } catch { /* quota exceeded */ }
  }, [form]);

  const databaseURL = databaseURLFor(form);
  const dnsKey = makeDNSKey(form);
  const dnsVerified = dnsState?.key === dnsKey && dnsState.result.verified;

  const set = (changes: Partial<InstallForm>, dnsAffectsInstall = false) => {
    setForm((current) => ({ ...current, ...changes }));
    if ('admin_email' in changes || 'admin_password' in changes) {
      setFieldErrors((current) => {
        const next = { ...current };
        if ('admin_email' in changes) delete next.admin_email;
        if ('admin_password' in changes) delete next.admin_password;
        return next;
      });
    }
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
        notifySuccess(text.install.dnsPassed, { origin: dnsCheckButtonRef.current });
        // Scroll to the install button
        setTimeout(() => {
          installButtonRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 120);
      } else {
        toast.error(installDNSMessage(result, text));
      }
    },
    onError: (error) => toast.error(error.message)
  });

  const install = useMutation({
    mutationFn: (override?: InstallForm) => {
      const data = override || form;
      return postJSON<InstallResult>('/api/install', {
        ...data,
        database_url: override ? databaseURLFor(override) : databaseURL
      });
    },
    onSuccess: async (data) => {
      try { sessionStorage.removeItem(INSTALL_FORM_KEY); } catch { /* ignore */ }
      const isDevSkip = import.meta.env.DEV && getDevSkipInstall();
      if (!isDevSkip) {
        setInstallResult(data);
      }
      // Dev skip: auto-login after install
      if (isDevSkip) {
        try {
          await postJSON<User>('/api/auth/login', { email: 'dev@localhost', password: 'devdevdev' });
        } catch { /* fall through — user can log in manually */ }
      }
      const message = data.restart_required ? text.toast.installDoneRestart : text.toast.installDone;
      if (!isDevSkip) {
        notifySuccess(message, { origin: installButtonRef.current });
      } else {
        notifySuccess(message);
      }
      onDone();
    },
    onError: (error) => toast.error(error.message)
  });

  // Client-side validation
  const validate = useCallback((): { message: string | null; fieldErrors: InstallFieldErrors; focusId?: string } => {
    const nextFieldErrors: InstallFieldErrors = {};
    if (!form.admin_email.trim()) {
      nextFieldErrors.admin_email = text.install.validationEmailRequired;
      return { message: text.install.validationEmailRequired, fieldErrors: nextFieldErrors, focusId: 'admin-email' };
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.admin_email.trim())) {
      nextFieldErrors.admin_email = text.install.validationEmailFormat;
      return { message: text.install.validationEmailFormat, fieldErrors: nextFieldErrors, focusId: 'admin-email' };
    }
    if (form.admin_password.length < 8) {
      nextFieldErrors.admin_password = text.install.validationPasswordLength;
      return { message: text.install.validationPasswordLength, fieldErrors: nextFieldErrors, focusId: 'admin-password' };
    }
    if (form.database_driver === 'sqlite' && !form.database_url.trim()) return { message: text.install.validationDatabaseRequired, fieldErrors: nextFieldErrors };
    if (form.database_driver === 'postgres' && (!form.database_host.trim() || !form.database_name.trim() || !form.database_user.trim())) return { message: text.install.validationDatabaseRequired, fieldErrors: nextFieldErrors };
    if (!/^https?:\/\/.+/.test(form.public_base_url.trim())) return { message: text.install.validationPublicURLFormat, fieldErrors: nextFieldErrors };
    return { message: null, fieldErrors: nextFieldErrors };
  }, [form, text]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    // In Docker mode, skip DNS requirement
    if (!runtimeConfigLocked && !dnsVerified) {
      toast.error(text.install.finishBtnDNS);
      return;
    }
    const validation = validate();
    setFieldErrors(validation.fieldErrors);
    if (validation.message) {
      toast.error(validation.message);
      const focusId = validation.focusId;
      if (focusId) {
        window.requestAnimationFrame(() => document.getElementById(focusId)?.focus());
      }
      return;
    }
    install.mutate(undefined);
  };

  const handleLogoTap = useCallback(() => {
    if (!import.meta.env.DEV) return;
    const now = Date.now();
    const t = logoTapRef.current;
    if (now - t.since > 2000) { t.count = 0; }
    t.since = now;
    t.count += 1;
    if (t.count >= 3) {
      t.count = 0;
      setDevSkipInstall();
      const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
      const devForm: InstallForm = {
        admin_email: 'dev@localhost',
        admin_password: 'devdevdev',
        database_driver: 'sqlite',
        database_url: 'storage/hlool-mail.db',
        database_host: '',
        database_port: '5432',
        database_name: '',
        database_user: '',
        database_password: '',
        database_sslmode: 'disable',
        public_base_url: origin,
        mail_hostname: 'mail.example.com',
        expected_mx: 'mail.example.com',
        setup_domain: 'example.com',
        server_ip: '',
        check_wildcard: false,
        http_addr: ':3000',
        smtp_addr: ':2525',
        frontend_dist: 'web/dist',
        dev_mode: true,
      };
      setForm(devForm);
      install.mutate(devForm);
    }
  }, [onDone, install]);

  // Derive step from state
  const currentStep = runtimeConfigLocked ? 2 : (dnsVerified ? 2 : (form.admin_email && form.admin_password ? 1 : 0));

  // ---- Install Complete View ----
  if (installResult) {
    return (
      <InstallShell status={status} runtimeConfigLocked={runtimeConfigLocked} text={text} onLogoTap={handleLogoTap}>
        <section className="panel install-complete-panel">
          <div className="panel-header">
            <div>
              <h2>{text.install.completeTitle}</h2>
              <p>{installResult.restart_required ? text.install.completeDescRestart : text.install.completeDesc}</p>
            </div>
            <StatusPill ok>{installResult.env_written ? text.install.envWrittenPill : text.install.envManualPill}</StatusPill>
          </div>

          <div className="install-env-guidance">
            <div>
              <strong>{installResult.env_written ? text.install.envWrittenInfo : text.install.envManualInfo}</strong>
              <span>
                {text.install.envTargetPathLabel}：<code>{installResult.env_path || status?.config?.env_path || '.env'}</code>
                {installResult.env_error ? `。${text.install.envWriteFailed}：${installResult.env_error}` : ''}
              </span>
            </div>
            <button className="btn-secondary" onClick={(event) => copy(installResult.env_content, { event, celebrate: true, label: text.install.envCopied })}>
              <Clipboard size={16} />
              {text.install.copyEnvBtn}
            </button>
          </div>

          {installResult.deployment_kind === 'docker' && (
            <p className="install-note">
              {text.install.dockerCompleteNote.replace('{path}', installResult.env_path || '.env')}
            </p>
          )}

          <div className="install-env-warning">
            <Shield size={16} />
            <span>{text.install.envSecurityWarning}</span>
          </div>

          <pre className="install-env-output">{installResult.env_content}</pre>

          <div className="install-actions">
            <button className="btn-primary" onClick={onDone}>
              <Check size={16} />
              {text.install.confirmEnter}
            </button>
            {installResult.restart_required && <span className="install-warning-text">{text.install.restartHint}</span>}
          </div>
        </section>
      </InstallShell>
    );
  }

  // ---- Main Install Form ----
  return (
    <InstallShell status={status} runtimeConfigLocked={runtimeConfigLocked} text={text} onLogoTap={handleLogoTap}>
      <StepIndicator current={currentStep} text={text} />

      <form className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[minmax(0,1fr)_25rem]" onSubmit={handleSubmit} noValidate>
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>{text.install.title}</h2>
              <p>{text.install.subtitle}</p>
            </div>
            <StatusPill ok>{runtimeConfigLocked ? text.install.pillDocker : text.install.pillInstall}</StatusPill>
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
            {text.install.sectionAdmin}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field id="admin-email" required label={text.install.adminEmail} value={form.admin_email} error={fieldErrors.admin_email} onChange={(value) => set({ admin_email: value })} />
            <Field id="admin-password" required label={text.install.adminPassword} value={form.admin_password} type="password" error={fieldErrors.admin_password} onChange={(value) => set({ admin_password: value })} />
          </div>

          <div className="install-section-title">
            <Database size={16} />
            {text.install.sectionDatabase}
          </div>
          <div className="grid gap-3 md:grid-cols-2 items-start">
            <label className="grid gap-1 text-sm">
              <span className="text-[var(--muted)]">{text.install.databaseType}</span>
              <select className="input" value={form.database_driver} disabled={runtimeConfigLocked} onChange={(event) => set({ database_driver: event.target.value })}>
                <option value="sqlite">SQLite</option>
                <option value="postgres">PostgreSQL</option>
              </select>
              {runtimeConfigLocked && <span className="text-xs leading-5 text-[var(--muted)]">{text.install.dockerManagedFieldHint}</span>}
            </label>
            <span className="install-db-type-hint">{text.install.dbTypeHint}</span>
            {form.database_driver === 'sqlite' ? (
              <Field
                id="sqlite-file"
                required
                label={text.install.sqliteFile}
                value={form.database_url}
                onChange={(value) => set({ database_url: value })}
                disabled={runtimeConfigLocked}
                hint={runtimeConfigLocked ? text.install.dockerManagedFieldHint : text.install.sqliteFileHint}
              />
            ) : (
              <>
                <Field id="db-host" required label={text.install.dbHost} value={form.database_host} onChange={(value) => set({ database_host: value })} disabled={runtimeConfigLocked} />
                <Field id="db-port" label={text.install.dbPort} value={form.database_port} onChange={(value) => set({ database_port: value })} disabled={runtimeConfigLocked} />
                <Field id="db-name" required label={text.install.dbName} value={form.database_name} onChange={(value) => set({ database_name: value })} disabled={runtimeConfigLocked} />
                <Field id="db-user" required label={text.install.dbUser} value={form.database_user} onChange={(value) => set({ database_user: value })} disabled={runtimeConfigLocked} />
                <Field id="db-password" label={text.install.dbPassword} value={form.database_password} type="password" onChange={(value) => set({ database_password: value })} disabled={runtimeConfigLocked} />
                <Field id="db-ssl" label={text.install.dbSSLMode} value={form.database_sslmode} onChange={(value) => set({ database_sslmode: value })} disabled={runtimeConfigLocked} hint={text.install.dbSSLHint} />
              </>
            )}
          </div>
          {form.database_driver === 'postgres' && (
            <div className="install-generated-line">
              <span>{text.install.dbGeneratedURL}</span>
              <code>{runtimeConfigLocked ? status?.config?.database_url || databaseURL : databaseURL}</code>
            </div>
          )}

          <div className="install-section-title">
            <Globe2 size={16} />
            {text.install.sectionAccess}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field
              id="public-url"
              required
              label={text.install.publicURL}
              value={form.public_base_url}
              onChange={setPublicURL}
              disabled={runtimeConfigLocked}
              hint={text.install.publicURLHint}
            />
            <Field
              id="mail-hostname"
              label={text.install.mailHostnameLabel}
              value={form.mail_hostname}
              onChange={setMailHostname}
              disabled={runtimeConfigLocked}
              hint={text.install.mailHostnameHint2}
            />
            <Field
              id="http-addr"
              label={text.install.httpAddr}
              value={form.http_addr}
              onChange={(value) => set({ http_addr: value })}
              disabled={runtimeConfigLocked}
              hint={text.install.httpAddrHint2}
            />
            <label className="grid gap-1 text-sm">
              <span className="install-danger-label">{text.install.smtpAddr}</span>
              <input className="input install-danger-input" value={form.smtp_addr} disabled={runtimeConfigLocked} onChange={(event) => set({ smtp_addr: event.target.value })} />
              <span className="install-danger-hint">{text.install.smtpBTPanelHint}</span>
            </label>
          </div>

          <div className="segmented-control mt-3">
            <button type="button" className={`segment-choice ${!form.dev_mode ? 'segment-choice-active' : ''}`} disabled={runtimeConfigLocked} onClick={() => set({ dev_mode: false }, true)}>
              Production
            </button>
            <button type="button" className={`segment-choice ${form.dev_mode ? 'segment-choice-active' : ''}`} disabled={runtimeConfigLocked} onClick={() => set({ dev_mode: true }, true)}>
              Development
            </button>
          </div>
          {form.dev_mode && (
            <p className="install-dev-warning">
              <Shield size={14} />
              <span>{text.install.devModeWarning}</span>
            </p>
          )}

          <button
            ref={installButtonRef}
            type="submit"
            className="btn-primary mt-4"
            disabled={install.isPending || (!runtimeConfigLocked && !dnsVerified)}
          >
            {install.isPending ? <LoadingIndicator /> : <Check size={16} />}
            {runtimeConfigLocked ? text.install.finish : (dnsVerified ? text.install.finish : text.install.finishBtnDNS)}
          </button>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>{text.install.dnsTitle}</h2>
              <p>{text.install.dnsSubtitle}</p>
            </div>
            <StatusPill ok={Boolean(dnsVerified)}>{dnsVerified ? text.install.pillPassed : text.install.pillPending}</StatusPill>
          </div>
          <div className="grid gap-3 text-sm">
            <Field id="setup-domain" label={text.install.setupDomainLabel} value={form.setup_domain} onChange={(value) => set({ setup_domain: cleanHost(value) }, true)} hint={text.install.setupDomainHint} />
            <Field id="server-ip" label={text.install.serverIPLabel} value={form.server_ip} onChange={(value) => set({ server_ip: value.trim() }, true)} hint={text.install.serverIPHint} />
            <div className="segmented-control">
              <button type="button" className={`segment-choice ${!form.check_wildcard ? 'segment-choice-active' : ''}`} onClick={() => set({ check_wildcard: false }, true)}>
                Skip Wildcard
              </button>
              <button type="button" className={`segment-choice ${form.check_wildcard ? 'segment-choice-active' : ''}`} onClick={() => set({ check_wildcard: true }, true)}>
                Check Wildcard
              </button>
            </div>

            <CodeBlock>{`${form.mail_hostname || 'mail.xx.com'}. A ${form.server_ip || text.install.dnsA}`}</CodeBlock>
            <CodeBlock>{`${form.setup_domain || 'xx.com'}. MX 10 ${form.expected_mx || form.mail_hostname || 'mail.xx.com'}.`}</CodeBlock>
            {form.check_wildcard && <CodeBlock>{`*.${form.setup_domain || 'xx.com'}. MX 10 ${form.expected_mx || form.mail_hostname || 'mail.xx.com'}.`}</CodeBlock>}

            <button ref={dnsCheckButtonRef} className="btn-secondary" type="button" onClick={() => dnsCheck.mutate()} disabled={dnsCheck.isPending}>
              {dnsCheck.isPending ? <LoadingIndicator /> : <RefreshCw size={16} />}
              {text.install.dnsDetectBtn}
            </button>

            {dnsState?.key === dnsKey && <DNSCheckDetails result={dnsState.result} text={text} />}
            <p className="text-xs leading-5 text-[var(--muted)]">
              {text.install.dnsURLHint}
            </p>

            {/* Mobile install button inside DNS panel, hidden on desktop */}
            <button
              type="submit"
              className="btn-primary install-mobile-install mt-2"
              disabled={install.isPending || (!runtimeConfigLocked && !dnsVerified)}
            >
              {install.isPending ? <LoadingIndicator /> : <Check size={16} />}
              {runtimeConfigLocked ? text.install.finish : (dnsVerified ? text.install.finish : text.install.finishBtnDNS)}
            </button>
          </div>
        </section>
      </form>
    </InstallShell>
  );
}

function InstallShell({
  status,
  runtimeConfigLocked,
  text,
  children,
  onLogoTap
}: {
  status?: InstallStatus;
  runtimeConfigLocked: boolean;
  text: ReturnType<typeof useText>;
  children: ReactNode;
  onLogoTap?: () => void;
}) {
  return (
    <div className="min-h-screen bg-[var(--background)] px-4 py-8 text-[var(--foreground)]">
      <div className="install-brand mx-auto max-w-6xl">
        <AppLogo onClick={onLogoTap} />
        <div className="install-brand-copy">
          <strong>HLOOL Mail</strong>
          <span>{runtimeConfigLocked ? text.install.installTitleDocker : text.install.installTitleDefault}</span>
        </div>
        {status?.deployment?.kind && <StatusPill ok>{status.deployment.kind}</StatusPill>}
        <a
          className="install-github-link"
          href="https://github.com/hloolx/HloolMail"
          target="_blank"
          rel="noopener noreferrer"
          title="GitHub"
        >
          <ExternalLink size={16} />
          <span>GitHub</span>
        </a>
      </div>
      {children}
    </div>
  );
}

type PersistedInstallForm = Omit<InstallForm, 'admin_password' | 'database_password'>;

function clearInstallSecrets(form: InstallForm): InstallForm {
  return { ...form, admin_password: '', database_password: '' };
}

function loadInstallForm(status?: InstallStatus): InstallForm {
  const defaults = clearInstallSecrets(buildInitialForm(status));
  if (typeof window === 'undefined') return defaults;
  try {
    const saved = sessionStorage.getItem(INSTALL_FORM_KEY);
    if (!saved) return defaults;
    return mergeSavedInstallForm(defaults, JSON.parse(saved));
  } catch {
    return defaults;
  }
}

function sanitizeInstallFormForStorage(form: InstallForm): PersistedInstallForm {
  const { admin_password: _adminPassword, database_password: _databasePassword, ...safeForm } = form;
  return {
    ...safeForm,
    database_url: sanitizeDatabaseURLForStorage(safeForm.database_url),
  };
}

function mergeSavedInstallForm(defaults: InstallForm, saved: unknown): InstallForm {
  const next = clearInstallSecrets(defaults);
  if (!saved || typeof saved !== 'object') return next;
  const value = saved as Record<string, unknown>;

  if (typeof value.admin_email === 'string') next.admin_email = value.admin_email;
  if (typeof value.database_driver === 'string') next.database_driver = value.database_driver;
  if (typeof value.database_url === 'string') next.database_url = sanitizeDatabaseURLForStorage(value.database_url);
  if (typeof value.database_host === 'string') next.database_host = value.database_host;
  if (typeof value.database_port === 'string') next.database_port = value.database_port;
  if (typeof value.database_name === 'string') next.database_name = value.database_name;
  if (typeof value.database_user === 'string') next.database_user = value.database_user;
  if (typeof value.database_sslmode === 'string') next.database_sslmode = value.database_sslmode;
  if (typeof value.public_base_url === 'string') next.public_base_url = value.public_base_url;
  if (typeof value.mail_hostname === 'string') next.mail_hostname = value.mail_hostname;
  if (typeof value.expected_mx === 'string') next.expected_mx = value.expected_mx;
  if (typeof value.setup_domain === 'string') next.setup_domain = value.setup_domain;
  if (typeof value.server_ip === 'string') next.server_ip = value.server_ip;
  if (typeof value.check_wildcard === 'boolean') next.check_wildcard = value.check_wildcard;
  if (typeof value.http_addr === 'string') next.http_addr = value.http_addr;
  if (typeof value.smtp_addr === 'string') next.smtp_addr = value.smtp_addr;
  if (typeof value.frontend_dist === 'string') next.frontend_dist = value.frontend_dist;
  if (typeof value.dev_mode === 'boolean') next.dev_mode = value.dev_mode;

  return clearInstallSecrets(next);
}

function sanitizeDatabaseURLForStorage(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    const sensitiveProtocol = parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:' || parsed.protocol === 'mysql:' || parsed.protocol === 'mariadb:';
    const hasSecretParam = ['password', 'pass', 'pwd'].some((key) => parsed.searchParams.has(key));
    if (sensitiveProtocol || parsed.username || parsed.password || hasSecretParam) return '';
  } catch {
    if (/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) && trimmed.includes('@')) return '';
  }
  if (/[?&](password|pass|pwd)=/i.test(trimmed)) return '';
  return value;
}

function getDevSkipInstall() {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false;
  try {
    return sessionStorage.getItem(DEV_SKIP_INSTALL_KEY) === '1';
  } catch {
    return false;
  }
}

function setDevSkipInstall() {
  if (!import.meta.env.DEV || typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(DEV_SKIP_INSTALL_KEY, '1');
  } catch {
    /* ignore */
  }
}

function buildInitialForm(status?: InstallStatus): InstallForm {
  const publicURL = status?.config?.public_base_url || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000');
  const host = cleanHost(status?.config?.mail_hostname || hostnameFromURL(publicURL) || 'mail.example.com');
  const databaseDriver = status?.config?.database_driver || 'sqlite';
  const postgres = parsePostgresURL(status?.config?.database_url || '');
  return {
    admin_email: 'admin@example.com',
    admin_password: '',
    database_driver: databaseDriver,
    database_url: databaseDriver === 'postgres' ? '' : status?.config?.database_url || 'storage/hlool-mail.db',
    database_host: postgres.host || '127.0.0.1',
    database_port: postgres.port || '5432',
    database_name: postgres.name || 'hloolmail',
    database_user: postgres.user || 'hloolmail',
    database_password: postgres.password || '',
    database_sslmode: postgres.sslmode || 'disable',
    public_base_url: publicURL,
    mail_hostname: host,
    expected_mx: cleanHost(status?.config?.expected_mx || host),
    setup_domain: rootDomainGuess(host),
    server_ip: '',
    check_wildcard: true,
    http_addr: status?.config?.http_addr || ':3000',
    smtp_addr: status?.config?.smtp_addr || ':2525',
    frontend_dist: 'web/dist',
    dev_mode: false
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
