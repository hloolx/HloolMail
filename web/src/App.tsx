import { lazy, Suspense, useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { InstallStatus } from './api';
import type { MeResponse } from './types';
import { useText } from './locales';
import { useAppStore } from './store';
import { CenteredState, ErrorBoundary, PageTransition } from './components/shared';
import { notifySuccess } from './lib/feedback';
import { setMonitoringTag, setMonitoringUser } from './lib/monitoring';
import { expireUserSession } from './lib/queryClient';

const InstallPage = lazy(() => import('./pages/InstallPage').then(m => ({ default: m.InstallPage })));
const LandingPage = lazy(() => import('./pages/LandingPage').then(m => ({ default: m.LandingPage })));
const LoginPage = lazy(() => import('./pages/LoginPage').then(m => ({ default: m.LoginPage })));
const LegalPage = lazy(() => import('./pages/LegalPage').then(m => ({ default: m.LegalPage })));
const SharedMessagePage = lazy(() => import('./pages/SharedMessagePage').then(m => ({ default: m.SharedMessagePage })));
const Console = lazy(() => import('./components/layout/Console').then(m => ({ default: m.Console })));

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

function AppContent() {
  const queryClient = useQueryClient();
  const [routeKey, setRouteKey] = useState(() => currentRouteKey());
  const sharedToken = sharedTokenFromLocation(routeKey);
  const isSharedRoute = Boolean(sharedToken);
  const authRoute = authRouteFromLocation(routeKey);
  const isAuthRoute = authRoute !== null;
  const legalRoute = legalRouteFromLocation(routeKey);
  const isLegalRoute = legalRoute !== null;
  // Keep high-churn store fields isolated so background counters do not re-render the app shell.
  const theme = useAppStore((state) => state.theme);
  const language = useAppStore((state) => state.language);
  const page = useAppStore((state) => state.page);
  const awayMailCount = useAppStore((state) => state.awayMailCount);
  const awayAnnouncementCount = useAppStore((state) => state.awayAnnouncementCount);
  const text = useText();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api<MeResponse>('/api/auth/me'),
    retry: false,
    enabled: !isSharedRoute
  });
  const installStatus = useQuery({
    queryKey: ['install-status'],
    queryFn: () => api<InstallStatus>('/api/install/status'),
    retry: false,
    enabled: !isSharedRoute
  });
  const skipInstall = import.meta.env.DEV && typeof window !== 'undefined' && sessionStorage.getItem('hlool_skip_install') === '1';

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      document.documentElement.classList.toggle('dark', theme === 'dark' || (theme === 'system' && media.matches));
    };

    applyTheme();
    if (theme !== 'system') return;

    media.addEventListener('change', applyTheme);
    return () => media.removeEventListener('change', applyTheme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = language === 'zh-CN' ? 'zh-CN' : 'en';
  }, [language]);

  useEffect(() => {
    const syncRoute = () => setRouteKey(currentRouteKey());
    window.addEventListener('hashchange', syncRoute);
    window.addEventListener('popstate', syncRoute);
    return () => {
      window.removeEventListener('hashchange', syncRoute);
      window.removeEventListener('popstate', syncRoute);
    };
  }, []);

  useEffect(() => {
    const handleAuthExpired = () => expireUserSession(queryClient);
    window.addEventListener('hlool:auth-expired', handleAuthExpired);
    return () => window.removeEventListener('hlool:auth-expired', handleAuthExpired);
  }, [queryClient]);

  useEffect(() => {
    const user = me.data?.user;
    if (!user) {
      setMonitoringUser(null);
      setMonitoringTag('user.role', 'anonymous');
      return;
    }
    setMonitoringUser({ id: user.id, role: user.role });
    setMonitoringTag('user.role', user.role);
  }, [me.data?.user]);

  useEffect(() => {
    const unreadCount = awayMailCount + awayAnnouncementCount;
    const pageTitle = isSharedRoute
      ? text.shared.title
      : isAuthRoute
        ? (authRoute === 'register' ? text.login.registerTitle : text.login.title)
      : (!me.isError && me.data?.installed === false
        ? text.install.title
        : me.isError || !me.data?.user
          ? text.login.title
          : text.page[page]);
    document.title = `${unreadCount > 0 ? `(${unreadCount}) ` : ''}${pageTitle} | HLOOL Mail`;
  }, [authRoute, awayAnnouncementCount, awayMailCount, isAuthRoute, isSharedRoute, me.data?.installed, me.data?.user, me.isError, page, text]);

  useEffect(() => {
    if (skipInstall && me.data?.user) {
      sessionStorage.removeItem('hlool_skip_install');
    }
  }, [skipInstall, me.data?.user]);

  useEffect(() => {
    if (!me.data?.user) return;
    const feedback = consumeOAuthFeedback();
    if (!feedback) return;

    const providerName = oauthProviderDisplayName(feedback.provider);
    const label = feedback.type === 'bound'
      ? text.profile.boundToast.replace('{provider}', providerName)
      : text.profile.oauthRegistered.replace('{provider}', providerName);

    notifySuccess(label);
    queryClient.invalidateQueries({ queryKey: ['me'] });
    queryClient.invalidateQueries({ queryKey: ['user-oauth-identities'] });
  }, [me.data?.user, queryClient, text]);

  const bootLoading = me.isLoading || (!me.isError && me.data?.installed === false && installStatus.isLoading);

  return (
    <Suspense fallback={<CenteredState key="app-loader">{text.common.loading}</CenteredState>}>
      <AnimatePresence mode="wait" initial={false}>
        {sharedToken ? (
          <PageTransition key="shared-content">
            <SharedMessagePage token={sharedToken} />
          </PageTransition>
        ) : isLegalRoute ? (
          <PageTransition key="legal-content">
            <LegalPage type={legalRoute} />
          </PageTransition>
        ) : bootLoading ? (
          <CenteredState key="loader">{text.loading.starting}</CenteredState>
        ) : (
          <PageTransition key="app-content">
            {!me.isError && me.data?.installed === false ? (
              <InstallPage
                status={installStatus.data}
                onDone={() => {
                  queryClient.invalidateQueries({ queryKey: ['me'] });
                  queryClient.invalidateQueries({ queryKey: ['install-status'] });
                }}
              />
            ) : me.isError || !me.data?.user ? (
              isAuthRoute ? (
                <LoginPage
                  status={installStatus.data}
                  initialMode={authRoute}
                  onDone={() => {
                    queryClient.invalidateQueries({ queryKey: ['me'] });
                    window.location.hash = '#/dashboard';
                  }}
                />
              ) : (
                <LandingPage
                  status={installStatus.data}
                  statsLoading={installStatus.isLoading}
                  onDone={() => queryClient.invalidateQueries({ queryKey: ['me'] })}
                />
              )
            ) : (
              <Console user={me.data.user} />
            )}
          </PageTransition>
        )}
      </AnimatePresence>
    </Suspense>
  );
}

