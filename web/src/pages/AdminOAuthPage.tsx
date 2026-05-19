import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { CircleUserRound, Clipboard, ExternalLink, Github, Loader2, Pencil, Save } from 'lucide-react';
import { toast } from 'sonner';
import { api, patchJSON } from '../api';
import type { OAuthProvider } from '../types';
import { ConfirmModal } from '../components/shared';
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
  const [initialForms, setInitialForms] = useState<Record<string, OAuthForm>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [savingProvider, setSavingProvider] = useState<string | null>(null);
  const [pendingDiscard, setPendingDiscard] = useState<string | null>(null);

  useEffect(() => {
    if (!providers.data) return;
    setForms((current) => {
      const next = { ...current };
      for (const provider of providers.data) {
        // CRITICAL: never overwrite the form that is currently being edited
        if (editing === provider.provider) continue;
        next[provider.provider] = formFromProvider(provider);
      }
      return next;
    });
    setInitialForms((current) => {
      const next = { ...current };
      for (const provider of providers.data) {
        next[provider.provider] = formFromProvider(provider);
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
      setSavingProvider(null);
      toast.success(text.oauth.saved);
    },
    onError: (error) => {
      setSavingProvider(null);
      toast.error(error.message);
    }
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

  const handleEditClick = (provider: string) => {
    if (editing === provider) {
      // Cancelling edit — check for unsaved changes
      if (hasUnsavedChanges(forms[provider], initialForms[provider])) {
        setPendingDiscard(provider);
      } else {
        setEditing(null);
      }
    } else {
      // Start editing — only allowed when no other provider is being edited
      if (editing === null) {
        setEditing(provider);
      }
    }
  };

  const confirmDiscard = () => {
    setEditing(null);
    setPendingDiscard(null);
  };

  const cancelDiscard = () => {
    setPendingDiscard(null);
  };

  const handleSave = (provider: OAuthProvider, form: OAuthForm) => {
    setSavingProvider(provider.provider);
    updateProvider.mutate({ provider, form });
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
          const isEditingLocked = editing !== null && editing !== provider.provider;
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
                <button
                  className="admin-oauth-control admin-oauth-edit-control"
                  type="button"
                  disabled={isEditingLocked}
                  onClick={() => handleEditClick(provider.provider)}
                  title={isEditingLocked ? text.oauth.editing_hint : undefined}
                  aria-label={isEditing ? text.common.close : text.oauth.edit}
                >
                  <Pencil size={15} aria-hidden="true" />
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
                  <button className="admin-oauth-control" type="button" onClick={() => copyCallback(callbackURL)} aria-label={text.common.copy}>
                    <Clipboard size={15} aria-hidden="true" />
                    {text.common.copy}
                  </button>
                </div>
                <div className="admin-oauth-summary-row admin-oauth-summary-row-action">
                  <span className="admin-oauth-summary-label">{text.oauth.login_entry}</span>
                  <code className="admin-oauth-summary-value">{provider.auth_url}</code>
                  <a className="admin-oauth-control" href={provider.auth_url} target="_blank" rel="noreferrer" aria-label={text.oauth.open_login}>
                    <ExternalLink size={15} aria-hidden="true" />
                    {text.oauth.open_login}
                  </a>
                </div>
              </div>

              <AnimatePresence>
                {isEditing && (
                  <motion.form
                    className="admin-oauth-form"
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.2, ease: 'easeOut' }}
                    onSubmit={(event) => {
                      event.preventDefault();
                      handleSave(provider, form);
                    }}
                  >
                    <label className="user-form-field">
                      <span>{text.oauth.client_id}</span>
                      <input className="input" value={form.client_id} onChange={(event) => setFormValue(provider.provider, 'client_id', event.target.value)} placeholder="Iv1..." />
                    </label>
                    <label className="user-form-field">
                      <span>{text.oauth.client_secret}</span>
                      <input
                        className="input"
                        value={form.client_secret}
                        onChange={(event) => setFormValue(provider.provider, 'client_secret', event.target.value)}
                        placeholder={provider.client_secret ? '********' : ''}
                        type="password"
                        autoComplete="new-password"
                      />
                      {provider.client_secret && (
                        <p className="user-form-note">{text.oauth.secret_hint}</p>
                      )}
                    </label>
                    <label className="user-form-field admin-oauth-wide">
                      <span>{text.oauth.redirect_url}</span>
                      <input className="input" value={form.redirect_url} onChange={(event) => setFormValue(provider.provider, 'redirect_url', event.target.value)} placeholder={fallbackCallbackURL(provider)} />
                    </label>
                    <div className="segmented-control admin-oauth-wide">
                      <button type="button" className={`segment-choice ${!form.enabled ? 'segment-choice-active' : ''}`} onClick={() => setFormValue(provider.provider, 'enabled', false)} aria-pressed={!form.enabled}>
                        {text.oauth.disabled}
                      </button>
                      <button type="button" className={`segment-choice ${form.enabled ? 'segment-choice-active' : ''}`} onClick={() => setFormValue(provider.provider, 'enabled', true)} aria-pressed={form.enabled}>
                        {text.oauth.enabled}
                      </button>
                    </div>
                    <div className="admin-oauth-form-actions">
                      <button className="btn-secondary" type="button" onClick={() => handleEditClick(provider.provider)} aria-label={text.common.cancel}>{text.common.cancel}</button>
                      <button className="btn-primary" type="submit" disabled={savingProvider !== null} aria-label={text.oauth.save}>
                        {savingProvider === provider.provider ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
                        {text.oauth.save}
                      </button>
                    </div>
                  </motion.form>
                )}
              </AnimatePresence>
            </section>
          );
        })}
      </div>

      {/* Unsaved changes confirmation dialog */}
      <ConfirmModal
        open={pendingDiscard !== null}
        title={text.oauth.unsaved_title}
        description={text.oauth.unsaved_desc}
        confirmText={text.oauth.discard}
        cancelText={text.common.cancel}
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
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
  return `${window.location.origin}/oauth/callback/${provider.provider}`;
}

function maskClientID(value: string) {
  const clean = value.trim();
  if (!clean) return '';
  if (clean.length <= 8) return '***';
  if (clean.length <= 14) return `${clean.slice(0, 3)}***`;
  return `${clean.slice(0, 6)}...${clean.slice(-4)}`;
}

function hasUnsavedChanges(form: OAuthForm | undefined, initial: OAuthForm | undefined): boolean {
  if (!form || !initial) return false;
  return (
    form.client_id.trim() !== initial.client_id.trim() ||
    form.redirect_url.trim() !== initial.redirect_url.trim() ||
    form.enabled !== initial.enabled ||
    form.client_secret.trim() !== ''
  );
}
