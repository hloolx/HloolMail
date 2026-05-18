import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleUserRound, Clipboard, ExternalLink, Github, Loader2, Pencil, Save } from 'lucide-react';
import { toast } from 'sonner';
import { api, patchJSON } from '../api';
import type { OAuthProvider } from '../types';
import { useText } from '../locales';

type OAuthForm = {
  client_id: string;
  client_secret: string;
  redirect_url: string;
  enabled: boolean;
};

export function AdminOAuthPage() {
  const text = useText();
  const queryClient = useQueryClient();
  const providers = useQuery({
    queryKey: ['admin-oauth-providers'],
    queryFn: () => api<OAuthProvider[]>('/api/admin/oauth/providers'),
    retry: false
  });
  const [forms, setForms] = useState<Record<string, OAuthForm>>({});
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    if (!providers.data) return;
    setForms((current) => {
      const next = { ...current };
      for (const provider of providers.data) {
        if (editing === provider.provider) continue;
        next[provider.provider] = {
          client_id: provider.client_id || '',
          client_secret: '',
          redirect_url: provider.redirect_url || '',
          enabled: provider.enabled
        };
      }
      return next;
    });
  }, [editing, providers.data]);

  const updateProvider = useMutation({
    mutationFn: ({ provider, form }: { provider: OAuthProvider; form: OAuthForm }) => patchJSON<OAuthProvider>(`/api/admin/oauth/providers/${provider.provider}`, {
      client_id: form.client_id.trim(),
      client_secret: form.client_secret.trim() || undefined,
      redirect_url: form.redirect_url.trim(),
      enabled: form.enabled
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-oauth-providers'] });
      queryClient.invalidateQueries({ queryKey: ['oauth-providers'] });
      setEditing(null);
      toast.success(text.oauth.saved);
    },
    onError: (error) => toast.error(error.message)
  });

  const providerRows = useMemo(() => providers.data || [], [providers.data]);

  const setFormValue = (provider: string, key: keyof OAuthForm, value: string | boolean) => {
    setForms((current) => ({
      ...current,
      [provider]: {
        ...(current[provider] || emptyForm()),
        [key]: value
      }
    }));
  };

  const copyCallback = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(text.common.copied);
    } catch {
      toast.error(text.common.copyFailed);
    }
  };

  return (
    <div className="admin-oauth-page grid gap-4">
      <div className="admin-page-header">
        <div>
          <h1>{text.oauth.title}</h1>
          <p>{text.oauth.admin_desc}</p>
        </div>
      </div>

      {providers.isLoading && (
        <section className="panel admin-oauth-state">
          <Loader2 size={18} className="animate-spin" />
          <span>{text.common.loading}</span>
        </section>
      )}

      {providers.isError && (
        <section className="panel admin-oauth-state">
          <span>{text.oauth.load_error}</span>
        </section>
      )}

      {!providers.isLoading && !providers.isError && providerRows.length === 0 && (
        <section className="panel admin-oauth-state">
          <span>{text.oauth.empty}</span>
        </section>
      )}

      <div className="admin-oauth-grid">
        {providerRows.map((provider) => {
          const form = forms[provider.provider] || formFromProvider(provider);
          const callbackURL = provider.redirect_url || fallbackCallbackURL(provider);
          const Icon = provider.provider === 'github' ? Github : CircleUserRound;
          const isEditing = editing === provider.provider;
          return (
            <section className="panel admin-oauth-card" key={provider.provider}>
              <div className="admin-oauth-provider-head">
                <span className={`admin-oauth-mark admin-oauth-mark-${provider.provider}`}>
                  <Icon size={20} />
                </span>
                <div>
                  <h2>{provider.name}</h2>
                  <p>{provider.auth_url}</p>
                </div>
                <button className="admin-oauth-control admin-oauth-edit-control" type="button" onClick={() => setEditing(isEditing ? null : provider.provider)}>
                  <Pencil size={15} />
                  {isEditing ? text.common.close : text.oauth.edit}
                </button>
              </div>

              <div className="admin-oauth-statuses">
                <span className={`severity-pill ${provider.enabled ? 'severity-ok' : 'severity-warning'}`}>
                  {provider.enabled ? text.oauth.enabled : text.oauth.disabled}
                </span>
                <span className={`severity-pill ${provider.configured ? 'severity-ok' : 'severity-critical'}`}>
                  {provider.configured ? text.oauth.configured : text.oauth.not_configured}
                </span>
              </div>

              <div className="admin-oauth-summary">
                <div className="admin-oauth-summary-row">
                  <span className="admin-oauth-summary-label">{text.oauth.client_id}</span>
                  <b className="admin-oauth-summary-value">{maskClientID(provider.client_id || '') || '-'}</b>
                </div>
                <div className="admin-oauth-summary-row admin-oauth-summary-row-action">
                  <span className="admin-oauth-summary-label">{text.oauth.redirect_url}</span>
                  <code className="admin-oauth-summary-value">{callbackURL}</code>
                  <button className="admin-oauth-control" type="button" onClick={() => copyCallback(callbackURL)}>
                    <Clipboard size={15} />
                    {text.common.copy}
                  </button>
                </div>
                <div className="admin-oauth-summary-row admin-oauth-summary-row-action">
                  <span className="admin-oauth-summary-label">{text.oauth.login_entry}</span>
                  <code className="admin-oauth-summary-value">{provider.auth_url}</code>
                  <a className="admin-oauth-control" href={provider.auth_url} target="_blank" rel="noreferrer">
                    <ExternalLink size={15} />
                    {text.oauth.open_login}
                  </a>
                </div>
              </div>

              {isEditing && (
                <form className="admin-oauth-form" onSubmit={(event) => {
                  event.preventDefault();
                  updateProvider.mutate({ provider, form });
                }}>
                  <label className="user-form-field">
                    <span>{text.oauth.client_id}</span>
                    <input className="input" value={form.client_id} onChange={(event) => setFormValue(provider.provider, 'client_id', event.target.value)} placeholder="Iv1..." />
                  </label>
                  <label className="user-form-field">
                    <span>{text.oauth.client_secret}</span>
                    <input className="input" value={form.client_secret} onChange={(event) => setFormValue(provider.provider, 'client_secret', event.target.value)} placeholder={provider.client_secret ? '********' : ''} type="password" autoComplete="new-password" />
                  </label>
                  <label className="user-form-field admin-oauth-wide">
                    <span>{text.oauth.redirect_url}</span>
                    <input className="input" value={form.redirect_url} onChange={(event) => setFormValue(provider.provider, 'redirect_url', event.target.value)} placeholder={callbackURL} />
                  </label>
                  <label className="admin-toggle admin-oauth-wide">
                    <input type="checkbox" checked={form.enabled} onChange={(event) => setFormValue(provider.provider, 'enabled', event.target.checked)} />
                    <span>{form.enabled ? text.oauth.enabled : text.oauth.disabled}</span>
                  </label>
                  <div className="admin-oauth-form-actions">
                    <button className="btn-secondary" type="button" onClick={() => setEditing(null)}>{text.common.cancel}</button>
                    <button className="btn-primary" type="submit" disabled={updateProvider.isPending}>
                      {updateProvider.isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                      {text.oauth.save}
                    </button>
                  </div>
                </form>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function emptyForm(): OAuthForm {
  return { client_id: '', client_secret: '', redirect_url: '', enabled: false };
}

function formFromProvider(provider: OAuthProvider): OAuthForm {
  return {
    client_id: provider.client_id || '',
    client_secret: '',
    redirect_url: provider.redirect_url || '',
    enabled: provider.enabled
  };
}

function fallbackCallbackURL(provider: OAuthProvider) {
  const path = provider.auth_url.replace(/\/login$/, '/callback');
  return `${window.location.origin}${path}`;
}

function maskClientID(value: string) {
  const clean = value.trim();
  if (!clean) return '';
  if (clean.length <= 10) return `${clean.slice(0, 3)}...`;
  return `${clean.slice(0, 5)}...${clean.slice(-4)}`;
}