function currentRouteKey() {
  if (typeof window === 'undefined') return '';
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function sharedTokenFromLocation(routeKey: string) {
  if (typeof window === 'undefined') return '';
  const [pathAndSearch, hash = ''] = routeKey.split('#');
  const pathOnly = pathAndSearch.split('?')[0];
  const hashMatch = (`#${hash}`).match(/^#\/share\/([^?]+)/);
  const pathMatch = pathOnly.match(/^\/share\/([^/?]+)/);
  const raw = hashMatch?.[1] || pathMatch?.[1] || '';
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function authRouteFromLocation(routeKey: string): 'login' | 'register' | null {
  if (typeof window === 'undefined') return null;
  const [pathAndSearch, hash = ''] = routeKey.split('#');
  const pathOnly = pathAndSearch.split('?')[0].replace(/\/+$/, '') || '/';
  const hashPath = (`#${hash}`).split('?')[0];
  if (pathOnly === '/login') return 'login';
  if (pathOnly === '/register') return 'register';
  if (hashPath === '#/login') return 'login';
  if (hashPath === '#/register') return 'register';
  return null;
}

type OAuthFeedback = {
  type: 'bound' | 'registered';
  provider: string;
};

function consumeOAuthFeedback(): OAuthFeedback | null {
  if (typeof window === 'undefined') return null;

  const searchFeedback = consumeOAuthParams(new URLSearchParams(window.location.search));
  if (searchFeedback.feedback) {
    const nextSearch = searchFeedback.params.toString();
    window.history.replaceState(
      window.history.state,
      document.title,
      `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`
    );
    return searchFeedback.feedback;
  }

  const hash = window.location.hash;
  const queryStart = hash.indexOf('?');
  if (queryStart < 0) return null;

  const hashPath = hash.slice(0, queryStart) || '#/dashboard';
  const hashQuery = hash.slice(queryStart + 1);
  const hashFeedback = consumeOAuthParams(new URLSearchParams(hashQuery));
  if (!hashFeedback.feedback) return null;

  const nextHashQuery = hashFeedback.params.toString();
  const nextHash = `${hashPath}${nextHashQuery ? `?${nextHashQuery}` : ''}`;
  window.history.replaceState(
    window.history.state,
    document.title,
    `${window.location.pathname}${window.location.search}${nextHash}`
  );
  return hashFeedback.feedback;
}

function consumeOAuthParams(params: URLSearchParams): { feedback: OAuthFeedback | null; params: URLSearchParams } {
  const boundProvider = params.get('oauth_bound');
  const registeredProvider = params.get('oauth_register');
  params.delete('oauth_bound');
  params.delete('oauth_register');

  if (boundProvider) {
    return { feedback: { type: 'bound', provider: boundProvider }, params };
  }
  if (registeredProvider) {
    return { feedback: { type: 'registered', provider: registeredProvider }, params };
  }
  return { feedback: null, params };
}

function oauthProviderDisplayName(provider: string) {
  if (provider === 'github') return 'GitHub';
  if (provider === 'linuxdo') return 'Linux.do';
  return provider;
}

function legalRouteFromLocation(routeKey: string): 'terms' | 'privacy' | null {
  if (typeof window === 'undefined') return null;
  const [pathAndSearch, hash = ''] = routeKey.split('#');
  const pathOnly = pathAndSearch.split('?')[0].replace(/\/+$/, '') || '/';
  const hashPath = (`#${hash}`).split('?')[0];
  if (pathOnly === '/terms' || hashPath === '#/terms') return 'terms';
  if (pathOnly === '/privacy' || hashPath === '#/privacy') return 'privacy';
  return null;
}
