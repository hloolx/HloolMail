import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { CircleUserRound, Clipboard, ExternalLink, Github, Loader2, Pencil, Save, Shield, Fingerprint, X } from 'lucide-react';
import { toast } from 'sonner';
import { api, patchJSON } from '../api';
import type { OAuthProvider, LoginSettings } from '../types';
import { ConfirmModal, InfoTip, LoadingIndicator } from '../components/shared';
import { notifySuccess } from '../lib/feedback';
import { useText } from '../locales';

type OAuthForm = {
  client_id: string;
  client_secret: string;
  redirect_url: string;
  enabled: boolean;
};

export function LoginSettingsPage() {
  const text = useText();
  const queryClient = useQueryClient();

  // --- OAuth section ---
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
  const oauthSaveButtonRef = useRef<HTMLButtonElement | null>(null);
  const turnstileSaveButtonRef = useRef<HTMLButtonElement | null>(null);
  const passkeyToggleButtonRef = useRef<HTMLButtonElement | null>(null);
  const loginSettingsFeedbackOriginRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!providers.data) return;
    setForms((current) => {
      const next = { ...current };
      for (const provider of providers.data) {
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
    mutationFn: ({ provider, form }: { provider: OAuthProvider; form: OAuthForm }) =>
      patchJSON<OAuthProvider>(`/api/admin/oauth/providers/${provider.provider}`, {
        client_id: form.client_id.trim(),
        client_secret: form.client_secret.trim() || undefined,
        redirect_url: form.redirect_url.trim(),
        enabled: form.enabled
      }),
    onSuccess: (updatedProvider) => {
      // Update cache and state BEFORE closing modal so the card underneath shows fresh data
      queryClient.setQueryData<OAuthProvider[]>(['admin-oauth-providers'], (current) =>
        current?.map((provider) => provider.provider === updatedProvider.provider ? updatedProvider : provider)
      );
      queryClient.invalidateQueries({ queryKey: ['oauth-providers'] });
      setForms((current) => ({
        ...current,
        [updatedProvider.provider]: formFromProvider(updatedProvider)
      }));
      setInitialForms((current) => ({
        ...current,
        [updatedProvider.provider]: formFromProvider(updatedProvider)
      }));
      setSavingProvider(null);
      setEditing(null);
      notifySuccess(text.oauth.saved, { origin: oauthSaveButtonRef.current });
    },
    onError: (error) => {
      setSavingProvider(null);
      toast.error(error.message);
    }
  });

  // --- Login settings (Turnstile + Passkey) ---
  const loginSettings = useQuery({
    queryKey: ['admin-login-settings'],
    queryFn: () => api<LoginSettings>('/api/admin/login-settings'),
    retry: false
  });

  const [turnstileForm, setTurnstileForm] = useState({ enabled: false, site_key: '', secret_key: '' });
  const [turnstileInitial, setTurnstileInitial] = useState({ enabled: false, site_key: '', secret_key: '' });
  const [savingTurnstile, setSavingTurnstile] = useState(false);
  const [passkeyEnabled, setPasskeyEnabled] = useState(false);
  const [passkeyInitial, setPasskeyInitial] = useState(false);

  useEffect(() => {
    if (!loginSettings.data) return;
    const s = loginSettings.data;
    setTurnstileForm({ enabled: s.turnstile_enabled, site_key: s.turnstile_site_key || '', secret_key: '' });
    setTurnstileInitial({ enabled: s.turnstile_enabled, site_key: s.turnstile_site_key || '', secret_key: '' });
    setPasskeyEnabled(s.passkey_enabled);
    setPasskeyInitial(s.passkey_enabled);
  }, [loginSettings.data]);

  const saveLoginSettings = useMutation({
    mutationFn: (body: Record<string, unknown>) => patchJSON<LoginSettings>('/api/admin/login-settings', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-login-settings'] });
      setSavingTurnstile(false);
      notifySuccess(text.loginSettings.saved, { origin: loginSettingsFeedbackOriginRef.current });
      loginSettingsFeedbackOriginRef.current = null;
    },
    onError: (error) => {
      setSavingTurnstile(false);
      loginSettingsFeedbackOriginRef.current = null;
      toast.error(error.message);
    }
  });

  const handleSaveTurnstile = () => {
    setSavingTurnstile(true);
    loginSettingsFeedbackOriginRef.current = turnstileSaveButtonRef.current;
    const body: Record<string, unknown> = {
      turnstile_enabled: turnstileForm.enabled,
      turnstile_site_key: turnstileForm.site_key.trim()
    };
    if (turnstileForm.secret_key.trim()) {
      body.turnstile_secret_key = turnstileForm.secret_key.trim();
    } else if (turnstileInitial.secret_key) {
      body.turnstile_secret_key = '***';
    }
    saveLoginSettings.mutate(body);
  };

  const handleTogglePasskey = () => {
    const next = !passkeyEnabled;
    setPasskeyEnabled(next);
    loginSettingsFeedbackOriginRef.current = passkeyToggleButtonRef.current;
    saveLoginSettings.mutate({ passkey_enabled: next });
  };

  const hasTurnstileChanges =
    turnstileForm.enabled !== turnstileInitial.enabled ||
    turnstileForm.site_key.trim() !== turnstileInitial.site_key ||
    turnstileForm.secret_key.trim() !== '';

  // --- OAuth helpers ---
  const providerRows = useMemo(() => providers.data || [], [providers.data]);

  const setFormValue = (provider: string, key: keyof OAuthForm, value: string | boolean) => {
    setForms((current) => ({
      ...current,
      [provider]: { ...(current[provider] || emptyForm()), [key]: value }
    }));
  };

  const copyCallback = async (value: string, origin: HTMLElement | null) => {
    try {
      await navigator.clipboard.writeText(value);
      notifySuccess(text.common.copied, { origin });
    } catch {
      toast.error(text.common.copyFailed);
    }
  };

  const handleEditClick = (provider: string) => {
    if (editing === provider) {
      if (hasUnsavedChanges(forms[provider], initialForms[provider])) {
        setPendingDiscard(provider);
      } else {
        setEditing(null);
      }
    } else {
      if (editing === null) setEditing(provider);
    }
  };

  const handleSave = (provider: OAuthProvider, form: OAuthForm) => {
    setSavingProvider(provider.provider);
    updateProvider.mutate({ provider, form });
  };

  const editingProvider = providerRows.find((provider) => provider.provider === editing);
  const editingForm = editingProvider ? forms[editingProvider.provider] || formFromProvider(editingProvider) : null;
  const oauthEditDialog = typeof document === 'undefined' ? null : createPortal(
    <AnimatePresence>
      {editingProvider && editingForm && (
        <motion.div
          className="modal-backdrop"
          style={{ animation: 'none' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onMouseDown={(event) => {
            if (savingProvider === null && event.target === event.currentTarget) handleEditClick(editingProvider.provider);
          }}
        >
          <motion.section
            className="modal-panel admin-oauth-edit-modal"
            style={{ animation: 'none' }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-oauth-edit-title"
            initial={{ opacity: 0, y: 10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.97 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            <div className="modal-header">
              <div className="admin-oauth-edit-heading">
                <span className={`admin-oauth-mark admin-oauth-mark-${editingProvider.provider}`}>
                  {editingProvider.provider === 'github' ? <Github size={18} /> : <CircleUserRound size={18} />}
                </span>
                <div>
                  <h2 id="admin-oauth-edit-title">{editingProvider.name}</h2>
                  <p>{editingProvider.auth_url}</p>
                </div>
              </div>
              <button className="icon-btn" type="button" disabled={savingProvider !== null} onClick={() => handleEditClick(editingProvider.provider)} aria-label={text.common.close}>
                <X size={16} aria-hidden="true" />
              </button>
            </div>

            <form
              className="admin-oauth-edit-body"
              onSubmit={(event) => {
                event.preventDefault();
                handleSave(editingProvider, editingForm);
              }}
            >
              <label className="user-form-field">
                <span>{text.oauth.client_id}</span>
                <input className="input" value={editingForm.client_id} onChange={(event) => setFormValue(editingProvider.provider, 'client_id', event.target.value)} placeholder="Iv1..." autoFocus />
              </label>
              <label className="user-form-field">
                <span>{text.oauth.client_secret}{editingProvider.client_secret && <InfoTip text={text.oauth.secret_hint} />}</span>
                <input className="input" value={editingForm.client_secret} onChange={(event) => setFormValue(editingProvider.provider, 'client_secret', event.target.value)} placeholder={editingProvider.client_secret ? '********' : ''} type="password" autoComplete="new-password" />
              </label>
              <label className="user-form-field admin-oauth-wide">
                <span>{text.oauth.redirect_url}</span>
                <input className="input" value={editingForm.redirect_url} onChange={(event) => setFormValue(editingProvider.provider, 'redirect_url', event.target.value)} placeholder={fallbackCallbackURL(editingProvider)} />
              </label>
              <div className="toggle-row admin-oauth-edit-toggle">
                <span className="toggle-row-label">{text.common.enabled}</span>
                <button
                  type="button"
                  className={`toggle-switch ${editingForm.enabled ? 'on' : ''}`}
                  onClick={() => setFormValue(editingProvider.provider, 'enabled', !editingForm.enabled)}
                  role="switch"
                  aria-checked={editingForm.enabled}
                >
                  <span className="toggle-switch-knob" />
                </button>
              </div>

              <div className="modal-footer admin-oauth-edit-footer">
                <button className="btn-secondary" type="button" disabled={savingProvider !== null} onClick={() => handleEditClick(editingProvider.provider)} aria-label={text.common.cancel}>{text.common.cancel}</button>
                <button ref={oauthSaveButtonRef} className="btn-primary" type="submit" disabled={savingProvider !== null} aria-label={text.oauth.save}>
                  {savingProvider === editingProvider.provider ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}{text.oauth.save}
                </button>
              </div>
            </form>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );

  return (
    <div className="admin-oauth-page grid gap-6">
      <div className="admin-page-header">
        <div>
          <h1>{text.loginSettings.title}<InfoTip text={text.loginSettings.desc} /></h1>
        </div>
      </div>

      {/* --- Section 1: Third-party Login (OAuth) --- */}
      <section className="admin-settings-section">
        <div className="admin-settings-section-header">
          <div>
            <h2>{text.oauth.title}<InfoTip text={text.oauth.admin_desc} /></h2>
          </div>
        </div>

        {providers.isLoading && (
          <div className="admin-oauth-state">
            <LoadingIndicator label={text.common.loading} size={18} />
          </div>
        )}
        {providers.isError && (
          <div className="admin-oauth-state">
            <span>{text.oauth.load_error}</span>
          </div>
        )}
        {!providers.isLoading && !providers.isError && providerRows.length === 0 && (
          <div className="admin-oauth-state">
            <span>{text.oauth.empty}</span>
          </div>
        )}

        <div className="admin-oauth-grid">
          {providerRows.map((provider) => {
            const form = forms[provider.provider] || formFromProvider(provider);
            const callbackURL = provider.redirect_url || fallbackCallbackURL(provider);
            const Icon = provider.provider === 'github' ? Github : CircleUserRound;
            return (
              <div className="panel admin-oauth-provider" key={provider.provider}>
                <div className="panel-header admin-panel-header">
                  <div>
                    <h2 className="admin-oauth-provider-title">
                      <span className={`admin-oauth-mark admin-oauth-mark-${provider.provider}`}>
                        <Icon size={18} />
                      </span>
                      {provider.name}
                    </h2>
                    <p>{provider.auth_url}</p>
                  </div>
                  <div className="table-actions">
                    <span className={`severity-pill ${provider.enabled ? 'severity-ok' : 'severity-warning'}`}>
                      {provider.enabled ? text.oauth.enabled : text.oauth.disabled}
                    </span>
                    <span className={`severity-pill ${provider.configured ? 'severity-ok' : 'severity-critical'}`}>
                      {provider.configured ? text.oauth.configured : text.oauth.not_configured}
                    </span>
                    <button
                      className="btn-secondary"
                      type="button"
                      disabled={savingProvider !== null}
                      onClick={() => handleEditClick(provider.provider)}
                      aria-label={text.oauth.edit}
                    >
                      <Pencil size={14} aria-hidden="true" />
                      {text.oauth.edit}
                    </button>
                  </div>
                </div>

                <div className="admin-oauth-info">
                  <div className="admin-oauth-info-row">
                    <span className="admin-oauth-info-label">{text.oauth.client_id}</span>
                    <code className="admin-oauth-info-value">{maskClientID(provider.client_id || '') || '-'}</code>
                  </div>
                  <div className="admin-oauth-info-row">
                    <span className="admin-oauth-info-label">{text.oauth.redirect_url}</span>
                    <code className="admin-oauth-info-value">{callbackURL}</code>
                    <button className="btn-ghost" type="button" onClick={(event) => copyCallback(callbackURL, event.currentTarget)} aria-label={text.common.copy}>
                      <Clipboard size={14} aria-hidden="true" />{text.common.copy}
                    </button>
                  </div>
                  <div className="admin-oauth-info-row">
                    <span className="admin-oauth-info-label">{text.oauth.login_entry}</span>
                    <code className="admin-oauth-info-value">{provider.auth_url}</code>
                    <a className="btn-ghost" href={provider.auth_url} target="_blank" rel="noreferrer" aria-label={text.oauth.open_login}>
                      <ExternalLink size={14} aria-hidden="true" />{text.oauth.open_login}
                    </a>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* --- Section 2: Security Settings --- */}
      <section className="admin-settings-section">
        <div className="admin-settings-section-header">
          <h2>{text.turnstile.title} / {text.passkey.title}</h2>
        </div>

        {loginSettings.isLoading ? (
          <div className="admin-oauth-state"><LoadingIndicator label={text.common.loading} size={18} /></div>
        ) : loginSettings.isError ? (
          <div className="admin-oauth-state"><span>{text.loginSettings.load_error}</span></div>
        ) : (
          <div className="admin-oauth-grid">
            {/* Turnstile */}
            <section className="panel">
              <div className="panel-header admin-panel-header">
                <div>
                  <h2 className="admin-oauth-provider-title">
                    <span className="admin-oauth-mark">
                      <Shield size={18} />
                    </span>
                    {text.turnstile.title}
                  </h2>
                </div>
                <span className={`severity-pill ${turnstileForm.enabled ? 'severity-ok' : 'severity-warning'}`}>
                  {turnstileForm.enabled ? text.turnstile.enabled : text.turnstile.disabled}
                </span>
              </div>

              <div className="toggle-row">
                <span className="toggle-row-label">{text.common.enabled}</span>
                <button
                  type="button"
                  className={`toggle-switch ${turnstileForm.enabled ? 'on' : ''}`}
                  onClick={() => setTurnstileForm((f) => ({ ...f, enabled: !f.enabled }))}
                  role="switch"
                  aria-checked={turnstileForm.enabled}
                >
                  <span className="toggle-switch-knob" />
                </button>
              </div>

              <AnimatePresence>
                {turnstileForm.enabled && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    style={{ overflow: 'hidden' }}
                  >
                    <div className="login-config-fields">
                      <label className="user-form-field">
                        <span>{text.turnstile.site_key}</span>
                        <input className="input" value={turnstileForm.site_key} onChange={(e) => setTurnstileForm((f) => ({ ...f, site_key: e.target.value }))} placeholder="0x4AAAAAA..." />
                        <InfoTip text={text.turnstile.site_key_hint} />
                      </label>
                      <label className="user-form-field">
                        <span>{text.turnstile.secret_key}</span>
                        <input className="input" type="password" autoComplete="new-password" value={turnstileForm.secret_key} onChange={(e) => setTurnstileForm((f) => ({ ...f, secret_key: e.target.value }))} placeholder={turnstileInitial.secret_key ? '********' : ''} />
                        {turnstileInitial.secret_key && <InfoTip text={text.turnstile.secret_stored} />}
                        {!turnstileInitial.secret_key && <InfoTip text={text.turnstile.secret_key_hint} />}
                      </label>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="admin-oauth-form-actions">
                <a
                  href={text.turnstile.apply_url}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-secondary"
                >
                  <ExternalLink size={14} />{text.turnstile.apply}
                </a>
                {hasTurnstileChanges && (
                  <button ref={turnstileSaveButtonRef} className="btn-primary" type="button" onClick={handleSaveTurnstile} disabled={savingTurnstile}>
                    {savingTurnstile ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                    {text.loginSettings.save}
                  </button>
                )}
              </div>
            </section>

            {/* Passkey */}
            <section className="panel">
              <div className="panel-header admin-panel-header">
                <div>
                  <h2 className="admin-oauth-provider-title">
                    <span className="admin-oauth-mark">
                      <Fingerprint size={18} />
                    </span>
                    {text.passkey.title}
                  </h2>
                </div>
                <span className={`severity-pill ${passkeyEnabled ? 'severity-ok' : 'severity-warning'}`}>
                  {passkeyEnabled ? text.passkey.enabled : text.passkey.disabled}
                </span>
              </div>

              <InfoTip text={text.passkey.bindHint} />

              <div className="toggle-row">
                <span className="toggle-row-label">{text.common.enabled}</span>
                <button
                  type="button"
                  className={`toggle-switch ${passkeyEnabled ? 'on' : ''}`}
                  onClick={handleTogglePasskey}
                  disabled={saveLoginSettings.isPending}
                  ref={passkeyToggleButtonRef}
                  role="switch"
                  aria-checked={passkeyEnabled}
                >
                  <span className="toggle-switch-knob" />
                </button>
              </div>
            </section>
          </div>
        )}
      </section>

      {oauthEditDialog}

      <ConfirmModal
        open={pendingDiscard !== null}
        title={text.oauth.unsaved_title}
        description={text.oauth.unsaved_desc}
        confirmText={text.oauth.discard}
        cancelText={text.common.cancel}
        onConfirm={() => { setEditing(null); setPendingDiscard(null); }}
        onCancel={() => setPendingDiscard(null)}
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
