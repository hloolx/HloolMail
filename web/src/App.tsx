import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from './api';
import type { InstallStatus } from './api';
import type { MeResponse } from './types';
import { useText } from './locales';
import { useAppStore } from './store';
import { CenteredState, ErrorBoundary } from './components/shared';
import { Console } from './components/layout/Console';
import { InstallPage } from './pages/InstallPage';
import { LandingPage } from './pages/LandingPage';
import { launchSuccessBurst } from './lib/confetti';

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

function AppContent() {
  const queryClient = useQueryClient();
  const { theme, language } = useAppStore();
  const text = useText();
  const installStatus = useQuery({
    queryKey: ['install-status'],
    queryFn: () => api<InstallStatus>('/api/install/status'),
    retry: false
  });
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api<MeResponse>('/api/auth/me'),
    enabled: Boolean(installStatus.data?.installed),
    retry: false
  });
  const skipInstall = typeof window !== 'undefined' && sessionStorage.getItem('hlool_skip_install') === '1';

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

    toast.success(label);
    launchSuccessBurst({ label });
    queryClient.invalidateQueries({ queryKey: ['me'] });
    queryClient.invalidateQueries({ queryKey: ['user-oauth-identities'] });
  }, [me.data?.user, queryClient, text]);

  if (installStatus.isLoading) {
    return <CenteredState>{text.loading.checkingInstall}</CenteredState>;
  }

  if (!installStatus.data?.installed) {
    return <InstallPage status={installStatus.data} onDone={() => queryClient.invalidateQueries({ queryKey: ['install-status'] })} />;
  }

  if (me.isLoading) {
    return <CenteredState>{text.loading.restoringLogin}</CenteredState>;
  }

  if (me.isError || !me.data?.user) {
    return <LandingPage status={installStatus.data} onDone={() => queryClient.invalidateQueries({ queryKey: ['me'] })} />;
  }

  return <Console user={me.data.user} />;
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
