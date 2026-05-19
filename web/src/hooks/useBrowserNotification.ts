import { useCallback, useEffect, useRef, useState } from 'react';

type NotificationPermissionState = NotificationPermission | 'unsupported';

export function useBrowserNotification() {
  const [permission, setPermission] = useState<NotificationPermissionState>(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
    return Notification.permission;
  });
  const onClickRef = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission === 'default') {
      Notification.requestPermission().then((result) => {
        setPermission(result);
      }).catch(() => {
        // Permission request denied or dismissed
      });
    }
  }, []);

  const notify = useCallback(
    (title: string, options?: NotificationOptions & { onClick?: () => void }) => {
      if (typeof window === 'undefined' || !('Notification' in window)) return;
      if (Notification.permission !== 'granted') return;
      if (!document.hidden) return;

      const { onClick, ...restOptions } = options || {};
      onClickRef.current = onClick;

      const instance = new Notification(title, {
        icon: restOptions.icon,
        body: restOptions.body,
        tag: restOptions.tag,
        ...restOptions
      });

      instance.onclick = () => {
        window.focus();
        onClickRef.current?.();
        instance.close();
      };

      // Auto-close after 8 seconds
      setTimeout(() => instance.close(), 8000);
    },
    []
  );

  return { notify, permission };
}
