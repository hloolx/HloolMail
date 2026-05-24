import { useState } from 'react';
import { X } from 'lucide-react';
import type { WebhookDeliveryDTO, WebhookEndpointDTO } from '../types';
import { useWebhookDeliveriesQuery } from '../queries';
import { useText } from '../../../locales';
import { relativeTime } from '../../../lib/display';
import { DataTable, DialogShell, IconButton, PaginationControls } from '../../../components/shared';
import { Badge } from '../../../components/ui';

type WebhookDeliveriesDialogProps = {
  endpoint: WebhookEndpointDTO;
  onClose: () => void;
};

export function WebhookDeliveriesDialog({ endpoint, onClose }: WebhookDeliveriesDialogProps) {
  const text = useText();
  const [page, setPage] = useState(1);
  const deliveries = useWebhookDeliveriesQuery(endpoint.id, page);

  return (
    <DialogShell
      className="modal-panel automation-log-modal"
      titleId="webhook-deliveries-title"
      descriptionId="webhook-deliveries-desc"
      onClose={onClose}
    >
      <div className="modal-header">
        <div>
          <h2 id="webhook-deliveries-title">{text.webhooks.deliveriesTitle}</h2>
          <p id="webhook-deliveries-desc">{endpoint.name}</p>
        </div>
        <IconButton title={text.common.close} onClick={onClose}>
          <X size={16} />
        </IconButton>
      </div>
      <div className="automation-modal-body">
        <DataTable
          ariaLabel={text.webhooks.deliveriesTitle}
          density="compact"
          columns={[
            { key: 'delivery', header: text.webhooks.delivery, minWidth: '12rem' },
            { key: 'event', header: text.webhooks.event, width: '10rem' },
            { key: 'status', header: text.webhooks.status, align: 'center', width: '7rem' },
            { key: 'attempts', header: text.webhooks.attempts, align: 'right', width: '6rem' },
            { key: 'next', header: text.webhooks.nextAttempt, width: '8rem' },
            { key: 'response', header: text.webhooks.response, width: '7rem' },
            { key: 'error', header: text.webhooks.error, minWidth: '14rem' }
          ]}
          emptyLabel={deliveries.isLoading ? text.common.loading : text.webhooks.noDeliveries}
          rows={(deliveries.data?.items || []).map((delivery) => ({
            key: delivery.id,
            cells: [
              <code className="automation-code">{delivery.id}</code>,
              delivery.event_type,
              deliveryStatus(delivery, text),
              `${delivery.attempt_count}/${delivery.max_attempts}`,
              delivery.next_attempt_at ? relativeTime(delivery.next_attempt_at) : '-',
              delivery.response_status || '-',
              { content: <span className="automation-muted-cell">{delivery.error || delivery.response_body || '-'}</span>, title: delivery.error || delivery.response_body || undefined }
            ]
          }))}
        />
        <PaginationControls page={deliveries.data?.page || page} totalPages={deliveries.data?.total_pages || 1} onPageChange={setPage} />
      </div>
    </DialogShell>
  );
}

function deliveryStatus(delivery: WebhookDeliveryDTO, text: ReturnType<typeof useText>) {
  const variant = delivery.status === 'succeeded' ? 'success' : delivery.status === 'failed' ? 'danger' : 'warning';
  return <Badge variant={variant} size="sm">{text.webhooks.deliveryStatus[delivery.status] || delivery.status}</Badge>;
}
