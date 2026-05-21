import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { InboxSSEEvent } from '../../api';
import { parseFromAddress } from '../../api';
import { useBrowserNotification } from '../../hooks/useBrowserNotification';
import { useText } from '../../locales';
import { useAppStore } from '../../store';
import { sseStream } from '../../lib/sse';

type ActiveMailboxStreamOptions = {
  email: string;
  onMessage: () => void;
};

export function useActiveMailboxStream({ email, onMessage }: ActiveMailboxStreamOptions) {
  const queryClient = useQueryClient();
  const text = useText();
  const addMailNotification = useAppStore((state) => state.addMailNotification);
  const setPage = useAppStore((state) => state.setPage);
  const { notify } = useBrowserNotification();
  const [sseGen, setSseGen] = useState(0);
  const sseErrorCooldownRef = useRef(0);
  const onMessageRef = useRef(onMessage);
  const labelsRef = useRef({
    toastNewMail: text.toast.newMail,
    notificationTitle: text.notifications.newMail,
    noSubject: text.common.noSubject
  });

  onMessageRef.current = onMessage;
  labelsRef.current = {
    toastNewMail: text.toast.newMail,
    notificationTitle: text.notifications.newMail,
    noSubject: text.common.noSubject
  };

  useEffect(() => {
    if (!email) return undefined;
    const controller = new AbortController();
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    const url = new URL('/api/inbox-stream', window.location.origin);
    url.searchParams.set('email', email);
    void (async () => {
      try {
        for await (const event of sseStream<InboxSSEEvent>(url.toString(), { signal: controller.signal })) {
          onMessageRef.current();
          queryClient.invalidateQueries({ queryKey: ['emails'] });
          queryClient.invalidateQueries({ queryKey: ['mailboxes'] });
          toast.info(labelsRef.current.toastNewMail);
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
            `${labelsRef.current.notificationTitle}: ${parsed.from_name || parsed.from_address}`,
            {
              body: event.subject || labelsRef.current.noSubject,
              tag: `mail-${event.id}`,
              onClick: () => setPage('inbox')
            }
          );
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        const now = Date.now();
        const elapsed = now - sseErrorCooldownRef.current;
        if (elapsed >= 30000) {
          sseErrorCooldownRef.current = now;
          toast.error(error instanceof Error ? error.message : String(error));
        }
        const cooldownDelay = elapsed >= 30000 ? 5000 : Math.max(5000, 30000 - elapsed);
        reconnectTimer = setTimeout(() => setSseGen((g) => g + 1), cooldownDelay);
      }
    })();
    return () => {
      controller.abort();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [email, queryClient, addMailNotification, notify, setPage, sseGen]);
}
