import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowRight, Check, CircleUserRound, Code2, Github, Globe2, Inbox, KeyRound, MailPlus, Network, Share2, ShieldCheck, Sparkles, Terminal, Users, Zap } from 'lucide-react';
import { toast } from 'sonner';
import type { InstallStatus, User } from '../api';
import { api, postJSON } from '../api';
import type { OAuthProvider } from '../types';
import { useText } from '../locales';
import { HeaderSettings } from '../components/layout/HeaderSettings';
import { AppLogo } from '../components/shared/AppLogo';

export function LandingPage({ status, onDone }: { status?: InstallStatus; onDone: () => void }) {
  const text = useText();
  const mxTarget = (status?.config.expected_mx || status?.config.mail_hostname || 'mail.example.com').replace(/\.$/, '');
  const siteApiCallsToday = status?.site_api_calls_today ?? 0;
  const registeredUsers = status?.registered_users ?? 0;
  const hostedDomains = status?.hosted_domains ?? 0;
  const previewDomain = text.login.previewDomain.replace('{mx}', mxTarget);
  const previewApi = text.login.previewApi.replace('{count}', siteApiCallsToday.toLocaleString());
  const proofLine = text.login.proofLine
    .replace('{users}', registeredUsers.toLocaleString())
    .replace('{domains}', hostedDomains.toLocaleString());
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
  const login = useMutation({
    mutationFn: () => postJSON<User>('/api/auth/login', { email, password }),
    onSuccess: () => {
      toast.success(text.toast.loginDone);
      onDone();
    },
    onError: (error) => toast.error(error.message)
  });
  const register = useMutation({
    mutationFn: () => {
      if (password.length < 8) {
        throw new Error(text.login.passwordTooShort || '密码至少 8 位');
      }
      if (password !== confirmPassword) {
        throw new Error(text.login.passwordMismatch);
      }
      return postJSON<User>('/api/auth/register', { email, password });
    },
    onSuccess: () => {
      toast.success(text.login.registerDone);
      onDone();
    },
    onError: (error) => toast.error(error.message)
  });
  const isRegister = mode === 'register';
  const pending = login.isPending || register.isPending;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isRegister) {
      register.mutate();
      return;
    }
    login.mutate();
  };

  return (
    <div className="landing-page min-h-screen bg-[var(--shell)] text-[var(--foreground)]">
      <header className="landing-header">
        <div className="landing-brand">
          <span className="app-header-brand-mark">
            <AppLogo />
          </span>
          <span>HLOOL Mail</span>
        </div>
        <HeaderSettings />
      </header>

      <main className="landing-main">
        <section className="landing-hero">
          <div className="landing-kicker">
            <Sparkles size={15} />
            {text.login.homeBadge}
          </div>
          <h1>{text.login.homeTitle}</h1>
          <p>{text.login.homeDesc}</p>
          <p className="landing-slogan">{text.login.homeSlogan}</p>
          <div className="landing-actions">
            <button className="btn-primary" type="button" onClick={() => setMode('register')}>
              <MailPlus size={16} />
              {text.login.primaryAction}
            </button>
            <a className="btn-secondary" href="#capabilities">
              <ShieldCheck size={16} />
              {text.login.secondaryAction}
            </a>
          </div>
          <div className="landing-proof-strip">
            <Users size={16} />
            <span>{proofLine}</span>
          </div>
          <div className="landing-stat-row">
            <div><b>{registeredUsers.toLocaleString()}</b><span>{text.login.statUsers}</span></div>
            <div><b>{hostedDomains.toLocaleString()}</b><span>{text.login.statHostedDomains}</span></div>
            <div><b>{siteApiCallsToday.toLocaleString()}</b><span>{text.login.statApiToday}</span></div>
          </div>
          <div className="landing-flow" aria-label={text.login.flowAria}>
            <div className="landing-flow-step">
              <Network size={17} />
              <b>{text.login.flowDns}</b>
              <span>{text.login.flowDnsDesc.replace('{mx}', mxTarget)}</span>
            </div>
            <div className="landing-flow-step">
              <Inbox size={17} />
              <b>{text.login.flowMailbox}</b>
              <span>{text.login.flowMailboxDesc}</span>
            </div>
            <div className="landing-flow-step">
              <Code2 size={17} />
              <b>{text.login.flowApi}</b>
              <span>{text.login.flowApiDesc}</span>
            </div>
          </div>
        </section>

        <section className="auth-panel" aria-label={isRegister ? text.login.registerTitle : text.login.title}>
          <div className="auth-tabs" role="tablist">
            <button className={!isRegister ? 'auth-tab-active' : ''} type="button" onClick={() => setMode('login')}>
              {text.login.loginTab}
            </button>
            <button className={isRegister ? 'auth-tab-active' : ''} type="button" onClick={() => setMode('register')}>
              {text.login.registerTab}
            </button>
          </div>
          <div className="auth-heading">
            <h2>{isRegister ? text.login.registerTitle : text.login.title}</h2>
            <p>{isRegister ? text.login.registerDesc : text.login.desc}</p>
          </div>
          <form className="auth-form" onSubmit={submit}>
            <input className="input" value={email} onChange={(event) => setEmail(event.target.value)} placeholder={text.login.email} type="email" autoComplete="email" />
            <input className="input" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={text.login.password} type="password" autoComplete={isRegister ? 'new-password' : 'current-password'} />
            {isRegister && (
              <input className="input" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder={text.login.confirmPassword} type="password" autoComplete="new-password" />
            )}
            <button className="btn-primary auth-submit" type="submit" disabled={pending}>
              {isRegister ? text.login.registerSubmit : text.login.submit}
              <ArrowRight size={16} />
            </button>
          </form>
          {(oauthProviders.data || []).length > 0 && (
            <div className="oauth-login-box">
              <div className="oauth-login-divider"><span>{text.oauth.title}</span></div>
              <div className="oauth-login-actions">
                {(oauthProviders.data || []).map((provider) => {
                  const Icon = provider.provider === 'github' ? Github : CircleUserRound;
                  return (
                    <button className="oauth-login-button" type="button" key={provider.provider} onClick={() => { window.location.href = provider.auth_url; }}>
                      <Icon size={17} />
                      {text.oauth.login_with.replace('{provider}', provider.name)}
                    </button>
                  );
                })}
              </div>
            </div>
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

      <section className="landing-feature-grid" id="capabilities">
        <article>
          <Zap size={18} />
          <h3>{text.login.featureOneTitle}</h3>
          <p>{text.login.featureOneDesc}</p>
        </article>
        <article>
          <Code2 size={18} />
          <h3>{text.login.featureTwoTitle}</h3>
          <p>{text.login.featureTwoDesc}</p>
        </article>
        <article>
          <Share2 size={18} />
          <h3>{text.login.featureThreeTitle}</h3>
          <p>{text.login.featureThreeDesc}</p>
        </article>
        <article>
          <Terminal size={18} />
          <h3>{text.login.featureFourTitle}</h3>
          <p>{text.login.featureFourDesc}</p>
        </article>
      </section>

      <section className="landing-overview" aria-label={text.login.overviewTitle}>
        <div className="landing-overview-copy">
          <span>{text.login.overviewEyebrow}</span>
          <h2>{text.login.overviewTitle}</h2>
          <p>{text.login.overviewDesc}</p>
        </div>
        <div className="landing-api-panel" aria-hidden>
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
    </div>
  );
}
