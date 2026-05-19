import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Bell, CheckCheck, Mail, Megaphone, Trash2, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import type { AppNotification, Announcement } from '../../api';
import { api, patchJSON, postJSON } from '../../api';
import { useText } from '../../locales';
import { relativeTime } from '../../lib/display';
import { sseStream } from '../../lib/sse';
import { useAppStore } from '../../store';
import { markdownToText, simpleMarkdownToHTML } from '../../lib/markdown';

type UnreadCount = {
  unread: number;
};

export function NotificationBell() {
  const queryClient = useQueryClient();
  const text = useText();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const {
    mailNotifications,
    clearMailNotifications,
    setPage
  } = useAppStore();

  // System notifications (existing)
  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<AppNotification[]>('/api/notifications?limit=8'),
    refetchInterval: 30000,
    retry: false
  });

  const unread = useQuery({
    queryKey: ['notifications-unread-count'],
    queryFn: () => api<UnreadCount>('/api/notifications/unread-count'),
    refetchInterval: 30000,
    retry: false
  });

  // Announcements
  const announcements = useQuery({
    queryKey: ['announcements'],
    queryFn: () => api<Announcement[]>('/api/announcements?limit=5'),
    refetchInterval: 30000,
    retry: false
  });

  const announcementUnread = useQuery({
    queryKey: ['announcements-unread-count'],
    queryFn: () => api<UnreadCount>('/api/announcements/unread-count'),
    refetchInterval: 30000,
    retry: false
  });

  // SSE for system notifications
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        for await (const notification of sseStream<AppNotification>('/api/notification-stream', { signal: controller.signal })) {
          queryClient.invalidateQueries({ queryKey: ['notifications'] });
          queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
          if (notification.message) toast.warning(notification.message);
        }
      } catch {
        // The stream is opportunistic; polling keeps the bell fresh if it drops.
      }
    })();
    return () => controller.abort();
  }, [queryClient]);

  // SSE for announcements
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        for await (const _announcement of sseStream<Announcement>('/api/announcement-stream', { signal: controller.signal })) {
          queryClient.invalidateQueries({ queryKey: ['announcements'] });
          queryClient.invalidateQueries({ queryKey: ['announcements-unread-count'] });
        }
      } catch {
        // Opportunistic stream
      }
    })();
    return () => controller.abort();
  }, [queryClient]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeByKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', closeByKey);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', closeByKey);
    };
  }, [open]);

  const markNotifRead = useMutation({
    mutationFn: (id: number) => patchJSON<AppNotification>(`/api/notifications/${id}/read`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
    }
  });

  const markAllNotifsRead = useMutation({
    mutationFn: () => postJSON('/api/notifications/read-all', {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
    }
  });

  const markAnnouncementRead = useMutation({
    mutationFn: (id: number) => patchJSON<Announcement>(`/api/announcements/${id}/read`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['announcements'] });
      queryClient.invalidateQueries({ queryKey: ['announcements-unread-count'] });
    }
  });

  const [expandedAnnouncementId, setExpandedAnnouncementId] = useState<number | null>(null);

  const sysCount = unread.data?.unread ?? 0;
  const annCount = announcementUnread.data?.unread ?? 0;
  const mailCount = mailNotifications.length;
  const totalCount = mailCount + annCount + sysCount;

  const sysList = notifications.data || [];
  const annList = announcements.data || [];

  const headline = totalCount > 0
    ? text.notifications.unread.replace('{count}', String(totalCount))
    : text.announcements.allCaughtUp;

  const popoverTitle = totalCount > 0
    ? `${text.notifications.title} (${totalCount > 99 ? '99+' : totalCount})`
    : text.notifications.title;

  return (
    <div className="notification-bell" ref={menuRef}>
      <button
        className={`notification-trigger ${open ? 'notification-trigger-active' : ''}`}
        type="button"
        title={popoverTitle}
        aria-label={popoverTitle}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((value) => !value)}
      >
        <Bell size={16} />
        {totalCount > 0 && <span className="notification-count">{totalCount > 99 ? '99+' : totalCount}</span>}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="notification-popover message-center-popover"
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            {/* Header */}
            <div className="notification-popover-head">
              <div>
                <h2>{text.notifications.title}</h2>
                <p>{headline}</p>
              </div>
              {totalCount > 0 && (
                <button
                  className="notification-mark-all"
                  type="button"
                  title={text.notifications.markAllRead}
                  aria-label={text.notifications.markAllRead}
                  onClick={() => {
                    markAllNotifsRead.mutate();
                  }}
                  disabled={!sysCount || markAllNotifsRead.isPending}
                >
                  <CheckCheck size={15} />
                </button>
              )}
            </div>

            <div className="message-center-sections">
              {/* Section 1: New Mail */}
              <MessageCenterSection
                icon={Mail}
                iconClass="message-center-icon-mail"
                label={text.notifications.newMail}
                count={mailCount}
                onClear={mailCount > 0 ? () => clearMailNotifications() : undefined}
                clearTitle={text.notifications.clearMailNotifications}
              >
                {mailNotifications.length === 0 ? (
                  <div className="notification-empty">{text.notifications.noMailNotifications}</div>
                ) : (
                  mailNotifications.slice(0, 8).map((mail) => (
                    <button
                      key={mail.id}
                      className="notification-item message-center-mail-item"
                      type="button"
                      onClick={() => {
                        // Navigate to inbox with the correct mailbox selected
                        const mailbox = mail.mailbox_email;
                        const store = useAppStore.getState();
                        if (store.email !== mailbox) {
                          store.setEmail(mailbox);
                        }
                        setPage('inbox');
                        setOpen(false);
                      }}
                    >
                      <span className="notification-icon message-center-icon-mail">
                        <Mail size={14} />
                      </span>
                      <span className="notification-copy">
                        <b>{mail.from_name || mail.from_address}</b>
                        <span>{mail.subject || text.common.noSubject}</span>
                        <small>{relativeTime(mail.created_at)}</small>
                      </span>
                    </button>
                  ))
                )}
              </MessageCenterSection>

              {/* Section 2: Announcements */}
              <MessageCenterSection
                icon={Megaphone}
                iconClass="message-center-icon-announcement"
                label={text.announcements.title}
                count={annCount}
              >
                {annList.length === 0 ? (
                  <div className="notification-empty">{text.announcements.noAnnouncements}</div>
                ) : (
                  annList.slice(0, 5).map((ann) => (
                    <div key={ann.id} className="message-center-announcement-wrapper">
                      <button
                        className={`notification-item message-center-announcement-item ${ann.read ? '' : 'notification-item-unread'}`}
                        type="button"
                        onClick={() => {
                          if (!ann.read) markAnnouncementRead.mutate(ann.id);
                          setExpandedAnnouncementId(
                            expandedAnnouncementId === ann.id ? null : ann.id
                          );
                        }}
                      >
                        <span className="notification-icon message-center-icon-announcement">
                          <Megaphone size={14} />
                        </span>
                        <span className="notification-copy">
                          <b>{ann.title}</b>
                          <span>{markdownToText(ann.content).slice(0, 100)}{ann.content.length > 100 ? '...' : ''}</span>
                          <small>{relativeTime(ann.created_at)}</small>
                        </span>
                      </button>
                      <AnimatePresence>
                        {expandedAnnouncementId === ann.id && (
                          <motion.div
                            className="message-center-announcement-body"
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                          >
                            <div
                              className="message-center-markdown"
                              dangerouslySetInnerHTML={{ __html: simpleMarkdownToHTML(ann.content) }}
                            />
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  ))
                )}
              </MessageCenterSection>

              {/* Section 3: System Alerts */}
              <MessageCenterSection
                icon={AlertTriangle}
                iconClass="message-center-icon-system"
                label={text.notifications.systemAlerts}
                count={sysCount}
              >
                {sysList.length === 0 ? (
                  <div className="notification-empty">{text.notifications.empty}</div>
                ) : (
                  sysList.map((notification) => (
                    <button
                      key={notification.id}
                      className={`notification-item ${notification.read ? '' : 'notification-item-unread'}`}
                      type="button"
                      onClick={() => {
                        if (!notification.read) markNotifRead.mutate(notification.id);
                      }}
                    >
                      <span className={`notification-icon notification-icon-${notificationSeverity(notification.type)}`}>
                        <AlertTriangle size={15} />
                      </span>
                      <span className="notification-copy">
                        <b>{notificationLabel(notification.type, text)}</b>
                        <span>{notification.message}</span>
                        <small>{relativeTime(notification.created_at)}</small>
                      </span>
                    </button>
                  ))
                )}
              </MessageCenterSection>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MessageCenterSection({
  icon: Icon,
  iconClass,
  label,
  count,
  onClear,
  clearTitle,
  children
}: {
  icon: typeof Mail;
  iconClass: string;
  label: string;
  count: number;
  onClear?: () => void;
  clearTitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="message-center-section">
      <div className="message-center-section-head">
        <span className={iconClass}>
          <Icon size={13} />
          <span>{label}</span>
          {count > 0 && <span className="message-center-section-badge">{count > 99 ? '99+' : count}</span>}
        </span>
        {onClear && (
          <button
            className="message-center-section-clear"
            type="button"
            title={clearTitle}
            onClick={onClear}
          >
            <X size={12} />
          </button>
        )}
      </div>
      <div className="notification-list">
        {children}
      </div>
    </div>
  );
}

function notificationLabel(type: string, text: ReturnType<typeof useText>) {
  switch (type) {
    case 'MX_FAILED':
      return text.notifications.types.mxFailed;
    case 'MX_RECOVERED':
      return text.notifications.types.mxRecovered;
    case 'DOMAIN_EXPIRING':
      return text.notifications.types.domainExpiring;
    case 'DOMAIN_EXPIRED':
      return text.notifications.types.domainExpired;
    default:
      return type.replaceAll('_', ' ').toLowerCase();
  }
}

function notificationSeverity(type: string) {
  if (type === 'MX_RECOVERED') return 'ok';
  if (type === 'DOMAIN_EXPIRING') return 'warning';
  return 'critical';
}
