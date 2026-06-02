import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { lazy, Suspense, useEffect } from 'react';
import { toast } from 'sonner';
import type { User } from '../../api';
import { useText } from '../../locales';
import type { Page } from '../../store';
import { useAppStore } from '../../store';
import { normalizeNicknameInput } from '../../lib/userDisplay';
import { LoadingState } from '../shared';
import { ErrorBoundary } from '../shared/ErrorBoundary';
const Dashboard = lazy(() => import('../../pages/Dashboard').then(m => ({ default: m.Dashboard })));
const InboxPage = lazy(() => import('../../pages/InboxPage').then(m => ({ default: m.InboxPage })));
const ShareLinksPage = lazy(() => import('../../pages/ShareLinksPage').then(m => ({ default: m.ShareLinksPage })));
const DomainManagementPage = lazy(() => import('../../pages/DomainManagementPage').then(m => ({ default: m.DomainManagementPage })));
const ApiKeysFeature = lazy(() => import('../../features/api-keys').then(m => ({ default: m.ApiKeysFeature })));
const WebhooksFeature = lazy(() => import('../../features/webhooks').then(m => ({ default: m.WebhooksFeature })));
const APIDocsPage = lazy(() => import('../../pages/APIDocsPage').then(m => ({ default: m.APIDocsPage })));
const UsersPage = lazy(() => import('../../pages/UsersPage').then(m => ({ default: m.UsersPage })));
const AdminPage = lazy(() => import('../../pages/AdminPage').then(m => ({ default: m.AdminPage })));
const LoginSettingsPage = lazy(() => import('../../pages/LoginSettingsPage').then(m => ({ default: m.LoginSettingsPage })));
const AnnouncementsPage = lazy(() => import('../../pages/AnnouncementsPage').then(m => ({ default: m.AnnouncementsPage })));
import { AppFrame } from './AppFrame';
import { AppInset } from './AppInset';
import { Main } from './Main';
import { OnboardingGuide } from './OnboardingGuide';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export function Console({ user }: { user: User }) {
  const { page, setPage, sidebarCollapsed, toggleSidebar } = useAppStore();
  const adminPages = new Set<Page>(['admin', 'users', 'admin-oauth', 'announcements']);
  const visiblePage: Page = user.role !== 'admin' && adminPages.has(page) ? 'inbox' : page;
  const shouldReduceMotion = useReducedMotion();
  const text = useText();

  useEffect(() => {
    if (visiblePage !== page) {
      setPage(visiblePage);
    }
  }, [page, setPage, visiblePage]);

  useEffect(() => {
    if (normalizeNicknameInput(user.nickname || '')) return;
    const key = `hlool_nickname_prompt_${user.id}`;
    if (sessionStorage.getItem(key) === '1') return;
    sessionStorage.setItem(key, '1');
    toast.info(text.profile.completeNicknameTitle, {
      description: text.profile.completeNicknameDesc
    });
  }, [text, user.id, user.nickname]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'b' || (!event.metaKey && !event.ctrlKey)) return;
      if (event.altKey || event.shiftKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      ) {
        return;
      }
      if (window.innerWidth < 1024) return;
      event.preventDefault();
      toggleSidebar();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleSidebar]);

  return (
    <AppFrame collapsed={sidebarCollapsed}>
      <Topbar user={user} />
      <Sidebar user={user} />
      <Main>
        <AppInset>
          <AnimatePresence mode="wait" initial={!shouldReduceMotion}>
            <ErrorBoundary variant="inline">
              <Suspense fallback={<div className="page-transition-wrapper"><LoadingState label={text.common.loading} /></div>}>
                <motion.div
                  className="page-transition-wrapper"
                  key={visiblePage}
                  initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
                  transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.2, ease: 'easeOut' }}
                >
                  {visiblePage === 'dashboard' && <Dashboard user={user} />}
                  {visiblePage === 'inbox' && <InboxPage />}
                  {visiblePage === 'share-links' && <ShareLinksPage />}
                  {visiblePage === 'domain-management' && <DomainManagementPage user={user} />}
                  {visiblePage === 'api-keys' && <ApiKeysFeature user={user} />}
                  {visiblePage === 'webhooks' && <WebhooksFeature />}
                  {visiblePage === 'api-docs' && <APIDocsPage />}
                  {visiblePage === 'users' && <UsersPage currentUser={user} />}
                  {visiblePage === 'admin-oauth' && <LoginSettingsPage />}
                  {visiblePage === 'admin' && <AdminPage />}
                  {visiblePage === 'announcements' && <AnnouncementsPage />}
                </motion.div>
              </Suspense>
            </ErrorBoundary>
          </AnimatePresence>
        </AppInset>
      </Main>
      <OnboardingGuide user={user} />
    </AppFrame>
  );
}
