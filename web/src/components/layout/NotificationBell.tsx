import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Bell, CheckCheck } from 'lucide-react';
import { toast } from 'sonner';
import type { AppNotification } from '../../api';
import { api, patchJSON, postJSON } from '../../api';
import { useText } from '../../locales';
import { relativeTime } from '../../lib/display';
import { sseStream } from '../../lib/sse';

type UnreadCount = {
  unread: number;
};

export function NotificationBell() {
  const queryClient = useQueryClient();
  const text = useText();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<AppNotification[]>('/api/notifications?limit=12'),
    refetchInterval: 30000,
    retry: false
  });
  const unread = useQuery({
    queryKey: ['notifications-unread-count'],
    queryFn: () => api<UnreadCount>('/api/notifications/unread-count'),
    refetchInterval: 30000,
    retry: false
  });

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

  const markRead = useMutation({
    mutationFn: (id: number) => patchJSON<AppNotification>(`/api/notifications/${id}/read`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
    }
  });

  const markAllRead = useMutation({
    mutationFn: () => postJSON('/api/notifications/read-all', {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
    }
  });

  const count = unread.data?.unread ?? 0;
  const list = notifications.data || [];
  const title = text.notifications.title;
  const unreadText = count > 0 ? text.notifications.unread.replace('{count}', String(count)) : text.notifications.allClear;

  return (
    <div className="notification-bell" ref={menuRef}>
      <button
        className={`notification-trigger ${open ? 'notification-trigger-active' : ''}`}
        type="button"
        title={title}
        aria-label={title}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((value) => !value)}
      >
        <Bell size={16} />
        {count > 0 && <span className="notification-count">{count > 99 ? '99+' : count}</span>}
      </button>
      {open && (
        <div className="notification-popover">
          <div className="notification-popover-head">
            <div>
              <h2>{title}</h2>
              <p>{unreadText}</p>
            </div>
            <button
              className="notification-mark-all"
              type="button"
              title={text.notifications.markAllRead}
              aria-label={text.notifications.markAllRead}
              onClick={() => markAllRead.mutate()}
              disabled={!count || markAllRead.isPending}
            >
              <CheckCheck size={15} />
            </button>
          </div>
          <div className="notification-list">
            {list.length === 0 && <div className="notification-empty">{text.notifications.empty}</div>}
            {list.map((notification) => (
              <button
                key={notification.id}
                className={`notification-item ${notification.read ? '' : 'notification-item-unread'}`}
                type="button"
                onClick={() => {
                  if (!notification.read) markRead.mutate(notification.id);
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
            ))}
          </div>
        </div>
      )}
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
