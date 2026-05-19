import { useState, useRef, useEffect, useCallback } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowRight, Check, CircleUserRound, Code2, Fingerprint, Github, Globe2, Inbox, KeyRound, MailPlus, Network, Share2, ShieldCheck, Sparkles, Terminal, Users, Zap } from 'lucide-react';
import { toast } from 'sonner';
import type { InstallStatus, User } from '../api';
import { api, postJSON } from '../api';
import type { OAuthProvider, PublicLoginSettings } from '../types';
import { useText } from '../locales';
import { useCountUp } from '../hooks/useCountUp';
import { HeaderSettings } from '../components/layout/HeaderSettings';
import { AppLogo } from '../components/shared/AppLogo';
import { InfoTip, LoadingIndicator } from '../components/shared';
import { notifySuccess } from '../lib/feedback';
import { loginWithPasskey } from '../lib/passkeys';

declare global {
  interface Window {
    turnstile?: {
      render: (container: string | HTMLElement, options: { sitekey: string; callback?: (token: string) => void; 'error-callback'?: () => void; 'expired-callback'?: () => void; theme?: string; appearance?: string }) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

const TURNSTILE_SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export function LandingPage({ status, onDone }: { status?: InstallStatus; onDone: () => void }) {
  const text = useText();
  const mxTarget = (status?.config?.expected_mx || status?.config?.mail_hostname || 'mail.example.com').replace(/\.$/, '');
  const siteApiCallsToday = status?.site_api_calls_today ?? 0;
  const registeredUsers = status?.registered_users ?? 0;
  const hostedDomains = status?.hosted_domains ?? 0;
  const animatedUsers = useCountUp(registeredUsers);
  const animatedDomains = useCountUp(hostedDomains);
  const animatedApiCalls = useCountUp(siteApiCallsToday);
  const previewDomain = text.login.previewDomain.replace('{mx}', mxTarget);
  const previewApi = text.login.previewApi.replace('{count}', siteApiCallsToday.toLocaleString());
  const proofLine = text.login.proofLine
    .replace('{users}', registeredUsers.toLocaleString())
    .replace('{domains}', hostedDomains.toLocaleString());
  const authPanelRef = useRef<HTMLElement>(null);
  const authSubmitRef = useRef<HTMLButtonElement>(null);
  const passkeySubmitRef = useRef<HTMLButtonElement>(null);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const oauthProviders = useQuery({
    queryKey: ['oauth-providers'],
    queryFn: () => api<OAuthProvider[]>('/api/oauth/providers'),
    retry: false,
    staleTime: 60_000
  });
  const loginSettings = useQuery({
    queryKey: ['login-settings'],
    queryFn: () => api<PublicLoginSettings>('/api/auth/login-settings'),
    retry: false,
    staleTime: 60_000
  });
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileLoadError, setTurnstileLoadError] = useState(false);
  const turnstileWidgetId = useRef<string | null>(null);
  const turnstileContainerRef = useRef<HTMLDivElement>(null);

  const turnstileEnabled = Boolean(loginSettings.data?.turnstile_enabled && loginSettings.data?.turnstile_site_key);
  const turnstileSiteKey = loginSettings.data?.turnstile_site_key || '';
  const passkeyEnabled = !!loginSettings.data?.passkey_enabled;

  const resetTurnstile = useCallback(() => {
    setTurnstileToken('');
    if (turnstileWidgetId.current && window.turnstile) {
      try {
        window.turnstile.reset(turnstileWidgetId.current);
      } catch {
        turnstileWidgetId.current = null;
      }
    }
  }, []);

  useEffect(() => {
    if (!turnstileEnabled) {
      setTurnstileToken('');
      setTurnstileLoadError(false);
      return;
    }

    let cancelled = false;
    let loadTimeout: number | undefined;
    let script = document.querySelector<HTMLScriptElement>('script[data-turnstile-api="true"], script[src*="challenges.cloudflare.com/turnstile/v0/api.js"]');

    const renderWidget = () => {
      if (cancelled || !window.turnstile || !turnstileContainerRef.current || turnstileWidgetId.current) return;
      try {
        turnstileWidgetId.current = window.turnstile.render(turnstileContainerRef.current, {
          sitekey: turnstileSiteKey,
          callback: (token: string) => {
            if (cancelled) return;
            setTurnstileToken(token);
            setTurnstileLoadError(false);
          },
          'error-callback': () => {
            if (cancelled) return;
            setTurnstileToken('');
            setTurnstileLoadError(true);
          },
          'expired-callback': () => {
            if (cancelled) return;
            setTurnstileToken('');
          },
          appearance: 'always',
          theme: 'auto'
        });
        setTurnstileLoadError(false);
      } catch {
        if (!cancelled) {
          setTurnstileToken('');
          setTurnstileLoadError(true);
        }
      }
    };

    const handleLoad = () => {
      if (loadTimeout) window.clearTimeout(loadTimeout);
      renderWidget();
    };
    const handleError = () => {
      if (loadTimeout) window.clearTimeout(loadTimeout);
      if (!cancelled) {
        setTurnstileToken('');
        setTurnstileLoadError(true);
      }
    };

    setTurnstileToken('');
    setTurnstileLoadError(false);

    if (window.turnstile) {
      renderWidget();
    } else {
      if (!script) {
        script = document.createElement('script');
        script.src = TURNSTILE_SCRIPT_SRC;
        script.async = true;
        script.defer = true;
        script.dataset.turnstileApi = 'true';
        document.head.appendChild(script);
      }
      script.addEventListener('load', handleLoad);
      script.addEventListener('error', handleError);
      loadTimeout = window.setTimeout(() => {
        if (!cancelled && !window.turnstile) {
          setTurnstileLoadError(true);
        }
      }, 8000);
    }

    return () => {
      cancelled = true;
      if (loadTimeout) window.clearTimeout(loadTimeout);
      script?.removeEventListener('load', handleLoad);
      script?.removeEventListener('error', handleError);
      if (turnstileWidgetId.current && window.turnstile) {
        try {
          window.turnstile.remove(turnstileWidgetId.current);
        } catch {
          // The widget may already be gone after a strict-mode remount.
        }
        turnstileWidgetId.current = null;
      }
    };
  }, [turnstileEnabled, turnstileSiteKey]);

  const login = useMutation({
    mutationFn: () => postJSON<User>('/api/auth/login', { email, password, turnstile_token: turnstileToken }),
    onSuccess: () => {
      notifySuccess(text.toast.loginDone, { origin: authSubmitRef.current });
      onDone();
    },
    onError: (error) => {
      resetTurnstile();
      toast.error(error.message);
    }
  });
  const register = useMutation({
    mutationFn: () => {
      if (password.length < 8) {
        throw new Error(text.login.passwordTooShort || '密码至少 8 位');
      }
      if (password !== confirmPassword) {
        throw new Error(text.login.passwordMismatch);
      }
      return postJSON<User>('/api/auth/register', { email, password, turnstile_token: turnstileToken });
    },
    onSuccess: () => {
      notifySuccess(text.login.registerDone, { origin: authSubmitRef.current });
      onDone();
    },
    onError: (error) => {
      resetTurnstile();
      toast.error(error.message);
    }
  });
  const passkeyLogin = useMutation({
    mutationFn: () => {
      if (!email.trim()) throw new Error(text.login.emailRequired);
      return loginWithPasskey(email.trim());
    },
    onSuccess: () => {
      notifySuccess(text.toast.loginDone, { origin: passkeySubmitRef.current });
      onDone();
    },
    onError: (error) => toast.error(error.message),
  });
  const isRegister = mode === 'register';
  const pending = login.isPending || register.isPending || passkeyLogin.isPending;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isRegister) {
      register.mutate();
      return;
    }
    login.mutate();
  };

  return (
    <div className="landing-page">
      <a href="#auth-panel" className="skip-to-content">
        {text.login.skipToContent ?? '跳到主要内容'}
      </a>
      <header className="landing-header">
        <div className="landing-brand">
          <span className="app-header-brand-mark">
            <AppLogo />
          </span>
          <span>HLOOL Mail</span>
        </div>
        <nav className="landing-nav">
          <a href="https://github.com/hloolx/HloolMail" target="_blank" rel="noopener noreferrer" aria-label="GitHub">
            <Github size={17} />
          </a>
        </nav>
        <HeaderSettings />
      </header>

      <main className="landing-main">
        <section className="landing-hero">
          <div className="landing-kicker">
            <Sparkles size={14} />
            {text.login.homeBadge}
          </div>
          <h1>{text.login.homeTitle}</h1>
          <p>{text.login.homeSlogan}</p>
          <p className="landing-hero-desc">{text.login.homeDesc}</p>
          <div className="landing-actions">
            <button className="btn-primary" type="button" onClick={() => { setMode('register'); authPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>
              <MailPlus size={16} />
              {text.login.primaryAction}
            </button>
            <a className="btn-secondary" href="#features">
              <ShieldCheck size={16} />
              {text.login.secondaryAction}
            </a>
          </div>
        </section>

        <section id="auth-panel" ref={authPanelRef} className="auth-panel" aria-label={isRegister ? text.login.registerTitle : text.login.title}>
          <div className="auth-tabs" role="tablist">
            <button className={!isRegister ? 'auth-tab-active' : ''} type="button" role="tab" aria-selected={!isRegister} tabIndex={!isRegister ? 0 : -1} onClick={() => { setMode('login'); resetTurnstile(); }}>
              {text.login.loginTab}
            </button>
            <button className={isRegister ? 'auth-tab-active' : ''} type="button" role="tab" aria-selected={isRegister} tabIndex={isRegister ? 0 : -1} onClick={() => { setMode('register'); resetTurnstile(); }}>
              {text.login.registerTab}
            </button>
          </div>
          <div className="auth-heading">
            <h2>{isRegister ? text.login.registerTitle : text.login.title}</h2>
            <p>{isRegister ? text.login.registerDesc : text.login.desc}</p>
          </div>
          <form className="auth-form" onSubmit={submit}>
            <label htmlFor="auth-email" className="sr-only">{text.login.email}</label>
            <input id="auth-email" className="input" value={email} onChange={(event) => setEmail(event.target.value)} placeholder={text.login.email} type="email" autoComplete="email" />
            <label htmlFor="auth-password" className="sr-only">{text.login.password}</label>
            <input id="auth-password" className="input" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={text.login.password} type="password" autoComplete={isRegister ? 'new-password' : 'current-password'} />
            {isRegister && <InfoTip text={text.login.passwordHint} />}
            <div className={`auth-confirm-wrapper${isRegister ? '' : ' auth-confirm-collapsed'}`}>
              <label htmlFor="auth-confirm-password" className="sr-only">{text.login.confirmPassword}</label>
              <input id="auth-confirm-password" className="input" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder={text.login.confirmPassword} type="password" autoComplete="new-password" />
            </div>
            {turnstileEnabled && (
              <>
                <div ref={turnstileContainerRef} className="auth-turnstile-widget" />
                {turnstileLoadError && (
                  <p className="auth-turnstile-error" role="status">
                    Turnstile failed to load. Refresh the page or check CSP/network settings.
                  </p>
                )}
              </>
            )}
            <button ref={authSubmitRef} className="btn-primary auth-submit" type="submit" disabled={pending || (!!turnstileEnabled && !turnstileToken)}>
              {pending ? (
                <LoadingIndicator className="auth-submit-loading" label={isRegister ? text.login.registerPending : text.login.loginPending} />
              ) : (
                <>{isRegister ? text.login.registerSubmit : text.login.submit}<ArrowRight size={16} /></>
              )}
            </button>
            {!isRegister && passkeyEnabled && (
              <button
                className="btn-secondary auth-submit"
                type="button"
                ref={passkeySubmitRef}
                disabled={pending}
                onClick={() => passkeyLogin.mutate()}
              >
                {passkeyLogin.isPending ? <LoadingIndicator className="auth-submit-loading" label={text.login.passkeyPending} /> : <><Fingerprint size={16} />{text.login.passkeySubmit}</>}
              </button>
            )}
          </form>
          {(oauthProviders.data || []).length > 0 && (
            <div className="oauth-login-box">
              <div className="oauth-login-divider"><span>{text.oauth.title}</span></div>
              <div className="oauth-login-actions">
                {(oauthProviders.data || []).map((provider) => {
                  const Icon = provider.provider === 'github' ? Github : CircleUserRound;
                  const actionLabel = (isRegister ? text.oauth.register_with : text.oauth.login_with).replace('{provider}', provider.name);
                  return (
                    <button
                      className="oauth-login-button"
                      type="button"
                      key={provider.provider}
                      aria-label={actionLabel}
                      onClick={() => { window.location.href = provider.auth_url; }}
                    >
                      <Icon size={17} />
                      {actionLabel}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {oauthProviders.isError && (
            <p className="oauth-error-fallback">{text.oauth.load_error}</p>
          )}
          <div className="landing-console-preview" aria-hidden>
            <div className="landing-preview-top">
              <span />
              <span />
              <span />
              <b>{text.login.previewTitle}</b>
            </div>
            <div className="landing-preview-row">
              <Inbox size={15} />
              <span>{text.login.previewInbox}</span>
              <Check size={14} />
            </div>
            <div className="landing-preview-row">
              <Globe2 size={15} />
              <span>{previewDomain}</span>
              <Check size={14} />
            </div>
            <div className="landing-preview-row">
              <KeyRound size={15} />
              <span>{previewApi}</span>
              <ArrowRight size={14} />
            </div>
          </div>
        </section>
      </main>

      <section className="landing-stats">
        <div className="landing-stats-grid">
          <div className="landing-stat">
            <Users size={20} />
            <b>{animatedUsers.toLocaleString()}</b>
            <span>{text.login.statUsers}</span>
          </div>
          <div className="landing-stat">
            <Globe2 size={20} />
            <b>{animatedDomains.toLocaleString()}</b>
            <span>{text.login.statHostedDomains}</span>
          </div>
          <div className="landing-stat">
            <Zap size={20} />
            <b>{animatedApiCalls.toLocaleString()}</b>
            <span>{text.login.statApiToday}</span>
          </div>
        </div>
        <p className="landing-stats-proof">{proofLine}</p>
      </section>

      <section className="landing-how" id="how">
        <div className="landing-section-head">
          <h2>{text.login.howTitle}</h2>
          <p>{text.login.howDesc}</p>
        </div>
        <div className="landing-how-steps">
          <div className="landing-how-step">
            <span className="landing-how-num">01</span>
            <Network size={20} />
            <b>{text.login.flowDns}</b>
            <span>{text.login.flowDnsDesc.replace('{mx}', mxTarget)}</span>
          </div>
          <div className="landing-how-step">
            <span className="landing-how-num">02</span>
            <Inbox size={20} />
            <b>{text.login.flowMailbox}</b>
            <span>{text.login.flowMailboxDesc}</span>
          </div>
          <div className="landing-how-step">
            <span className="landing-how-num">03</span>
            <Code2 size={20} />
            <b>{text.login.flowApi}</b>
            <span>{text.login.flowApiDesc}</span>
          </div>
        </div>
      </section>

      <section className="landing-features" id="features">
        <div className="landing-section-head">
          <h2>{text.login.featuresSectionTitle}</h2>
          <p>{text.login.featuresSectionDesc}</p>
        </div>
        <div className="landing-features-grid">
          <article>
            <Zap size={20} />
            <h3>{text.login.featureOneTitle}</h3>
            <p>{text.login.featureOneDesc}</p>
          </article>
          <article>
            <Code2 size={20} />
            <h3>{text.login.featureTwoTitle}</h3>
            <p>{text.login.featureTwoDesc}</p>
          </article>
          <article>
            <Share2 size={20} />
            <h3>{text.login.featureThreeTitle}</h3>
            <p>{text.login.featureThreeDesc}</p>
          </article>
          <article>
            <Terminal size={20} />
            <h3>{text.login.featureFourTitle}</h3>
            <p>{text.login.featureFourDesc}</p>
          </article>
        </div>
      </section>

      <section className="landing-overview">
        <div className="landing-overview-copy">
          <span>{text.login.overviewEyebrow}</span>
          <h2>{text.login.overviewTitle}</h2>
          <p>{text.login.overviewDesc}</p>
        </div>
        <div className="landing-overview-api" aria-hidden>
          <div className="landing-api-line">
            <b>POST</b>
            <code>/api/generate-email</code>
            <span>{text.login.apiLineCreate}</span>
          </div>
          <div className="landing-api-line">
            <b>GET</b>
            <code>/api/emails</code>
            <span>{text.login.apiLineReceive}</span>
          </div>
          <div className="landing-api-line">
            <b>GET</b>
            <code>/api/emails/:id</code>
            <span>{text.login.apiLineDetail}</span>
          </div>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <div className="landing-footer-brand">
            <span className="app-header-brand-mark">
              <AppLogo />
            </span>
            <span>HLOOL Mail</span>
          </div>
          <nav className="landing-footer-links">
            <a href="#how">{text.login.howTitle}</a>
            <a href="#features">{text.login.featuresSectionTitle}</a>
            <a href="https://github.com/hloolx/HloolMail" target="_blank" rel="noopener noreferrer">
              <Github size={14} />
              hloolx/HloolMail
            </a>
          </nav>
          <p className="landing-footer-copy">{text.login.footerCopy}</p>
        </div>
      </footer>
    </div>
  );
}
