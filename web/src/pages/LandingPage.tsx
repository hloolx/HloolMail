import { useState, useRef, useEffect, useCallback } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowRight, Bot, Check, CircleAlert, CircleUserRound, Code2, Copy as CopyIcon, Fingerprint, Github, Globe2, Home, Inbox, KeyRound, LockKeyhole, MailCheck, MailPlus, Network, PackageCheck, RefreshCcw, Share2, Sparkles, Terminal, Users, Zap, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { InstallStatus, User } from '../api';
import { api, postJSON } from '../api';
import type { OAuthProvider, PublicLoginSettings, RegisterCaptcha, RegisterResponse } from '../types';
import { useText } from '../locales';
import { useCountUp } from '../hooks/useCountUp';
import { useCopyState } from '../hooks/useCopyState';
import { HeaderSettings } from '../components/layout/HeaderSettings';
import { AppLogo } from '../components/shared/AppLogo';
import { InfoTip, LoadingIndicator } from '../components/shared';
import { notifySuccess } from '../lib/feedback';
import { copy } from '../lib/clipboard';
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

type AuthFieldErrors = Partial<Record<'email' | 'password' | 'confirmPassword' | 'captchaAnswer' | 'verificationCode', string>>;

type LandingPageProps = {
  status?: InstallStatus;
  onDone: () => void;
  authMode?: 'home' | 'auth';
  initialMode?: 'login' | 'register';
  statsLoading?: boolean;
};

