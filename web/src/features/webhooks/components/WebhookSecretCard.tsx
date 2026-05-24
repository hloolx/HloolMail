import { Check, Copy, X } from 'lucide-react';
import type { WebhookEndpointDTO } from '../types';
import { useCopyState } from '../../../hooks/useCopyState';
import { copy } from '../../../lib/clipboard';
import { useText } from '../../../locales';
import { IconButton } from '../../../components/shared';
import { Button } from '../../../components/ui';

type WebhookSecretCardProps = {
  endpoint: WebhookEndpointDTO;
  onClose: () => void;
};

export function WebhookSecretCard({ endpoint, onClose }: WebhookSecretCardProps) {
  const text = useText();
  const [copied, markCopied] = useCopyState();
  if (!endpoint.secret) return null;

  return (
    <div className="one-time-secret-card">
      <div className="min-w-0">
        <strong>{text.webhooks.secretCreated}</strong>
        <p>{text.webhooks.secretHint}</p>
        <code>{endpoint.secret}</code>
      </div>
      <Button
        variant="secondary"
        leadingIcon={copied ? <Check size={16} /> : <Copy size={16} />}
        onClick={() => { void copy(endpoint.secret || ''); markCopied(); }}
      >
        {copied ? text.common.copied : text.webhooks.copySecret}
      </Button>
      <IconButton title={text.common.close} onClick={onClose}>
        <X size={14} />
      </IconButton>
    </div>
  );
}
