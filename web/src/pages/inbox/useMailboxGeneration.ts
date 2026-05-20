import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { postJSON } from '../../api';
import { useText } from '../../locales';
import { useAppStore } from '../../store';
import { notifySuccess } from '../../lib/feedback';
import { isConflictError, MAX_GENERATE_EMAIL_CONFLICT_RETRIES } from './utils';

type MailboxGenerationOptions = {
  apiKey: string;
  onGenerated: () => void;
};

export function useMailboxGeneration({ apiKey, onGenerated }: MailboxGenerationOptions) {
  const queryClient = useQueryClient();
  const text = useText();
  const setEmail = useAppStore((state) => state.setEmail);
  const [prefix, setPrefix] = useState('');
  const [domainName, setDomainName] = useState('');
  const generateRequestRef = useRef({ prefix: '', domain: '' });
  const generateButtonRef = useRef<HTMLButtonElement | null>(null);

  const generate = useMutation({
    mutationFn: () => postJSON<{ email: string; domain_id: number; reuse?: boolean }>('/api/generate-email', generateRequestRef.current, { apiKey }),
    onMutate: () => {
      generateRequestRef.current = { prefix, domain: domainName };
    },
    retry: (failureCount, error) => {
      if (!isConflictError(error) || failureCount >= MAX_GENERATE_EMAIL_CONFLICT_RETRIES) return false;
      generateRequestRef.current = { ...generateRequestRef.current, prefix: '' };
      setPrefix('');
      return true;
    },
    retryDelay: (failureCount) => Math.min(500 * 2 ** failureCount, 2000),
    onSuccess: (data) => {
      setEmail(data.email);
      onGenerated();
      queryClient.invalidateQueries({ queryKey: ['mailboxes'] });
      queryClient.invalidateQueries({ queryKey: ['mailbox-stats'] });
      notifySuccess(data.reuse ? text.inbox.emailReuse : text.toast.emailGenerated, { origin: generateButtonRef.current });
    },
    onError: (error) => toast.error(error.message)
  });

  return {
    prefix,
    domainName,
    generate,
    generateButtonRef,
    setPrefix,
    setDomainName
  };
}
