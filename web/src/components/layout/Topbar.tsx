import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleHelp, Github, LogOut, PanelLeftClose, PanelLeftOpen, UserCircle } from 'lucide-react';
import { toast } from 'sonner';
import type { InboxSSEEvent, User, UserOnboardingStatus } from '../../api';
import { api, parseFromAddress, postJSON } from '../../api';
import { roleText, useText } from '../../locales';
import { useAppStore } from '../../store';
import { useShallow } from 'zustand/react/shallow';
import { useBrowserNotification } from '../../hooks/useBrowserNotification';
import { useVisibilityChange } from '../../hooks/useVisibilityChange';
import { MOBILE_NAVIGATION_QUERY, isMobileNavigationViewport } from '../../lib/navigationBreakpoint';
import { clearUserSession } from '../../lib/queryClient';
import { sseStream } from '../../lib/sse';
import { displayName, displaySubtitle } from '../../lib/userDisplay';
import { AppLogo } from '../shared/AppLogo';
import { UserAvatar } from '../shared';
import { HeaderSettings } from './HeaderSettings';
import { NotificationBell } from './NotificationBell';
import { UserProfileDialog } from '../../pages/UserProfileDialog';

type TopbarProps = {
  user: User;
  onReplayTutorial?: () => void;
};

export function Topbar({ user, onReplayTutorial }: TopbarProps) {
  const { toggleSidebar, toggleMobileSidebar, closeMobileSidebar, addMailNotification, resetAwayCounts } = useAppStore(
    useShallow((s) => ({
      toggleSidebar: s.toggleSidebar,
      toggleMobileSidebar: s.toggleMobileSidebar,
      closeMobileSidebar: s.closeMobileSidebar,
      addMailNotification: s.addMailNotification,
      resetAwayCounts: s.resetAwayCounts
    }))
  );
  const page = useAppStore((s) => s.page);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const mobileSidebarOpen = useAppStore((s) => s.mobileSidebarOpen);
  const email = useAppStore((s) => s.email);
  const awayMailCount = useAppStore((s) => s.awayMailCount);
  const awayAnnouncementCount = useAppStore((s) => s.awayAnnouncementCount);
  const queryClient = useQueryClient();
  const text = useText();
  const [isMobileNavigation, setIsMobileNavigation] = useState(isMobileNavigationViewport);
  const [accountOpen, setAccountOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const navigationClosed = isMobileNavigation ? !mobileSidebarOpen : sidebarCollapsed;
  const sidebarTitle = navigationClosed ? text.nav.expandSidebar : text.nav.collapseSidebar;
  const userName = displayName(user);
  const userSubtitle = displaySubtitle(user) || roleText(user.role, text);
  const accountTitle = `${userName} · ${roleText(user.role, text)}`;
  const toggleNavigation = () => {
    if (isMobileNavigation) {
      toggleMobileSidebar();
      return;
    }
    toggleSidebar();
  };
  const { notify } = useBrowserNotification();
  const awayMailRef = useRef(awayMailCount);
  const awayAnnRef = useRef(awayAnnouncementCount);
  awayMailRef.current = awayMailCount;
  awayAnnRef.current = awayAnnouncementCount;

  const onboarding = useQuery({
    queryKey: ['user-onboarding', user.id],
    queryFn: () => api<UserOnboardingStatus>('/api/user/onboarding'),
    enabled: user.role === 'user',
    retry: false,
    staleTime: 30_000
  });
  const showTutorialReplay = Boolean(onReplayTutorial && user.role === 'user' && onboarding.data?.enabled);
  const logout = useMutation({
    mutationFn: () => postJSON('/api/auth/logout', {}),
    onSuccess: () => {
      clearUserSession(queryClient);
      if (window.location.hash) window.location.hash = '';
    }
  });

  useEffect(() => {
    const media = window.matchMedia(MOBILE_NAVIGATION_QUERY);
    const syncNavigationMode = () => {
      const matches = media.matches;
      setIsMobileNavigation(matches);
      if (!matches) closeMobileSidebar();
    };
    syncNavigationMode();
    media.addEventListener('change', syncNavigationMode);
    return () => media.removeEventListener('change', syncNavigationMode);
  }, [closeMobileSidebar]);

  useEffect(() => {
    if (!accountOpen) return undefined;
    const close = (event: PointerEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node)) setAccountOpen(false);
    };
    const closeByKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAccountOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', closeByKey);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', closeByKey);
    };
  }, [accountOpen]);

  // When user returns to the tab, show summary and refetch
  useVisibilityChange(() => {
    const mail = awayMailRef.current;
    const announcements = awayAnnRef.current;
    if (mail > 0 || announcements > 0) {
      toast.info(
        text.announcements.sinceYouWereAway
          .replace('{mail}', String(mail))
          .replace('{announcements}', String(announcements)),
        { duration: 5000 }
      );
    }
    resetAwayCounts();
    // Refetch all unread counts
    queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
    queryClient.invalidateQueries({ queryKey: ['announcements-unread-count'] });
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
    queryClient.invalidateQueries({ queryKey: ['announcements'] });
  });

  // Keep one inbox stream active: InboxPage owns it on the inbox route, Topbar only covers other console pages.
  useEffect(() => {
    if (!email || page === 'inbox') return undefined;
    const controller = new AbortController();
    const url = new URL('/api/inbox-stream', window.location.origin);
    url.searchParams.set('email', email);
    void (async () => {
      try {
        for await (const event of sseStream<InboxSSEEvent>(url.toString(), { signal: controller.signal })) {
          const parsed = parseFromAddress(event.from);
          addMailNotification({
            id: event.id,
            from_address: parsed.from_address,
            from_name: parsed.from_name,
            subject: event.subject,
            mailbox_email: event.recipient,
            created_at: event.created_at
          });
          queryClient.invalidateQueries({ queryKey: ['emails'] });
          queryClient.invalidateQueries({ queryKey: ['mailboxes'] });
          queryClient.invalidateQueries({ queryKey: ['mailbox-stats'] });
          notify(
            `${text.notifications.newMail}: ${parsed.from_name || parsed.from_address}`,
            {
              body: event.subject || text.common.noSubject,
              tag: `mail-${event.id}`,
              onClick: () => {
                const store = useAppStore.getState();
                store.setPage('inbox');
              }
            }
          );
        }
      } catch {
        // Opportunistic stream; InboxPage owns the active mailbox stream when it is mounted.
      }
    })();
    return () => controller.abort();
  }, [email, page, addMailNotification, notify, queryClient, text]);

  return (
    <header className="topbar">
      <div className="app-header-inner">
        <div className="app-header-left">
          <button className="app-header-trigger" title={sidebarTitle} aria-label={sidebarTitle} onClick={toggleNavigation}>
            {navigationClosed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
          <div className="app-header-brand" aria-label="HLOOL Mail">
            <span className="app-header-brand-mark">
              <AppLogo />
            </span>
            <span className="app-header-brand-name">HLOOL Mail</span>
          </div>
        </div>

        <div className="app-header-main">
          <a className="app-header-github" href="https://github.com/hloolx/HloolMail" target="_blank" rel="noopener noreferrer" aria-label="GitHub">
            <Github size={17} />
          </a>
          <NotificationBell />
          {showTutorialReplay && (
            <button className="app-header-tutorial" type="button" title={text.onboarding.replay} aria-label={text.onboarding.replay} onClick={onReplayTutorial}>
              <CircleHelp size={16} />
            </button>
          )}
          <HeaderSettings user={user} />
          <div className="header-account" ref={accountMenuRef}>
            <button
              className={`header-account-btn ${accountOpen ? 'header-account-btn-active' : ''}`}
              type="button"
              title={accountTitle}
              aria-label={text.profile.open}
              aria-haspopup="menu"
              aria-expanded={accountOpen}
              onClick={() => setAccountOpen((value) => !value)}
            >
              <UserAvatar user={user} className="header-account-avatar" />
            </button>
            {accountOpen && (
              <div className="header-account-popover" role="menu" aria-label={accountTitle}>
                <button
                  className="header-account-card"
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setProfileOpen(true);
                    setAccountOpen(false);
                  }}
                >
                  <UserAvatar user={user} className="header-account-card-avatar" />
                  <span className="header-account-copy">
                    <strong>{userName}</strong>
                    <small>{userSubtitle}</small>
                  </span>
                </button>
                <button
                  className="header-account-menu-item"
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setProfileOpen(true);
                    setAccountOpen(false);
                  }}
                >
                  <UserCircle size={15} />
                  <span>{text.profile.open}</span>
                </button>
                <button
                  className="header-account-menu-item header-account-logout"
                  type="button"
                  role="menuitem"
                  disabled={logout.isPending}
                  onClick={() => logout.mutate()}
                >
                  <LogOut size={15} />
                  <span>{text.settings.logout}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      <UserProfileDialog open={profileOpen} onClose={() => setProfileOpen(false)} user={user} />
    </header>
  );
}