export function LandingPage({ status, onDone, authMode = 'home', initialMode = 'login', statsLoading = false }: LandingPageProps) {
  const text = useText();
  const isAuthPage = authMode === 'auth';
  const mxTarget = (status?.config?.expected_mx || status?.config?.mail_hostname || 'mail.example.com').replace(/\.$/, '');
  const siteApiCallsToday = status?.site_api_calls_today ?? 0;
  const registeredUsers = status?.registered_users ?? 0;
  const hostedDomains = status?.hosted_domains ?? 0;
  const publicStatsLoading = !isAuthPage && statsLoading;
  const previewDomain = text.login.previewDomain.replace('{mx}', mxTarget);
  const previewApi = text.login.previewApi.replace('{count}', siteApiCallsToday.toLocaleString());
  const proofLine = text.login.proofLine
    .replace('{users}', registeredUsers.toLocaleString())
    .replace('{domains}', hostedDomains.toLocaleString());
  const authPanelRef = useRef<HTMLElement>(null);
  const authSubmitRef = useRef<HTMLButtonElement>(null);
  const passkeySubmitRef = useRef<HTMLButtonElement>(null);
  const loginTabRef = useRef<HTMLButtonElement>(null);
  const registerTabRef = useRef<HTMLButtonElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<'login' | 'register'>(initialMode);
  const [mxCopied, markMxCopied] = useCopyState();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [verification, setVerification] = useState<RegisterResponse | null>(null);
  const [verificationCode, setVerificationCode] = useState('');
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const [authFieldErrors, setAuthFieldErrors] = useState<AuthFieldErrors>({});
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
  const oauthRegistrationOpen = loginSettings.data ? loginSettings.data.registration_open !== false : true;
  const emailRegistrationAvailable = loginSettings.data
    ? loginSettings.data.registration_open !== false && loginSettings.data.email_registration_enabled !== false
    : true;
  const oauthError = isAuthPage ? oauthErrorFromLocation() : null;
  const isRegister = mode === 'register';
  const isVerificationStep = isRegister && verification !== null;
  const captchaRequired = isRegister && !isVerificationStep && loginSettings.isSuccess && !turnstileEnabled;
  const registerCaptcha = useQuery({
    queryKey: ['register-captcha'],
    queryFn: () => postJSON<RegisterCaptcha>('/api/auth/register/captcha', {}),
    enabled: captchaRequired,
    retry: false
  });

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    if (isAuthPage) return;
    const page = pageRef.current;
    if (!page) return;

    const revealTargets = Array.from(page.querySelectorAll<HTMLElement>('[data-landing-reveal]'));
    if (!revealTargets.length) return;

    const settleTimers: number[] = [];
    const reveal = (element: HTMLElement) => {
      element.classList.add('landing-reveal-visible');
      const timer = window.setTimeout(() => {
        element.classList.add('landing-reveal-settled');
      }, 1200);
      settleTimers.push(timer);
    };

    page.classList.add('landing-reveal-ready');

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      revealTargets.forEach((element) => {
        element.classList.add('landing-reveal-visible', 'landing-reveal-settled');
      });
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const element = entry.target as HTMLElement;
        reveal(element);
        observer.unobserve(element);
      });
    }, {
      root: null,
      rootMargin: '0px 0px -8% 0px',
      threshold: 0.14
    });

    revealTargets.forEach((element) => observer.observe(element));

    return () => {
      observer.disconnect();
      settleTimers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [isAuthPage]);

  const refreshCaptcha = useCallback(() => {
    setCaptchaAnswer('');
    void registerCaptcha.refetch();
  }, [registerCaptcha]);

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

  const selectAuthMode = useCallback((nextMode: 'login' | 'register') => {
    if (nextMode === 'register' && !emailRegistrationAvailable) return;
    setMode(nextMode);
    setVerification(null);
    setVerificationCode('');
    setAuthFieldErrors({});
    resetTurnstile();
  }, [emailRegistrationAvailable, resetTurnstile]);

  const clearOAuthError = useCallback(() => {
    window.location.hash = '#/login';
  }, []);

  const focusAuthTab = useCallback((nextMode: 'login' | 'register') => {
    const ref = nextMode === 'login' ? loginTabRef : registerTabRef;
    window.requestAnimationFrame(() => ref.current?.focus());
  }, []);

  const handleAuthTabKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    let nextMode: 'login' | 'register' | null = null;

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextMode = mode === 'login' && emailRegistrationAvailable ? 'register' : 'login';
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextMode = mode === 'register' || !emailRegistrationAvailable ? 'login' : 'register';
    } else if (event.key === 'Home') {
      nextMode = 'login';
    } else if (event.key === 'End') {
      nextMode = 'register';
    }

    if (!nextMode) return;
    event.preventDefault();
    selectAuthMode(nextMode);
    focusAuthTab(nextMode);
  }, [emailRegistrationAvailable, focusAuthTab, mode, selectAuthMode]);

  useEffect(() => {
    if (!emailRegistrationAvailable && mode === 'register') {
      setMode('login');
      setVerification(null);
      setVerificationCode('');
      setCaptchaAnswer('');
      setAuthFieldErrors({});
    }
  }, [emailRegistrationAvailable, mode]);

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
    mutationFn: () => {
      const normalizedEmail = email.trim();
      if (!normalizedEmail) throw new Error(text.login.emailRequired);
      return postJSON<User>('/api/auth/login', { email: normalizedEmail, password, turnstile_token: turnstileToken });
    },
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
      const normalizedEmail = email.trim();
      if (!normalizedEmail) throw new Error(text.login.emailRequired);
      if (password.length < 8) {
        throw new Error(text.login.passwordTooShort);
      }
      if (password !== confirmPassword) {
        throw new Error(text.login.passwordMismatch);
      }
      if (!emailRegistrationAvailable) throw new Error(text.login.registrationUnavailable);
      const body: Record<string, string> = { email: normalizedEmail, password };
      if (turnstileEnabled) {
        body.turnstile_token = turnstileToken;
      } else {
        const captchaId = registerCaptcha.data?.captcha_id;
        const captchaAnswerValue = captchaAnswer.trim();
        if (!captchaId) throw new Error(text.login.captchaLoadError);
        if (!captchaAnswerValue) throw new Error(text.login.captchaAnswerRequired);
        body.captcha_id = captchaId;
        body.captcha_answer = captchaAnswerValue;
      }
      return postJSON<RegisterResponse>('/api/auth/register', body);
    },
    onSuccess: (response) => {
      setVerification(response);
      setVerificationCode('');
      setCaptchaAnswer('');
      resetTurnstile();
      notifySuccess(text.login.verificationSent, { origin: authSubmitRef.current });
    },
    onError: (error) => {
      resetTurnstile();
      if (!turnstileEnabled) refreshCaptcha();
      toast.error(error.message);
    }
  });
  const verifyRegister = useMutation({
    mutationFn: () => {
      if (!verification?.verification_id) throw new Error(text.login.verificationMissing);
      const code = verificationCode.trim();
      if (!code) throw new Error(text.login.verificationCodeRequired);
      return postJSON<User>('/api/auth/register/verify', { verification_id: verification.verification_id, code });
    },
    onSuccess: () => {
      notifySuccess(text.login.registerDone, { origin: authSubmitRef.current });
      onDone();
    },
    onError: (error) => {
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
  const pending = login.isPending || register.isPending || verifyRegister.isPending || passkeyLogin.isPending;
  const registerCaptchaBlocked = captchaRequired && (registerCaptcha.isLoading || !registerCaptcha.data?.captcha_id);
  const oauthErrorProviderName = oauthError?.provider ? oauthProviderDisplayName(oauthError.provider) : text.oauth.title;
  const focusAuthField = (field: keyof AuthFieldErrors) => {
    const idByField: Record<keyof AuthFieldErrors, string> = {
      email: 'auth-email',
      password: 'auth-password',
      confirmPassword: 'auth-confirm-password',
      captchaAnswer: 'auth-captcha-answer',
      verificationCode: 'auth-verification-code'
    };
    window.requestAnimationFrame(() => document.getElementById(idByField[field])?.focus());
  };
  const clearAuthFieldError = (field: keyof AuthFieldErrors) => {
    setAuthFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };
  const validateAuthFields = () => {
    const nextErrors: AuthFieldErrors = {};
    if (isVerificationStep) {
      if (!verificationCode.trim()) nextErrors.verificationCode = text.login.verificationCodeRequired;
    } else {
      if (!email.trim()) nextErrors.email = text.login.emailRequired;
      if (isRegister && password.length < 8) nextErrors.password = text.login.passwordTooShort;
      if (isRegister && password !== confirmPassword) nextErrors.confirmPassword = text.login.passwordMismatch;
      if (captchaRequired && !captchaAnswer.trim()) nextErrors.captchaAnswer = text.login.captchaAnswerRequired;
    }
    setAuthFieldErrors(nextErrors);
    const firstInvalid = (['email', 'password', 'confirmPassword', 'captchaAnswer', 'verificationCode'] as (keyof AuthFieldErrors)[])
      .find((field) => nextErrors[field]);
    if (firstInvalid) focusAuthField(firstInvalid);
    return Object.keys(nextErrors).length === 0;
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validateAuthFields()) return;
    if (isVerificationStep) {
      verifyRegister.mutate();
      return;
    }
    if (isRegister) {
      register.mutate();
      return;
    }
    login.mutate();
  };

  return (
    <div ref={pageRef} className={`landing-page${isAuthPage ? ' login-page' : ''}`}>
      <a href={isAuthPage ? '#auth-panel' : '#home-main'} className="skip-to-content">
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
          {!isAuthPage && (
            <div className="landing-nav-sections" aria-label={text.login.featuresSectionTitle}>
              <a href="#how">{text.login.howTitle}</a>
              <a href="#features">{text.login.featuresSectionTitle}</a>
              <a href="#use-cases">{text.login.useCasesTitle}</a>
              <a href="#deploy">{text.login.deployNav}</a>
            </div>
          )}
          {isAuthPage ? (
            <a className="landing-nav-link landing-nav-icon" href="#/" aria-label={text.login.homeLink || 'Home'}>
              <Home size={18} />
            </a>
          ) : (
            <a className="landing-nav-link landing-nav-icon" href="#/login" aria-label={text.login.loginTab}>
              <CircleUserRound size={18} />
            </a>
          )}
          <a className="landing-nav-link landing-nav-icon" href="https://github.com/hloolx/HloolMail" target="_blank" rel="noopener noreferrer" aria-label="GitHub">
            <Github size={17} />
          </a>
        </nav>
        <HeaderSettings />
      </header>

      <main id={isAuthPage ? undefined : 'home-main'} className={isAuthPage ? 'login-main' : 'landing-main landing-main-public'}>
        {!isAuthPage && (
        <section className="landing-hero">
          <div className="landing-hero-top">
            <div className="landing-hero-copy">
              <div className="landing-kicker">
                <Sparkles size={14} />
                {text.login.homeBadge}
              </div>
              <h1>
                {text.login.homeTitle}
              </h1>
              <p className="landing-hero-lead">{text.login.homeSlogan}</p>
              <p className="landing-hero-desc">{text.login.homeDesc}</p>
              <div className="landing-actions">
                {emailRegistrationAvailable && (
                  <button className="btn-primary" type="button" onClick={() => { window.location.hash = '#/register'; }}>
                    <MailPlus size={16} />
                    {text.login.primaryAction}
                  </button>
                )}
                <a className="btn-secondary" href="https://github.com/hloolx/HloolMail" target="_blank" rel="noopener noreferrer">
                  <Github size={16} />
                  {text.login.secondaryAction}
                </a>
              </div>
              <div className="landing-hero-proof">
                <span>{proofLine}</span>
              </div>
            </div>

            <aside className="landing-dns-config-card" aria-label={text.login.mxConfigTitle}>
              <div className="landing-dns-config-head">
                <span>
                  <Network size={16} />
                  {text.login.mxConfigTitle}
                </span>
                <div className="landing-mx-address">
                  <div>
                    <span>{text.login.mxConfigValue}</span>
                    <code>{mxTarget}</code>
                  </div>
                  <button
                    type="button"
                    className="landing-mx-copy-button"
                    aria-label={mxCopied ? text.common.copied : text.common.copy}
                    title={mxCopied ? text.common.copied : text.common.copy}
                    onClick={(event) => {
                      void copy(mxTarget, { event, celebrate: true, label: text.common.copied }).then((ok) => {
                        if (ok) markMxCopied();
                      });
                    }}
                  >
                    {mxCopied ? <Check size={15} /> : <CopyIcon size={15} />}
                  </button>
                </div>
              </div>
              <div className="landing-dns-config-list">
                <div className="landing-dns-config-row">
                  <span>{text.login.mxConfigType}</span>
                  <b>MX</b>
                </div>
                <div className="landing-dns-config-row">
                  <span className="landing-dns-label-with-tip">
                    {text.login.mxConfigHost}
                    <InfoTip text={text.login.mxConfigHostInfo} />
                  </span>
                  <b>{text.login.mxConfigHostValue}</b>
                </div>
                <div className="landing-dns-config-row">
                  <span>{text.login.mxConfigPriority}</span>
                  <b>10</b>
                </div>
              </div>
              <p>{text.login.domainCardDesc}</p>
            </aside>
          </div>
          <section className="landing-stats" aria-label={proofLine}>
            <div className="landing-stats-grid">
              <LandingStat icon={Users} value={registeredUsers} label={text.login.statUsers} loading={publicStatsLoading} />
              <LandingStat icon={Globe2} value={hostedDomains} label={text.login.statHostedDomains} loading={publicStatsLoading} />
              <LandingStat icon={Zap} value={siteApiCallsToday} label={text.login.statApiToday} loading={publicStatsLoading} />
            </div>
          </section>
        </section>
        )}

        {isAuthPage && (
        <section id="auth-panel" ref={authPanelRef} className="auth-panel" aria-label={isRegister ? text.login.registerTitle : text.login.title}>
          <div className="auth-tabs" role="tablist" aria-orientation="horizontal" aria-label={text.login.title} onKeyDown={handleAuthTabKeyDown}>
            <button ref={loginTabRef} className={!isRegister ? 'auth-tab-active' : ''} type="button" role="tab" aria-selected={!isRegister} tabIndex={!isRegister ? 0 : -1} onClick={() => selectAuthMode('login')}>
              {text.login.loginTab}
            </button>
            {emailRegistrationAvailable && (
              <button ref={registerTabRef} className={isRegister ? 'auth-tab-active' : ''} type="button" role="tab" aria-selected={isRegister} tabIndex={isRegister ? 0 : -1} onClick={() => selectAuthMode('register')}>
                {text.login.registerTab}
              </button>
            )}
          </div>
          <div className="auth-heading">
            <h2>{isVerificationStep ? text.login.verificationTitle : isRegister ? text.login.registerTitle : text.login.title}</h2>
            <p>{isVerificationStep ? text.login.verificationDesc.replace('{email}', email.trim()) : isRegister ? text.login.registerDesc : text.login.desc}</p>
          </div>
          {oauthError?.code === 'registration_closed' && (
            <div className="oauth-error-alert" role="alert">
              <span className="oauth-error-alert-icon">
                <CircleAlert size={18} aria-hidden="true" />
              </span>
              <div className="oauth-error-alert-content">
                <h3>{text.login.oauthRegistrationClosedTitle}</h3>
                <p>{text.login.oauthRegistrationClosedDesc.replace('{provider}', oauthErrorProviderName)}</p>
                <button className="btn-secondary" type="button" onClick={clearOAuthError}>
                  <Home size={15} aria-hidden="true" />
                  {text.login.oauthRegistrationClosedAction}
                </button>
              </div>
            </div>
          )}
          <form className="auth-form" onSubmit={submit}>
            {isVerificationStep ? (
              <>
                <label htmlFor="auth-verification-code" className="sr-only">{text.login.verificationCode}</label>
                <input
                  id="auth-verification-code"
                  className="input"
                  value={verificationCode}
                  onChange={(event) => {
                    setVerificationCode(event.target.value);
                    clearAuthFieldError('verificationCode');
                  }}
                  placeholder={text.login.verificationCode}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  aria-invalid={Boolean(authFieldErrors.verificationCode)}
                  aria-describedby={authFieldErrors.verificationCode ? 'auth-verification-code-error' : undefined}
                />
                {authFieldErrors.verificationCode && <span id="auth-verification-code-error" className="field-error" role="alert">{authFieldErrors.verificationCode}</span>}
                <button className="btn-secondary auth-submit" type="button" disabled={pending} onClick={() => selectAuthMode('register')}>
                  {text.login.backToRegister}
                </button>
              </>
            ) : (
              <>
                <label htmlFor="auth-email" className="sr-only">{text.login.email}</label>
                <input
                  id="auth-email"
                  className="input"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    clearAuthFieldError('email');
                  }}
                  placeholder={text.login.email}
                  type="email"
                  autoComplete="email"
                  aria-invalid={Boolean(authFieldErrors.email)}
                  aria-describedby={authFieldErrors.email ? 'auth-email-error' : undefined}
                />
                {authFieldErrors.email && <span id="auth-email-error" className="field-error" role="alert">{authFieldErrors.email}</span>}
                <label htmlFor="auth-password" className="sr-only">{text.login.password}</label>
                <input
                  id="auth-password"
                  className="input"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    clearAuthFieldError('password');
                  }}
                  placeholder={text.login.password}
                  type="password"
                  autoComplete={isRegister ? 'new-password' : 'current-password'}
                  aria-invalid={Boolean(authFieldErrors.password)}
                  aria-describedby={authFieldErrors.password ? 'auth-password-error' : undefined}
                />
                {authFieldErrors.password && <span id="auth-password-error" className="field-error" role="alert">{authFieldErrors.password}</span>}
                {isRegister && <InfoTip text={text.login.passwordHint} />}
                {isRegister && (
                  <div className="auth-confirm-wrapper">
                    <label htmlFor="auth-confirm-password" className="sr-only">{text.login.confirmPassword}</label>
                    <input
                      id="auth-confirm-password"
                      className="input"
                      value={confirmPassword}
                      onChange={(event) => {
                        setConfirmPassword(event.target.value);
                        clearAuthFieldError('confirmPassword');
                      }}
                      placeholder={text.login.confirmPassword}
                      type="password"
                      autoComplete="new-password"
                      aria-invalid={Boolean(authFieldErrors.confirmPassword)}
                      aria-describedby={authFieldErrors.confirmPassword ? 'auth-confirm-password-error' : undefined}
                    />
                    {authFieldErrors.confirmPassword && <span id="auth-confirm-password-error" className="field-error" role="alert">{authFieldErrors.confirmPassword}</span>}
                  </div>
                )}
              </>
            )}
            {!isVerificationStep && turnstileEnabled && (
              <>
                <div ref={turnstileContainerRef} className="auth-turnstile-widget" />
                {turnstileLoadError && (
                  <p className="auth-turnstile-error" role="status">
                    {text.login.turnstileLoadError}
                  </p>
                )}
              </>
            )}
            {captchaRequired && (
              <div className="auth-captcha-box">
                <div className="auth-captcha-challenge">
                  <span>{registerCaptcha.isLoading ? text.login.captchaLoading : registerCaptcha.data?.challenge || text.login.captchaLoadError}</span>
                  <button className="icon-button" type="button" onClick={refreshCaptcha} disabled={pending || registerCaptcha.isFetching} aria-label={text.login.captchaRefresh}>
                    <RefreshCcw size={15} />
                  </button>
                </div>
                <label htmlFor="auth-captcha-answer" className="sr-only">{text.login.captchaAnswer}</label>
                <input
                  id="auth-captcha-answer"
                  className="input"
                  value={captchaAnswer}
                  onChange={(event) => {
                    setCaptchaAnswer(event.target.value);
                    clearAuthFieldError('captchaAnswer');
                  }}
                  placeholder={text.login.captchaAnswer}
                  autoComplete="off"
                  aria-invalid={Boolean(authFieldErrors.captchaAnswer)}
                  aria-describedby={authFieldErrors.captchaAnswer ? 'auth-captcha-answer-error' : undefined}
                />
                {authFieldErrors.captchaAnswer && <span id="auth-captcha-answer-error" className="field-error" role="alert">{authFieldErrors.captchaAnswer}</span>}
              </div>
            )}
            <button ref={authSubmitRef} className="btn-primary auth-submit" type="submit" disabled={pending || (!isVerificationStep && !!turnstileEnabled && !turnstileToken) || registerCaptchaBlocked}>
              {pending ? (
                <LoadingIndicator className="auth-submit-loading" label={isVerificationStep ? text.login.verificationPending : isRegister ? text.login.registerPending : text.login.loginPending} />
              ) : (
                <>{isVerificationStep ? text.login.verificationSubmit : isRegister ? text.login.registerSubmit : text.login.submit}{isVerificationStep ? <MailCheck size={16} /> : <ArrowRight size={16} />}</>
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
                  const actionTemplate = isRegister
                    ? text.oauth.register_with
                    : oauthRegistrationOpen
                      ? text.oauth.continue_with
                      : text.oauth.login_with;
                  const actionLabel = actionTemplate.replace('{provider}', provider.name);
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
          {isAuthPage && (
            <p className="auth-page-terms">
              {text.login.termsPrefix || 'By continuing, you agree to our '}
              <a href="#/terms">{text.login.termsService || 'Terms of Service'}</a>
              {' '}
              {text.login.termsAnd || 'and'}
              {' '}
              <a href="#/privacy">{text.login.privacyPolicy || 'Privacy Policy'}</a>
              .
            </p>
          )}
          {!isAuthPage && (
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
          )}
        </section>
        )}
      </main>

      {!isAuthPage && (
      <>
      <section className="landing-how" id="how">
        <div className="landing-section-head" data-landing-reveal>
          <h2>{text.login.howTitle}</h2>
          <p>{text.login.howDesc}</p>
        </div>
        <div className="landing-how-steps landing-reveal-stagger">
          <div className="landing-how-step" data-landing-reveal>
            <span className="landing-how-num">01</span>
            <Network size={20} />
            <b>{text.login.flowDns}</b>
            <span>{text.login.flowDnsDesc.replace('{mx}', mxTarget)}</span>
          </div>
          <div className="landing-how-step" data-landing-reveal>
            <span className="landing-how-num">02</span>
            <Inbox size={20} />
            <b>{text.login.flowMailbox}</b>
            <span>{text.login.flowMailboxDesc}</span>
          </div>
          <div className="landing-how-step" data-landing-reveal>
            <span className="landing-how-num">03</span>
            <Code2 size={20} />
            <b>{text.login.flowApi}</b>
            <span>{text.login.flowApiDesc}</span>
          </div>
        </div>
      </section>

      <section className="landing-features" id="features">
        <div className="landing-section-head" data-landing-reveal>
          <h2>{text.login.featuresSectionTitle}</h2>
          <p>{text.login.featuresSectionDesc}</p>
        </div>
        <div className="landing-features-grid landing-reveal-stagger">
          <article data-landing-reveal>
            <Zap size={20} />
            <h3>{text.login.featureOneTitle}</h3>
            <p>{text.login.featureOneDesc}</p>
          </article>
          <article data-landing-reveal>
            <Code2 size={20} />
            <h3>{text.login.featureTwoTitle}</h3>
            <p>{text.login.featureTwoDesc}</p>
          </article>
          <article data-landing-reveal>
            <Share2 size={20} />
            <h3>{text.login.featureThreeTitle}</h3>
            <p>{text.login.featureThreeDesc}</p>
          </article>
          <article data-landing-reveal>
            <Terminal size={20} />
            <h3>{text.login.featureFourTitle}</h3>
            <p>{text.login.featureFourDesc}</p>
          </article>
          <article data-landing-reveal>
            <MailCheck size={20} />
            <h3>{text.login.featureFiveTitle}</h3>
            <p>{text.login.featureFiveDesc}</p>
          </article>
        </div>
      </section>

      <section className="landing-use-cases" id="use-cases">
        <div className="landing-section-head" data-landing-reveal>
          <h2>{text.login.useCasesTitle}</h2>
          <p>{text.login.useCasesDesc}</p>
        </div>
        <div className="landing-use-cases-grid landing-reveal-stagger">
          <article data-landing-reveal>
            <span className="landing-use-case-icon">
              <Bot size={20} />
            </span>
            <b>{text.login.useCaseBatchTitle}</b>
            <p>{text.login.useCaseBatchDesc}</p>
          </article>
          <article data-landing-reveal>
            <span className="landing-use-case-icon">
              <PackageCheck size={20} />
            </span>
            <b>{text.login.useCaseAccountTitle}</b>
            <p>{text.login.useCaseAccountDesc}</p>
          </article>
          <article data-landing-reveal>
            <span className="landing-use-case-icon">
              <LockKeyhole size={20} />
            </span>
            <b>{text.login.useCasePrivacyTitle}</b>
            <p>{text.login.useCasePrivacyDesc}</p>
          </article>
        </div>
      </section>

      <section className="landing-overview">
        <div className="landing-overview-copy landing-reveal-copy" data-landing-reveal>
          <span>{text.login.overviewEyebrow}</span>
          <h2>{text.login.overviewTitle}</h2>
          <p>{text.login.overviewDesc}</p>
        </div>
        <div className="landing-overview-api landing-reveal-panel" data-landing-reveal aria-hidden>
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

      <section className="landing-deploy" id="deploy">
        <div className="landing-deploy-copy landing-reveal-copy" data-landing-reveal>
          <span>{text.login.deployEyebrow}</span>
          <h2>{text.login.deployTitle}</h2>
          <p>{text.login.deployDesc}</p>
        </div>
        <div className="landing-deploy-panel landing-reveal-panel" data-landing-reveal aria-label={text.login.deployTitle}>
          <a href="https://github.com/hloolx/HloolMail" target="_blank" rel="noopener noreferrer">
            <Github size={17} />
            <span>{text.login.deployGithub}</span>
            <ArrowRight size={15} />
          </a>
          <div className="landing-deploy-method">
            <Terminal size={17} />
            <div>
              <b>{text.login.deployBinary}</b>
              <code>./hlool-mail serve</code>
            </div>
          </div>
          <div className="landing-deploy-method">
            <Code2 size={17} />
            <div>
              <b>{text.login.deployDocker}</b>
              <code>docker compose up -d</code>
            </div>
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
            <a href="#use-cases">{text.login.useCasesTitle}</a>
            <a href="#deploy">{text.login.deployNav}</a>
            <a href="https://github.com/hloolx/HloolMail" target="_blank" rel="noopener noreferrer">
              <Github size={14} />
              hloolx/HloolMail
            </a>
          </nav>
          <p className="landing-footer-copy">{text.login.footerCopy}</p>
        </div>
      </footer>
      </>
      )}
    </div>
  );
}

