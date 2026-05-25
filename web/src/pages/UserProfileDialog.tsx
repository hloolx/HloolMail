import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleUserRound, Fingerprint, Github, Plus, Save, Trash2, Unlink, X } from 'lucide-react';
import { toast } from 'sonner';
import type { User } from '../api';
import { api, patchJSON } from '../api';
import type { MeResponse, OAuthProvider, PublicLoginSettings } from '../types';
import { roleText, useText } from '../locales';
import { DialogShell, IconButton, InfoTip, LoadingIndicator, UserAvatar } from '../components/shared';
import { notifySuccess } from '../lib/feedback';
import { registerPasskey, type PasskeyCredentialSummary } from '../lib/passkeys';
import { displayName, displaySubtitle, normalizeNicknameInput, validateNicknameInput } from '../lib/userDisplay';

type OAuthIdentity = {
  provider: string;
  name: string;
  bound_at: string;
};

export function UserProfileDialog({ open, onClose, user }: { open: boolean; onClose: () => void; user: User }) {
  const queryClient = useQueryClient();
  const text = useText();
  const feedbackOriginRef = useRef<HTMLElement | null>(null);
  const [nickname, setNickname] = useState(user.nickname || '');
  const [nicknameError, setNicknameError] = useState('');

  useEffect(() => {
    if (!open) return;
    setNickname(user.nickname || '');
    setNicknameError('');
  }, [open, user.nickname]);

  const identities = useQuery({
    queryKey: ['user-oauth-identities'],
    queryFn: () => api<OAuthIdentity[]>('/api/user/oauth-identities'),
    enabled: open,
    retry: false,
  });

  const providers = useQuery({
    queryKey: ['oauth-providers'],
    queryFn: () => api<OAuthProvider[]>('/api/oauth/providers'),
    enabled: open,
    retry: false,
    staleTime: 60_000,
  });

  const loginSettings = useQuery({
    queryKey: ['login-settings'],
    queryFn: () => api<PublicLoginSettings>('/api/auth/login-settings'),
    enabled: open,
    retry: false,
    staleTime: 60_000,
  });

  const passkeys = useQuery({
    queryKey: ['user-passkeys'],
    queryFn: () => api<PasskeyCredentialSummary[]>('/api/user/passkeys'),
    enabled: open && !!loginSettings.data?.passkey_enabled,
    retry: false,
  });

  const unbind = useMutation({
    mutationFn: (provider: string) => api<{ provider: string; unbound: boolean }>(`/api/user/oauth-identities/${provider}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-oauth-identities'] });
      notifySuccess(text.profile.unbound, { origin: feedbackOriginRef.current });
      feedbackOriginRef.current = null;
    },
    onError: (error) => {
      feedbackOriginRef.current = null;
      toast.error(error.message);
    },
  });

  const bindPasskey = useMutation({
    mutationFn: registerPasskey,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-passkeys'] });
      notifySuccess(text.profile.passkeyBound, { origin: feedbackOriginRef.current });
      feedbackOriginRef.current = null;
    },
    onError: (error) => {
      feedbackOriginRef.current = null;
      toast.error(error.message);
    },
  });

  const deletePasskey = useMutation({
    mutationFn: (id: number) => api(`/api/user/passkeys/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-passkeys'] });
      notifySuccess(text.profile.passkeyDeleted, { burst: false });
    },
    onError: (error) => toast.error(error.message),
  });

  const saveProfile = useMutation({
    mutationFn: () => {
      const error = validateNicknameInput(nickname, {
        required: text.profile.nicknameRequired,
        tooLong: text.profile.nicknameTooLong,
        invalid: text.profile.nicknameInvalid
      });
      if (error) {
        setNicknameError(error);
        throw new Error(error);
      }
      return patchJSON<{ user: User }>('/api/user/profile', { nickname: normalizeNicknameInput(nickname) });
    },
    onSuccess: (response) => {
      queryClient.setQueryData<MeResponse>(['me'], (current) => (
        current?.user ? { ...current, user: response.user } : current
      ));
      queryClient.invalidateQueries({ queryKey: ['me'] });
      notifySuccess(text.profile.nicknameSaved, { origin: feedbackOriginRef.current });
      feedbackOriginRef.current = null;
    },
    onError: (error) => {
      feedbackOriginRef.current = null;
      toast.error(error.message);
    },
  });

  const boundProviders = new Set((identities.data || []).map((id) => id.provider));
  const availableProviders = (providers.data || []).filter((p) => p.configured && p.enabled);
  const loadingProviders = providers.isLoading || identities.isLoading;
  const primaryName = displayName(user);
  const secondaryName = displaySubtitle(user);

  const bind = (provider: string) => {
    const bindURL = `/api/oauth/${provider}/login?mode=bind&redirect=${encodeURIComponent('/#/dashboard')}`;
    window.location.href = bindURL;
  };

  return (
    <DialogShell
      open={open}
      className="modal-panel profile-dialog"
      titleId="profile-dialog-title"
      onClose={onClose}
    >
            <div className="modal-header">
              <div>
                <h2 id="profile-dialog-title">{text.profile.title}<InfoTip text={text.profile.desc} /></h2>
              </div>
              <IconButton title={text.common.close} onClick={onClose}>
                <X size={16} />
              </IconButton>
            </div>

            <div className="profile-body">
              <div className="profile-user-info">
                <UserAvatar user={user} className="profile-avatar" />
                <div className="profile-user-details">
                  <div className="profile-email">{primaryName}</div>
                  {secondaryName && <div className="profile-secondary">{secondaryName}</div>}
                  <div className="profile-role">{roleText(user.role, text)}</div>
                </div>
              </div>

              <div className="profile-section">
                <h3 className="profile-section-title">{text.profile.accountInfo}</h3>
                {!normalizeNicknameInput(user.nickname || '') && (
                  <p className="profile-empty profile-nickname-prompt">{text.profile.completeNicknameDesc}</p>
                )}
                <form
                  className="profile-nickname-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    feedbackOriginRef.current = event.currentTarget.querySelector('button[type="submit"]') as HTMLElement | null;
                    saveProfile.mutate();
                  }}
                >
                  <label className="profile-nickname-field">
                    <span>{text.profile.nickname}</span>
                    <input
                      className="input"
                      value={nickname}
                      onChange={(event) => {
                        setNickname(event.target.value);
                        setNicknameError('');
                      }}
                      placeholder={text.profile.nicknamePlaceholder}
                      autoComplete="nickname"
                      maxLength={80}
                      aria-invalid={Boolean(nicknameError)}
                    />
                  </label>
                  {nicknameError && <span className="field-error" role="alert">{nicknameError}</span>}
                  <button className="btn-secondary profile-save-btn" type="submit" disabled={saveProfile.isPending}>
                    {saveProfile.isPending ? <LoadingIndicator size={14} /> : <Save size={14} />}
                    {text.profile.saveNickname}
                  </button>
                </form>
              </div>

              <div className="profile-section">
                <h3 className="profile-section-title">{text.profile.linkedAccounts}</h3>
                {loadingProviders ? (
                  <p className="profile-empty">
                    <LoadingIndicator size={14} label={text.common.loading} />
                  </p>
                ) : availableProviders.length === 0 ? (
                  <p className="profile-empty">{text.profile.noProviders}</p>
                ) : (
                  <div className="profile-provider-list">
                    {availableProviders.map((provider) => {
                      const isBound = boundProviders.has(provider.provider);
                      const Icon = provider.provider === 'github' ? Github : CircleUserRound;
                      const busy = unbind.isPending && unbind.variables === provider.provider;
                      return (
                        <div className={`profile-provider-row ${isBound ? 'profile-provider-bound' : ''}`} key={provider.provider}>
                          <div className="profile-provider-left">
                            <Icon size={18} />
                            <span>{provider.name}</span>
                            {isBound && <span className="profile-badge">{text.profile.bound}</span>}
                          </div>
                          {isBound ? (
                            <button
                              className="btn-ghost profile-unbind-btn"
                              type="button"
                              disabled={busy}
                              onClick={(event) => {
                                feedbackOriginRef.current = event.currentTarget;
                                unbind.mutate(provider.provider);
                              }}
                            >
                              {busy ? <LoadingIndicator size={14} /> : <Unlink size={14} />}
                              {text.profile.unbind}
                            </button>
                          ) : (
                            <button
                              className="btn-secondary profile-bind-btn"
                              type="button"
                              onClick={() => bind(provider.provider)}
                            >
                              <Icon size={14} />
                              {text.profile.bind}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="profile-section">
                <h3 className="profile-section-title">{text.profile.passkeys}</h3>
                {!loginSettings.data?.passkey_enabled ? (
                  <p className="profile-empty">{text.profile.passkeysDisabled}</p>
                ) : passkeys.isLoading ? (
                  <p className="profile-empty">
                    <LoadingIndicator size={14} label={text.common.loading} />
                  </p>
                ) : (
                  <div className="profile-provider-list">
                    {(passkeys.data || []).map((passkey) => {
                      const busy = deletePasskey.isPending && deletePasskey.variables === passkey.id;
                      return (
                        <div className="profile-provider-row profile-provider-bound" key={passkey.id}>
                          <div className="profile-provider-left">
                            <Fingerprint size={18} />
                            <span>{passkey.name}</span>
                            <span className="profile-muted">{formatProfileDate(passkey.last_used_at || passkey.created_at)}</span>
                          </div>
                          <button
                            className="btn-ghost profile-unbind-btn"
                            type="button"
                            disabled={busy}
                            onClick={() => deletePasskey.mutate(passkey.id)}
                          >
                            {busy ? <LoadingIndicator size={14} /> : <Trash2 size={14} />}
                            {text.common.delete}
                          </button>
                        </div>
                      );
                    })}
                    {(passkeys.data || []).length === 0 && <p className="profile-empty">{text.profile.noPasskeys}</p>}
                    <button
                      className="btn-secondary profile-bind-btn profile-add-passkey"
                      type="button"
                      disabled={bindPasskey.isPending}
                      onClick={(event) => {
                        feedbackOriginRef.current = event.currentTarget;
                        bindPasskey.mutate();
                      }}
                    >
                      {bindPasskey.isPending ? <LoadingIndicator size={14} /> : <Plus size={14} />}
                      {text.profile.addPasskey}
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn-secondary" onClick={onClose}>
                {text.common.close}
              </button>
            </div>
    </DialogShell>
  );
}

function formatProfileDate(value?: string) {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
  } catch {
    return value;
  }
}
