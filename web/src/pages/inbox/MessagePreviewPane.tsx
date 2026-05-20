import type { MessageDetail } from '../../api';
import { MessageDrawer } from '../MessageDrawer';

type MessagePreviewPaneProps = {
  message?: MessageDetail;
  loading: boolean;
  apiKey: string;
  onBack?: () => void;
};

export function MessagePreviewPane({ message, loading, apiKey, onBack }: MessagePreviewPaneProps) {
  return <MessageDrawer message={message} loading={loading} apiKey={apiKey} onBack={onBack} />;
}