type OAuthErrorState = {
  code: string;
  provider: string;
};

function oauthErrorFromLocation(): OAuthErrorState | null {
  if (typeof window === 'undefined') return null;

  const fromSearch = oauthErrorFromParams(new URLSearchParams(window.location.search));
  if (fromSearch) return fromSearch;

  const queryStart = window.location.hash.indexOf('?');
  if (queryStart < 0) return null;
  return oauthErrorFromParams(new URLSearchParams(window.location.hash.slice(queryStart + 1)));
}

function oauthErrorFromParams(params: URLSearchParams): OAuthErrorState | null {
  const code = params.get('oauth_error');
  if (!code) return null;
  return {
    code,
    provider: params.get('oauth_provider') || ''
  };
}

function oauthProviderDisplayName(provider: string) {
  if (provider === 'github') return 'GitHub';
  if (provider === 'linuxdo') return 'Linux.do';
  return provider;
}

type LandingStatProps = {
  icon: LucideIcon;
  value: number;
  label: string;
  loading: boolean;
};

function LandingStat({ icon: Icon, value, label, loading }: LandingStatProps) {
  const animatedValue = useCountUp(loading ? 0 : value);
  const displayValue = loading ? 0 : animatedValue;

  return (
    <div className={`landing-stat ${loading ? 'landing-stat-loading' : 'landing-stat-ready'}`}>
      <Icon size={20} />
      <b className="landing-stat-number" key={`${loading ? 'loading' : 'ready'}-${label}-${value}`} aria-busy={loading}>
        {displayValue.toLocaleString()}
      </b>
      <span>{label}</span>
    </div>
  );
}
