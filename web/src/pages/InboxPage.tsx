import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useReducedMotion } from 'framer-motion';
import { Check, Copy, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import type { MailboxInfo, ShareLinkDTO } from '../api';
import { api, postJSON } from '../api';
import { useText } from '../locales';
import { useAppStore } from '../store';
import { useCopyState } from '../hooks/useCopyState';
import { copy } from '../lib/clipboard';
import { notifySuccess, runDeleteContainerEffect, runDeleteEffect } from '../lib/feedback';
import { IconButton } from '../components/shared';
import { InboxActions } from './inbox/InboxActions';
import { InboxComposer } from './inbox/InboxComposer';
import { MailboxList } from './inbox/MailboxList';
import { MailboxStatsBar } from './inbox/MailboxStatsBar';
import { MessageList } from './inbox/MessageList';
import { MessagePreviewPane } from './inbox/MessagePreviewPane';
import { useActiveMailboxStream } from './inbox/useActiveMailboxStream';
import { useInboxQueries } from './inbox/useInboxQueries';
import { useMailboxGeneration } from './inbox/useMailboxGeneration';
import { useMailboxSelection } from './inbox/useMailboxSelection';
import { domainAvailabilityGroups } from './inbox/utils';
import { OneTimeLinkCard } from './ShareLinksPage';

export function InboxPage() {
  const queryClient = useQueryClient();
  const { email, setEmail, apiKey, language } = useAppStore();
  const shouldReduceMotion = useReducedMotion();
  const text = useText();
  const mailListRef = useRef<HTMLDivElement>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [emailCopied, markEmailCopied] = useCopyState();
  const [mailboxShareLink, setMailboxShareLink] = useState<ShareLinkDTO | null>(null);
  const [mobileStep, setMobileStep] = useState<'mailboxes' | 'messages' | 'detail'>('mailboxes');

  const selection = useMailboxSelection({ email });
  const {
    mailboxSearch,
    mailboxQuery,
    mailboxPage,
    emailPage,
    selectedID,
    pulseIds,
    confirmingId,
    setMailboxSearch,
    setMailboxPage,
    setEmailPage,
    setSelectedID,
    setConfirmingId,
    resetAfterGenerate,
    trackMessageItems
  } = selection;
  const generation = useMailboxGeneration({
    apiKey,
    onGenerated: resetAfterGenerate
  });
  const inbox = useInboxQueries({
    apiKey,
    email,
    mailboxQuery,
    mailboxPage,
    emailPage,
    selectedID
  });
  const availabilityGroups = useMemo(
    () => domainAvailabilityGroups(inbox.domains.data),
    [inbox.domains.data]
  );
  const activeMailbox = useMemo(
    () => inbox.mailboxItems.find((mailbox) => mailbox.email === email),
    [email, inbox.mailboxItems]
  );

  const clear = useMutation({
    mutationFn: () => api(`/api/emails/clear?email=${encodeURIComponent(email)}`, { method: 'DELETE', apiKey }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emails'] });
      queryClient.invalidateQueries({ queryKey: ['mailboxes'] });
      queryClient.invalidateQueries({ queryKey: ['mailbox-stats'] });
      setSelectedID('');
      setEmailPage(1);
      notifySuccess(text.toast.inboxCleared, { burst: false });
    },
    onError: (error) => toast.error(error.message)
  });

  const deleteMailbox = useMutation({
    mutationFn: (mailbox: MailboxInfo) => api(`/api/mailboxes/${mailbox.id}`, { method: 'DELETE', apiKey }),
    onSuccess: (_data, mailbox) => {
      queryClient.invalidateQueries({ queryKey: ['mailboxes'] });
      queryClient.invalidateQueries({ queryKey: ['mailbox-stats'] });
      if (mailbox.email === email) {
        setEmail('');
        setSelectedID('');
      }
      if (inbox.mailboxItems.length <= 1 && mailboxPage > 1) {
        setMailboxPage((page) => Math.max(1, page - 1));
      }
      notifySuccess(text.inbox.mailboxDeleted, { burst: false });
    },
    onError: (error) => toast.error(error.message)
  });
  const shareMailbox = useMutation({
    mutationFn: (mailbox: MailboxInfo) => postJSON<ShareLinkDTO>('/api/share-links', {
      resource_type: 'mailbox',
      mailbox_id: mailbox.id
    }),
    onSuccess: (link) => {
      setMailboxShareLink(link);
      queryClient.invalidateQueries({ queryKey: ['share-links'] });
      toast.success(text.shareLinks.mailboxCreatedFromInbox);
    },
    onError: (error) => toast.error(error.message)
  });

  useActiveMailboxStream({
    email,
    onMessage: () => setEmailPage(1)
  });

  useEffect(() => {
    if (inbox.mailboxes.data && inbox.mailboxes.data.page !== mailboxPage) {
      setMailboxPage(inbox.mailboxes.data.page);
    }
  }, [inbox.mailboxes.data, mailboxPage, setMailboxPage]);

  useEffect(() => {
    if (inbox.emails.data && inbox.emails.data.page !== emailPage) {
      setEmailPage(inbox.emails.data.page);
    }
  }, [inbox.emails.data, emailPage, setEmailPage]);

  useEffect(() => {
    return trackMessageItems(inbox.emails.data?.items);
  }, [inbox.emails.data, trackMessageItems]);

  useEffect(() => {
    setMailboxShareLink(null);
  }, [email]);

  const handleClear = async () => {
    if (confirmClear) {
      if (mailListRef.current && inbox.emailItems.length > 0) {
        await runDeleteContainerEffect(mailListRef.current, { duration: 700, blockSize: 6 });
      }
      clear.mutate();
      setConfirmClear(false);
    } else {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 3000);
    }
  };

  const handleDeleteMailbox = (mailbox: MailboxInfo, row: HTMLElement | null) => {
    deleteMailbox.mutate(mailbox, {
      onSuccess: async () => {
        await runDeleteEffect(row);
      }
    });
  };

  const selectMailbox = (mailboxEmail: string) => {
    setEmail(mailboxEmail);
    setSelectedID('');
    setMobileStep('messages');
  };

  const selectMessage = (id: string) => {
    const nextID = selectedID === id ? '' : id;
    setSelectedID(nextID);
    if (nextID) setMobileStep('detail');
  };

  return (
    <div className="inbox-layout">
      <section className={`panel inbox-column inbox-mailbox-column ${mobileStep !== 'mailboxes' ? 'inbox-drilldown-hidden' : ''}`}>
        <div className="panel-header inbox-column-header">
          <div>
            <h2>{text.page.inbox}</h2>
            <p>{email || text.inbox.noEmail}</p>
          </div>
        </div>

        <InboxComposer
          text={text}
          language={language}
          prefix={generation.prefix}
          domainName={generation.domainName}
          availabilityGroups={availabilityGroups}
          isGenerating={generation.generate.isPending}
          generateButtonRef={generation.generateButtonRef}
          onPrefixChange={generation.setPrefix}
          onDomainChange={generation.setDomainName}
          onGenerate={() => generation.generate.mutate()}
        />

        <MailboxStatsBar text={text} stats={inbox.mailboxStats.data} />

        <MailboxList
          text={text}
          items={inbox.mailboxItems}
          selectedEmail={email}
          search={mailboxSearch}
          total={inbox.mailboxTotal}
          page={inbox.mailboxes.data?.page || 1}
          totalPages={inbox.mailboxes.data?.total_pages || 1}
          isLoading={inbox.mailboxes.isLoading}
          confirmingId={confirmingId}
          onSearchChange={setMailboxSearch}
          onPageChange={setMailboxPage}
          onSelectMailbox={selectMailbox}
          onDeleteMailbox={handleDeleteMailbox}
          setConfirmingId={setConfirmingId}
        />
      </section>

      <section className={`panel inbox-column inbox-message-column ${mobileStep !== 'messages' ? 'inbox-drilldown-hidden' : ''}`}>
        <div className="inbox-mobile-stepbar">
          <button className="btn-ghost" type="button" onClick={() => setMobileStep('mailboxes')}>{text.inbox.backToMailboxes}</button>
          <span>{text.inbox.messages}</span>
        </div>

        <div className="panel-header inbox-column-header">
          <div className="min-w-0">
            <h2>{text.inbox.messages}</h2>
            <p className="truncate">{email || text.inbox.noEmail}</p>
          </div>
          <div className="inbox-message-actions">
            {email && (
              <IconButton title={emailCopied ? text.common.copied : text.inbox.copyEmail} onClick={() => { copy(email); markEmailCopied(); }}>
                {emailCopied ? <Check size={16} /> : <Copy size={16} />}
              </IconButton>
            )}
            {activeMailbox && (
              <IconButton title={text.shareLinks.shareMailbox} onClick={() => shareMailbox.mutate(activeMailbox)} disabled={shareMailbox.isPending}>
                <Share2 size={16} />
              </IconButton>
            )}
            <InboxActions
              text={text}
              confirmClear={confirmClear}
              clearDisabled={!email || inbox.emailTotal === 0}
              isRefetching={inbox.emails.isRefetching}
              onRefresh={() => inbox.emails.refetch()}
              onClear={handleClear}
            />
          </div>
        </div>

        {email && (
          <div className="inbox-active-mailbox">
            <code>{email}</code>
          </div>
        )}
        {mailboxShareLink && <OneTimeLinkCard link={mailboxShareLink} onClose={() => setMailboxShareLink(null)} />}

        <MessageList
          ref={mailListRef}
          text={text}
          email={email}
          items={inbox.emailItems}
          total={inbox.emailTotal}
          page={inbox.emails.data?.page || 1}
          totalPages={inbox.emails.data?.total_pages || 1}
          selectedID={selectedID}
          pulseIds={pulseIds}
          isLoading={inbox.emails.isLoading}
          isFetching={inbox.emails.isFetching}
          shouldReduceMotion={Boolean(shouldReduceMotion)}
          onSelectMessage={selectMessage}
          onPageChange={(page) => {
            setSelectedID('');
            setEmailPage(page);
            setMobileStep('messages');
          }}
        />
      </section>

      <div className={`inbox-detail-pane ${mobileStep !== 'detail' ? 'inbox-drilldown-hidden' : ''}`}>
        <MessagePreviewPane
          message={selectedID ? inbox.detail.data : undefined}
          loading={Boolean(selectedID) && inbox.detail.isLoading}
          apiKey={apiKey}
          onBack={() => setMobileStep('messages')}
        />
      </div>
    </div>
  );
}
