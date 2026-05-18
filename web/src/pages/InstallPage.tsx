import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check, Lock } from 'lucide-react';
import { toast } from 'sonner';
import type { InstallStatus } from '../api';
import { postJSON } from '../api';
import { useText } from '../locales';
import { launchSuccessBurst } from '../lib/confetti';
import { CodeBlock, Field, StatusPill } from '../components/shared';

export function InstallPage({ status, onDone }: { status?: InstallStatus; onDone: () => void }) {
  const text = useText();
  const installButtonRef = useRef<HTMLButtonElement>(null);
  const runtimeConfigLocked = Boolean(status?.deployment?.config_locked);
  const [form, setForm] = useState({
    admin_email: 'admin@example.com',
    admin_password: '',
    database_driver: status?.config.database_driver || 'sqlite',
    database_url: status?.config.database_url || 'storage/hlool-mail.db',
    public_base_url: status?.config.public_base_url || 'http://localhost:3000',
    mail_hostname: status?.config.mail_hostname || 'mail.example.com',
    expected_mx: status?.config.expected_mx || 'mail.example.com',
    http_addr: status?.config.http_addr || ':3000',
    smtp_addr: status?.config.smtp_addr || ':2525',
    frontend_dist: 'web/dist',
    dev_mode: true
  });
  const install = useMutation({
    mutationFn: () => postJSON<{ installed: boolean; restart_required: boolean }>('/api/install', form),
    onSuccess: (data) => {
      const message = data.restart_required ? text.toast.installDoneRestart : text.toast.installDone;
      launchSuccessBurst({ origin: installButtonRef.current, label: text.toast.installDone });
      toast.success(message);
      onDone();
    },
    onError: (error) => toast.error(error.message)
  });
  const set = (key: keyof typeof form, value: string | boolean) => setForm((current) => ({ ...current, [key]: value }));

  return (
    <div className="min-h-screen bg-[var(--background)] px-4 py-8 text-[var(--foreground)]">
      <div className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-[1fr_24rem]">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>{text.install.title}</h2>
              <p>{text.install.desc}</p>
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
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={text.install.adminEmail} value={form.admin_email} onChange={(value) => set('admin_email', value)} />
            <Field label={text.install.adminPassword} value={form.admin_password} type="password" onChange={(value) => set('admin_password', value)} />
            <label className="grid gap-1 text-sm">
              <span className="text-[var(--muted)]">{text.install.databaseType}</span>
              <select className="input" value={form.database_driver} disabled={runtimeConfigLocked} onChange={(event) => set('database_driver', event.target.value)}>
                <option value="sqlite">SQLite</option>
                <option value="postgres">PostgreSQL</option>
              </select>
              {runtimeConfigLocked && <span className="text-xs leading-5 text-[var(--muted)]">{text.install.dockerManagedFieldHint}</span>}
            </label>
            <Field
              label={text.install.databaseURL}
              value={form.database_url}
              onChange={(value) => set('database_url', value)}
              disabled={runtimeConfigLocked}
              hint={runtimeConfigLocked ? text.install.dockerManagedFieldHint : undefined}
            />
            <Field
              label={text.install.publicURL}
              value={form.public_base_url}
              onChange={(value) => set('public_base_url', value)}
              disabled={runtimeConfigLocked}
              hint={text.install.publicURLHint}
            />
            <Field
              label={text.install.mailHostname}
              value={form.mail_hostname}
              onChange={(value) => set('mail_hostname', value)}
              disabled={runtimeConfigLocked}
              hint={text.install.mailHostnameHint}
            />
            <Field
              label={text.install.expectedMX}
              value={form.expected_mx}
              onChange={(value) => set('expected_mx', value)}
              disabled={runtimeConfigLocked}
              hint={text.install.expectedMXHint}
            />
            <Field label={text.install.httpAddr} value={form.http_addr} onChange={(value) => set('http_addr', value)} disabled={runtimeConfigLocked} hint={text.install.httpAddrHint} />
            <Field label={text.install.smtpAddr} value={form.smtp_addr} onChange={(value) => set('smtp_addr', value)} disabled={runtimeConfigLocked} hint={text.install.smtpAddrHint} />
          </div>
          <label className="toggle-row mt-3">
            <input type="checkbox" checked={form.dev_mode} disabled={runtimeConfigLocked} onChange={(event) => set('dev_mode', event.target.checked)} />
            <span>{text.install.devMode}</span>
          </label>
          <button ref={installButtonRef} className="btn-primary mt-4" onClick={() => install.mutate()} disabled={install.isPending}>
            <Check size={16} />
            {text.install.finish}
          </button>
        </section>
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>{text.install.dnsTitle}</h2>
              <p>{text.install.dnsDesc}</p>
            </div>
          </div>
          <div className="grid gap-3 text-sm">
            <CodeBlock>{`${form.mail_hostname}. A ${text.install.dnsA}`}</CodeBlock>
            <CodeBlock>{`xx.com. MX 10 ${form.expected_mx}.`}</CodeBlock>
            <CodeBlock>{`*.xx.com. MX 10 ${form.expected_mx}.`}</CodeBlock>
            <p className="text-xs leading-5 text-[var(--muted)]">
              {text.install.dnsHint}
            </p>
            <p className="text-xs leading-5 text-[var(--muted)]">
              {text.install.dnsPortHint}
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
