import type { MessageDetail } from '../../api';
import { MessageDrawer } from '../MessageDrawer';

type MessagePreviewPaneProps = {
  message?: MessageDetail;
  loading: boolean;
  error?: unknown;
  onBack?: () => void;
  onRetry?: () => void;
};

export function MessagePreviewPane({ message, loading, error, onBack, onRetry }: MessagePreviewPaneProps) {
  return <MessageDrawer message={message} loading={loading} error={error} onBack={onBack} onRetry={onRetry} />;
}
