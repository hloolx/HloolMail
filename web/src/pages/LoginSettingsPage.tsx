import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { CircleUserRound, Clipboard, ExternalLink, Github, Loader2, Mail, Pencil, Save, Send, Shield, Fingerprint, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { api, patchJSON, postJSON } from '../api';
import type { OAuthProvider, LoginSettings } from '../types';
import { ConfirmModal, DialogShell, InfoTip, LoadingIndicator, SegmentedTabs, SelectDropdown } from '../components/shared';
import { notifySuccess } from '../lib/feedback';
import { useText } from '../locales';

type OAuthForm = {
  client_id: string;
  client_secret: string;
  redirect_url: string;
  enabled: boolean;
};

type RegistrationForm = {
  registration_open: boolean;
  email_registration_enabled: boolean;
  email_verification_mode: 'internal' | 'smtp';
  internal_sender_prefix: string;
  smtp_host: string;
  smtp_port: string;
  smtp_security: 'none' | 'starttls' | 'tls';
  smtp_username: string;
  smtp_password: string;
  smtp_from_name: string;
  smtp_from_email: string;
};

export function LoginSettingsPage() {
  const text = useText();
  const queryClient = useQueryClient();
  const [activeSettingsTab, setActiveSettingsTab] = useState<'oauth' | 'registration' | 'security'>('oauth');

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
  const oauthClientInputRef = useRef<HTMLInputElement | null>(null);
  const registrationSaveButtonRef = useRef<HTMLButtonElement | null>(null);
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
  const [registrationForm, setRegistrationForm] = useState<RegistrationForm>(emptyRegistrationForm());
  const [registrationInitial, setRegistrationInitial] = useState<RegistrationForm>(emptyRegistrationForm());
  const [testRecipient, setTestRecipient] = useState('');
  const [lastTestedRegistrationKey, setLastTestedRegistrationKey] = useState('');

  useEffect(() => {
    if (!loginSettings.data) return;
    const s = loginSettings.data;
    setTurnstileForm({ enabled: s.turnstile_enabled, site_key: s.turnstile_site_key || '', secret_key: '' });
    setTurnstileInitial({ enabled: s.turnstile_enabled, site_key: s.turnstile_site_key || '', secret_key: '' });
    setPasskeyEnabled(s.passkey_enabled);
    const nextRegistration = registrationFormFromSettings(s);
    setRegistrationForm(nextRegistration);
    setRegistrationInitial(nextRegistration);
  }, [loginSettings.data]);

  const saveLoginSettings = useMutation({
    mutationFn: (body: Record<string, unknown>) => patchJSON<LoginSettings>('/api/admin/login-settings', body),
    onSuccess: (settings) => {
      queryClient.setQueryData<LoginSettings>(['admin-login-settings'], settings);
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

  const saveRegistrationSettings = useMutation({
    mutationFn: (form: RegistrationForm) => patchJSON<LoginSettings>('/api/admin/login-settings', registrationPayload(form)),
    onSuccess: (settings) => {
      queryClient.setQueryData<LoginSettings>(['admin-login-settings'], settings);
      queryClient.invalidateQueries({ queryKey: ['admin-login-settings'] });
      queryClient.invalidateQueries({ queryKey: ['login-settings'] });
      const nextRegistration = registrationFormFromSettings(settings);
      setRegistrationForm(nextRegistration);
      setRegistrationInitial(nextRegistration);
      notifySuccess(text.loginSettings.saved, { origin: registrationSaveButtonRef.current });
    },
    onError: (error) => {
      toast.error(error.message);
    }
  });

  const testEmail = useMutation({
    mutationFn: () => {
      const recipient = testRecipient.trim();
      if (!recipient) throw new Error(text.loginSettings.testEmailRequired);
      return postJSON<LoginSettings>('/api/admin/login-settings/test-email', {
        recipient,
        settings: registrationPayload(registrationForm)
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['login-settings'] });
      setLastTestedRegistrationKey(registrationTestKey(registrationForm));
      notifySuccess(text.loginSettings.testEmailSent);
    },
    onError: (error) => {
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
    if (saveLoginSettings.isPending) return;
    const previous = passkeyEnabled;
    const next = !passkeyEnabled;
    setPasskeyEnabled(next);
    loginSettingsFeedbackOriginRef.current = passkeyToggleButtonRef.current;
    saveLoginSettings.mutate(
      { passkey_enabled: next },
      {
        onSuccess: (settings) => {
          setPasskeyEnabled(settings.passkey_enabled);
        },
        onError: () => {
          setPasskeyEnabled(previous);
        }
      }
    );
  };

  const hasTurnstileChanges =
    turnstileForm.enabled !== turnstileInitial.enabled ||
    turnstileForm.site_key.trim() !== turnstileInitial.site_key ||
    turnstileForm.secret_key.trim() !== '';

  const turnstileReplacesTextCaptcha = turnstileForm.enabled;
  const hasRegistrationChanges = registrationChanged(registrationForm, registrationInitial);
  const currentRegistrationKey = registrationTestKey(registrationForm);
  const initialRegistrationKey = registrationTestKey(registrationInitial);
  const currentFormEmailTested = Boolean(
    lastTestedRegistrationKey === currentRegistrationKey ||
    (loginSettings.data?.email_delivery_ready && currentRegistrationKey === initialRegistrationKey)
  );
  const registrationStatusLabel = !registrationForm.registration_open
    ? text.loginSettings.registrationClosed
    : registrationForm.email_registration_enabled
      ? currentFormEmailTested
        ? text.loginSettings.registrationOpen
        : text.loginSettings.emailDeliveryNotReady
      : text.loginSettings.registrationThirdPartyOnly;
  const registrationStatusClass = registrationForm.registration_open && registrationForm.email_registration_enabled
    ? currentFormEmailTested ? 'severity-ok' : 'severity-critical'
    : 'severity-warning';

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
  const closeOAuthEditor = () => {
    if (!editingProvider || savingProvider !== null) return;
    handleEditClick(editingProvider.provider);
  };
  const oauthEditDialog = editingProvider && editingForm ? (
    <DialogShell
      className="modal-panel admin-oauth-edit-modal"
      titleId="admin-oauth-edit-title"
      descriptionId="admin-oauth-edit-desc"
      onClose={closeOAuthEditor}
      closeOnBackdrop={savingProvider === null}
      closeOnEscape={savingProvider === null}
      initialFocusRef={oauthClientInputRef}
    >
            <div className="modal-header">
              <div className="admin-oauth-edit-heading">
                <span className={`admin-oauth-mark admin-oauth-mark-${editingProvider.provider}`}>
                  {editingProvider.provider === 'github' ? <Github size={18} /> : <CircleUserRound size={18} />}
                </span>
                <div>
                  <h2 id="admin-oauth-edit-title">{editingProvider.name}</h2>
                  <p id="admin-oauth-edit-desc">{editingProvider.auth_url}</p>
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
                <input ref={oauthClientInputRef} className="input" value={editingForm.client_id} onChange={(event) => setFormValue(editingProvider.provider, 'client_id', event.target.value)} placeholder="Iv1..." />
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
    </DialogShell>
  ) : null;

  return (
    <div className="admin-oauth-page grid gap-6">
      <div className="admin-page-header">
        <div>
          <h1>{text.loginSettings.title}<InfoTip text={text.loginSettings.desc} /></h1>
        </div>
      </div>

      <SegmentedTabs
        value={activeSettingsTab}
        onValueChange={setActiveSettingsTab}
        ariaLabel={text.loginSettings.title}
        items={[
          { value: 'oauth', label: text.oauth.title, badge: providerRows.length || undefined },
          { value: 'registration', label: text.loginSettings.registrationTitle },
          { value: 'security', label: `${text.turnstile.title} / ${text.passkey.title}` }
        ]}
      />

      {/* --- Section 1: Third-party Login (OAuth) --- */}
      <section className="admin-settings-section" hidden={activeSettingsTab !== 'oauth'}>
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

      {/* --- Section 2: Registration Settings --- */}
      <section className="admin-settings-section" hidden={activeSettingsTab !== 'registration'}>
        <div className="admin-settings-section-header">
          <h2>{text.loginSettings.registrationTitle}<InfoTip text={text.loginSettings.registrationDesc} /></h2>
        </div>

        {loginSettings.isLoading ? (
          <div className="admin-oauth-state"><LoadingIndicator label={text.common.loading} size={18} /></div>
        ) : loginSettings.isError ? (
          <div className="admin-oauth-state"><span>{text.loginSettings.load_error}</span></div>
        ) : (
          <section className="panel admin-registration-panel">
            <div className="panel-header admin-panel-header">
              <div>
                <h2 className="admin-oauth-provider-title">
                  <span className="admin-oauth-mark">
                    <UserPlus size={18} />
                  </span>
                  {text.loginSettings.registrationTitle}
                </h2>
              </div>
              <span className={`severity-pill ${registrationStatusClass}`}>
                {registrationStatusLabel}
              </span>
            </div>

            <div className="admin-registration-note">
              <Shield size={16} aria-hidden="true" />
              <p>{text.loginSettings.registrationPolicyNote}</p>
            </div>

            <div className="login-config-fields">
              <div className="toggle-row">
                <span className="admin-registration-toggle-copy">
                  <span className="toggle-row-label">{text.loginSettings.registrationOpenLabel}</span>
                  <span className="admin-registration-toggle-hint">{text.loginSettings.registrationOpenHint}</span>
                </span>
                <button
                  type="button"
                  className={`toggle-switch ${registrationForm.registration_open ? 'on' : ''}`}
                  onClick={() => setRegistrationForm((form) => ({ ...form, registration_open: !form.registration_open }))}
                  role="switch"
                  aria-checked={registrationForm.registration_open}
                >
                  <span className="toggle-switch-knob" />
                </button>
              </div>
              <div className="toggle-row">
                <span className="admin-registration-toggle-copy">
                  <span className="toggle-row-label">{text.loginSettings.emailRegistrationLabel}</span>
                  <span className="admin-registration-toggle-hint">{text.loginSettings.emailRegistrationHint}</span>
                </span>
                <button
                  type="button"
                  className={`toggle-switch ${registrationForm.email_registration_enabled ? 'on' : ''}`}
                  onClick={() => {
                    if (!registrationForm.email_registration_enabled && !currentFormEmailTested) {
                      toast.error(text.loginSettings.testEmailBeforeEnable);
                      return;
                    }
                    setRegistrationForm((form) => ({ ...form, email_registration_enabled: !form.email_registration_enabled }));
                  }}
                  role="switch"
                  aria-checked={registrationForm.email_registration_enabled}
                >
                  <span className="toggle-switch-knob" />
                </button>
              </div>
            </div>

            <div className="login-config-fields">
              <div className="user-form-field">
                <span>{text.loginSettings.emailVerificationMode}</span>
                <div className="segmented-control segmented-control-compact" role="group" aria-label={text.loginSettings.emailVerificationMode}>
                  <button
                    type="button"
                    className={`segment-choice ${registrationForm.email_verification_mode === 'internal' ? 'segment-choice-active' : ''}`}
                    onClick={() => setRegistrationForm((form) => ({ ...form, email_verification_mode: 'internal' }))}
                  >
                    <Mail size={14} />{text.loginSettings.internalSender}
                  </button>
                  <button
                    type="button"
                    className={`segment-choice ${registrationForm.email_verification_mode === 'smtp' ? 'segment-choice-active' : ''}`}
                    onClick={() => setRegistrationForm((form) => ({ ...form, email_verification_mode: 'smtp' }))}
                  >
                    <Send size={14} />{text.loginSettings.smtpSender}
                  </button>
                </div>
                {turnstileReplacesTextCaptcha && (
                  <p className="admin-registration-hint">{text.loginSettings.turnstileReplacesTextCaptcha}</p>
                )}
              </div>

              {registrationForm.email_verification_mode === 'internal' ? (
                <div className="admin-registration-grid">
                  <label className="user-form-field">
                    <span>{text.loginSettings.internalSenderPrefix}</span>
                    <input className="input" value={registrationForm.internal_sender_prefix} onChange={(event) => setRegistrationForm((form) => ({ ...form, internal_sender_prefix: event.target.value }))} placeholder="noreply" />
                  </label>
                  <p className="field-hint admin-registration-hint">{text.loginSettings.internalSenderHint}</p>
                </div>
              ) : (
                <div className="admin-registration-grid">
                  <label className="user-form-field">
                    <span>{text.loginSettings.smtpHost}</span>
                    <input className="input" value={registrationForm.smtp_host} onChange={(event) => setRegistrationForm((form) => ({ ...form, smtp_host: event.target.value }))} placeholder="smtp.example.com" />
                  </label>
                  <label className="user-form-field">
                    <span>{text.loginSettings.smtpPort}</span>
                    <input className="input" value={registrationForm.smtp_port} onChange={(event) => setRegistrationForm((form) => ({ ...form, smtp_port: event.target.value }))} inputMode="numeric" placeholder="587" />
                  </label>
                  <label className="user-form-field">
                    <span>{text.loginSettings.smtpSecurity}</span>
                    <SelectDropdown
                      className="form-select-dropdown"
                      value={registrationForm.smtp_security}
                      ariaLabel={text.loginSettings.smtpSecurity}
                      onChange={(value) => setRegistrationForm((form) => ({ ...form, smtp_security: value as RegistrationForm['smtp_security'] }))}
                      options={[
                        { value: 'none', label: text.loginSettings.smtpSecurityNone },
                        { value: 'starttls', label: text.loginSettings.smtpSecurityStarttls },
                        { value: 'tls', label: text.loginSettings.smtpSecurityTls }
                      ]}
                    />
                  </label>
                  <label className="user-form-field">
                    <span>{text.loginSettings.smtpUsername}</span>
                    <input className="input" value={registrationForm.smtp_username} onChange={(event) => setRegistrationForm((form) => ({ ...form, smtp_username: event.target.value }))} autoComplete="username" />
                  </label>
                  <label className="user-form-field">
                    <span>{text.loginSettings.smtpPassword}{registrationInitial.smtp_password && <InfoTip text={text.oauth.secret_hint} />}</span>
                    <input className="input" value={registrationForm.smtp_password} onChange={(event) => setRegistrationForm((form) => ({ ...form, smtp_password: event.target.value }))} placeholder={registrationInitial.smtp_password ? '********' : ''} type="password" autoComplete="new-password" />
                  </label>
                  <label className="user-form-field">
                    <span>{text.loginSettings.smtpFromName}</span>
                    <input className="input" value={registrationForm.smtp_from_name} onChange={(event) => setRegistrationForm((form) => ({ ...form, smtp_from_name: event.target.value }))} />
                  </label>
                  <label className="user-form-field admin-oauth-wide">
                    <span>{text.loginSettings.smtpFromEmail}</span>
                    <input className="input" value={registrationForm.smtp_from_email} onChange={(event) => setRegistrationForm((form) => ({ ...form, smtp_from_email: event.target.value }))} type="email" />
                  </label>
                </div>
              )}
              <div className="admin-registration-test admin-oauth-wide">
                <label className="user-form-field">
                  <span>{text.loginSettings.testRecipient}</span>
                  <input className="input" value={testRecipient} onChange={(event) => setTestRecipient(event.target.value)} type="email" placeholder="you@example.com" />
                </label>
                <button className="btn-secondary" type="button" onClick={() => testEmail.mutate()} disabled={testEmail.isPending}>
                  {testEmail.isPending ? <LoadingIndicator size={14} /> : <Send size={14} />}
                  {text.loginSettings.testEmail}
                </button>
                <p className="field-hint admin-registration-hint">
                  {currentFormEmailTested
                    ? text.loginSettings.emailDeliveryReady
                    : text.loginSettings.emailDeliveryNeedsTest}
                </p>
              </div>
            </div>

            <div className="admin-oauth-form-actions">
              {hasRegistrationChanges && (
                <button ref={registrationSaveButtonRef} className="btn-primary" type="button" onClick={() => saveRegistrationSettings.mutate(registrationForm)} disabled={saveRegistrationSettings.isPending}>
                  {saveRegistrationSettings.isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                  {text.loginSettings.save}
                </button>
              )}
            </div>
          </section>
        )}
      </section>

      {/* --- Section 3: Security Settings --- */}
      <section className="admin-settings-section" hidden={activeSettingsTab !== 'security'}>
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

function emptyRegistrationForm(): RegistrationForm {
  return {
    registration_open: false,
    email_registration_enabled: false,
    email_verification_mode: 'internal',
    internal_sender_prefix: '',
    smtp_host: '',
    smtp_port: '587',
    smtp_security: 'starttls',
    smtp_username: '',
    smtp_password: '',
    smtp_from_name: '',
    smtp_from_email: ''
  };
}

function registrationFormFromSettings(settings: LoginSettings): RegistrationForm {
  return {
    registration_open: !!settings.registration_open,
    email_registration_enabled: !!settings.email_registration_enabled,
    email_verification_mode: settings.email_verification_mode || 'internal',
    internal_sender_prefix: settings.internal_sender_prefix || '',
    smtp_host: settings.smtp_host || '',
    smtp_port: String(settings.smtp_port || 587),
    smtp_security: settings.smtp_security || 'starttls',
    smtp_username: settings.smtp_username || '',
    smtp_password: settings.smtp_password === '***' ? '***' : '',
    smtp_from_name: settings.smtp_from_name || '',
    smtp_from_email: settings.smtp_from_email || ''
  };
}

function registrationPayload(form: RegistrationForm): Record<string, unknown> {
  return {
    registration_open: form.registration_open,
    email_registration_enabled: form.email_registration_enabled,
    email_verification_mode: form.email_verification_mode,
    internal_sender_prefix: form.internal_sender_prefix.trim(),
    smtp_host: form.smtp_host.trim(),
    smtp_port: Number.parseInt(form.smtp_port, 10) || 0,
    smtp_security: form.smtp_security,
    smtp_username: form.smtp_username.trim(),
    smtp_password: form.smtp_password.trim(),
    smtp_from_name: form.smtp_from_name.trim(),
    smtp_from_email: form.smtp_from_email.trim()
  };
}

function registrationTestKey(form: RegistrationForm): string {
  return JSON.stringify({
    email_verification_mode: form.email_verification_mode,
    internal_sender_prefix: form.internal_sender_prefix.trim(),
    smtp_host: form.smtp_host.trim(),
    smtp_port: Number.parseInt(form.smtp_port, 10) || 0,
    smtp_security: form.smtp_security,
    smtp_username: form.smtp_username.trim(),
    smtp_password: form.smtp_password.trim(),
    smtp_from_name: form.smtp_from_name.trim(),
    smtp_from_email: form.smtp_from_email.trim()
  });
}

function registrationChanged(form: RegistrationForm, initial: RegistrationForm): boolean {
  return (
    form.registration_open !== initial.registration_open ||
    form.email_registration_enabled !== initial.email_registration_enabled ||
    form.email_verification_mode !== initial.email_verification_mode ||
    form.internal_sender_prefix.trim() !== initial.internal_sender_prefix ||
    form.smtp_host.trim() !== initial.smtp_host ||
    form.smtp_port.trim() !== initial.smtp_port ||
    form.smtp_security !== initial.smtp_security ||
    form.smtp_username.trim() !== initial.smtp_username ||
    form.smtp_password.trim() !== initial.smtp_password ||
    form.smtp_from_name.trim() !== initial.smtp_from_name ||
    form.smtp_from_email.trim() !== initial.smtp_from_email
  );
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
