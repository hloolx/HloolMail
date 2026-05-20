import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Github, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { toast } from 'sonner';
import type { InboxSSEEvent, User } from '../../api';
import { parseFromAddress } from '../../api';
import { useText } from '../../locales';
import { useAppStore } from '../../store';
import { useBrowserNotification } from '../../hooks/useBrowserNotification';
import { useVisibilityChange } from '../../hooks/useVisibilityChange';
import { sseStream } from '../../lib/sse';
import { AppLogo } from '../shared/AppLogo';
import { HeaderSettings } from './HeaderSettings';
import { NotificationBell } from './NotificationBell';

export function Topbar({ user }: { user: User }) {
  const { page, sidebarCollapsed, toggleSidebar, email, addMailNotification, awayMailCount, awayAnnouncementCount, resetAwayCounts } = useAppStore();
  const queryClient = useQueryClient();
  const text = useText();
  const sidebarTitle = sidebarCollapsed ? text.nav.expandSidebar : text.nav.collapseSidebar;
  const { notify } = useBrowserNotification();
  const awayMailRef = useRef(awayMailCount);
  const awayAnnRef = useRef(awayAnnouncementCount);
  awayMailRef.current = awayMailCount;
  awayAnnRef.current = awayAnnouncementCount;

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
  }, [email, page, addMailNotification, notify, text]);

  return (
    <header className="topbar">
      <div className="app-header-inner">
        <div className="app-header-left">
          <button className="app-header-trigger" title={sidebarTitle} aria-label={sidebarTitle} onClick={toggleSidebar}>
            {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
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
          <HeaderSettings user={user} />
        </div>
      </div>
    </header>
  );
}
