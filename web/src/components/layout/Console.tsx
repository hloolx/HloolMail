import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { lazy, Suspense, useEffect } from 'react';
import type { User } from '../../api';
import type { Page } from '../../store';
import { useAppStore } from '../../store';
const Dashboard = lazy(() => import('../../pages/Dashboard').then(m => ({ default: m.Dashboard })));
const InboxPage = lazy(() => import('../../pages/InboxPage').then(m => ({ default: m.InboxPage })));
const ShareLinksPage = lazy(() => import('../../pages/ShareLinksPage').then(m => ({ default: m.ShareLinksPage })));
const DomainManagementPage = lazy(() => import('../../pages/DomainManagementPage').then(m => ({ default: m.DomainManagementPage })));
const APIKeysPage = lazy(() => import('../../pages/APIKeysPage').then(m => ({ default: m.APIKeysPage })));
const WebhooksPage = lazy(() => import('../../pages/WebhooksPage').then(m => ({ default: m.WebhooksPage })));
const APIDocsPage = lazy(() => import('../../pages/APIDocsPage').then(m => ({ default: m.APIDocsPage })));
const UsersPage = lazy(() => import('../../pages/UsersPage').then(m => ({ default: m.UsersPage })));
const AdminPage = lazy(() => import('../../pages/AdminPage').then(m => ({ default: m.AdminPage })));
const LoginSettingsPage = lazy(() => import('../../pages/LoginSettingsPage').then(m => ({ default: m.LoginSettingsPage })));
const AnnouncementsPage = lazy(() => import('../../pages/AnnouncementsPage').then(m => ({ default: m.AnnouncementsPage })));
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export function Console({ user }: { user: User }) {
  const { page, setPage, sidebarCollapsed } = useAppStore();
  const adminPages = new Set<Page>(['admin', 'users', 'admin-oauth', 'announcements']);
  const visiblePage: Page = user.role !== 'admin' && adminPages.has(page) ? 'inbox' : page;
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    if (visiblePage !== page) {
      setPage(visiblePage);
    }
  }, [page, setPage, visiblePage]);

  return (
    <div className={`app-shell min-h-screen bg-[var(--shell)] text-[var(--foreground)] ${sidebarCollapsed ? 'app-shell-collapsed' : ''}`}>
      <Topbar user={user} />
      <Sidebar user={user} />
      <div className="content-shell">
        <main className="main-inset">
          <div className="main-content px-4 py-4 sm:px-6">
            <AnimatePresence mode="wait">
              <Suspense fallback={<div className="page-transition-wrapper" />}>
                <motion.div
                  className="page-transition-wrapper"
                  key={visiblePage}
                  initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
                  transition={shouldReduceMotion ? { duration: 0.08 } : { duration: 0.2, ease: 'easeOut' }}
                >
                {visiblePage === 'dashboard' && <Dashboard user={user} />}
                {visiblePage === 'inbox' && <InboxPage />}
                {visiblePage === 'share-links' && <ShareLinksPage />}
                {visiblePage === 'domain-management' && <DomainManagementPage user={user} />}
                {visiblePage === 'api-keys' && <APIKeysPage user={user} />}
                {visiblePage === 'webhooks' && <WebhooksPage />}
                {visiblePage === 'api-docs' && <APIDocsPage />}
                {visiblePage === 'users' && <UsersPage currentUser={user} />}
                {visiblePage === 'admin-oauth' && <LoginSettingsPage />}
                {visiblePage === 'admin' && <AdminPage />}
                {visiblePage === 'announcements' && <AnnouncementsPage />}
                </motion.div>
              </Suspense>
            </AnimatePresence>
          </div>
        </main>
      </div>
    </div>
  );
}
