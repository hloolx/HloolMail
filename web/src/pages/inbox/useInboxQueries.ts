import { useQuery } from '@tanstack/react-query';
import type { DomainAvailability, MailboxInfo, MailboxStats, MessageDetail, MessageSummary, PaginatedResponse } from '../../api';
import { api } from '../../api';
import { useVisibleRefetchInterval } from '../../hooks/useVisibleRefetchInterval';
import { EMAIL_PAGE_SIZE, MAILBOX_PAGE_SIZE } from './utils';

type InboxQueriesOptions = {
  apiKey: string;
  email: string;
  mailboxQuery: string;
  mailboxPage: number;
  emailPage: number;
  selectedID: string;
};

export function useInboxQueries({
  apiKey,
  email,
  mailboxQuery,
  mailboxPage,
  emailPage,
  selectedID
}: InboxQueriesOptions) {
  const mailboxesInterval = useVisibleRefetchInterval(30000);
  const emailsInterval = useVisibleRefetchInterval(30000);

  const domains = useQuery({
    queryKey: ['domains-available', apiKey],
    queryFn: () => api<DomainAvailability>('/api/domains/available', { apiKey }),
    staleTime: 10_000
  });

  const mailboxes = useQuery({
    queryKey: ['mailboxes', apiKey, mailboxQuery, mailboxPage],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(mailboxPage),
        per_page: String(MAILBOX_PAGE_SIZE)
      });
      if (mailboxQuery) params.set('q', mailboxQuery);
      return api<PaginatedResponse<MailboxInfo>>(`/api/mailboxes?${params.toString()}`, { apiKey });
    },
    staleTime: 10_000,
    refetchInterval: mailboxesInterval
  });

  const mailboxStats = useQuery({
    queryKey: ['mailbox-stats', apiKey],
    queryFn: () => api<MailboxStats>('/api/mailboxes/stats', { apiKey }),
    staleTime: 15_000,
    refetchInterval: mailboxesInterval
  });

  const emails = useQuery({
    queryKey: ['emails', email, emailPage, apiKey],
    queryFn: () => {
      const params = new URLSearchParams({
        email,
        page: String(emailPage),
        per_page: String(EMAIL_PAGE_SIZE)
      });
      return api<PaginatedResponse<MessageSummary>>(`/api/emails?${params.toString()}`, { apiKey });
    },
    enabled: Boolean(email),
    staleTime: 10_000,
    refetchInterval: emailsInterval
  });

  const detail = useQuery({
    queryKey: ['email-detail', selectedID, apiKey],
    queryFn: () => api<MessageDetail>(`/api/email/${selectedID}`, { apiKey }),
    enabled: Boolean(selectedID)
  });

  const mailboxItems = mailboxes.data?.items || [];
  const emailItems = emails.data?.items || [];

  return {
    domains,
    mailboxes,
    mailboxStats,
    emails,
    detail,
    mailboxItems,
    emailItems,
    mailboxTotal: mailboxes.data?.total ?? mailboxItems.length,
    emailTotal: emails.data?.total ?? emailItems.length
  };
}
