import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleUserRound, Fingerprint, Github, Plus, Trash2, Unlink, X } from 'lucide-react';
import { toast } from 'sonner';
import type { User } from '../api';
import { api } from '../api';
import type { OAuthProvider, PublicLoginSettings } from '../types';
import { roleText, useText } from '../locales';
import { IconButton, InfoTip, LoadingIndicator } from '../components/shared';
import { notifySuccess } from '../lib/feedback';
import { registerPasskey, type PasskeyCredentialSummary } from '../lib/passkeys';

type OAuthIdentity = {
  provider: string;
  name: string;
  avatar_url: string;
  bound_at: string;
};

export function UserProfileDialog({ open, onClose, user }: { open: boolean; onClose: () => void; user: User }) {
  const queryClient = useQueryClient();
  const text = useText();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const feedbackOriginRef = useRef<HTMLElement | null>(null);

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

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusableElements = panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusableElements || focusableElements.length === 0) return;
      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  const boundProviders = new Set((identities.data || []).map((id) => id.provider));
  const availableProviders = (providers.data || []).filter((p) => p.configured && p.enabled);
  const loadingProviders = providers.isLoading || identities.isLoading;

  const bind = (provider: string) => {
    const bindURL = `/api/oauth/${provider}/login?mode=bind&redirect=${encodeURIComponent('/#/dashboard')}`;
    window.location.href = bindURL;
  };

  const backdropVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1 },
  };

  const panelVariants = {
    hidden: { opacity: 0, transform: 'translateY(0.55rem) scale(0.96)' },
    visible: { opacity: 1, transform: 'translateY(0) scale(1)' },
    exit: { opacity: 0, transform: 'translateY(0.55rem) scale(0.96)' },
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal-backdrop"
          style={{ animation: 'none' }}
          role="presentation"
          variants={backdropVariants}
          initial="hidden"
          animate="visible"
          exit="hidden"
          transition={{ duration: 0.15 }}
          onMouseDown={(event) => event.target === event.currentTarget && onClose()}
        >
          <motion.div
            ref={panelRef}
            className="modal-panel profile-dialog"
            style={{ animation: 'none' }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-dialog-title"
            tabIndex={-1}
            variants={panelVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            transition={{ duration: 0.18 }}
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
                <div className="profile-avatar">{user.email.slice(0, 1).toUpperCase()}</div>
                <div className="profile-user-details">
                  <div className="profile-email">{user.email}</div>
                  <div className="profile-role">{roleText(user.role, text)}</div>
                </div>
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
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
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
