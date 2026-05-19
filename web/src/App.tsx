import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { InstallStatus } from './api';
import type { MeResponse } from './types';
import { useText } from './locales';
import { useAppStore } from './store';
import { CenteredState, ErrorBoundary } from './components/shared';
import { Console } from './components/layout/Console';
import { InstallPage } from './pages/InstallPage';
import { LandingPage } from './pages/LandingPage';

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

  if (installStatus.isLoading) {
    return <CenteredState>{text.loading.checkingInstall}</CenteredState>;
  }

  const skipInstall = typeof window !== 'undefined' && sessionStorage.getItem('hlool_skip_install') === '1';

  if (!installStatus.data?.installed && !skipInstall) {
    return <InstallPage status={installStatus.data} onDone={() => queryClient.invalidateQueries({ queryKey: ['install-status'] })} />;
  }

  if (!installStatus.data?.installed && skipInstall) {
    return <Console user={{ id: 0, email: 'dev@localhost', role: 'admin', enabled: true, daily_limit: 0, total_limit: 0, used_today: 0, total_used: 0, created_at: '' }} />;
  }

  if (me.isLoading) {
    return <CenteredState>{text.loading.restoringLogin}</CenteredState>;
  }

  if (me.isError || !me.data?.user) {
    return <LandingPage status={installStatus.data} onDone={() => queryClient.invalidateQueries({ queryKey: ['me'] })} />;
  }

  return <Console user={me.data.user} />;
}
