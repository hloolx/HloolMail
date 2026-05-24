import type { MessageDetail } from '../../api';
import { MessageDrawer } from '../MessageDrawer';

type MessagePreviewPaneProps = {
  message?: MessageDetail;
  loading: boolean;
  error?: unknown;
  apiKey: string;
  onBack?: () => void;
  onRetry?: () => void;
};

export function MessagePreviewPane({ message, loading, error, apiKey, onBack, onRetry }: MessagePreviewPaneProps) {
  return <MessageDrawer message={message} loading={loading} error={error} apiKey={apiKey} onBack={onBack} onRetry={onRetry} />;
}
