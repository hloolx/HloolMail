import { useMemo, useState } from 'react';
import { Edit3, ListChecks, Play, RefreshCw, Trash2 } from 'lucide-react';
import type { WebhookEndpointDTO, WebhookPendingAction, WebhookPendingTarget } from '../types';
import { useText } from '../../../locales';
import { relativeTime } from '../../../lib/display';
import { DataTable, DataTableToolbar, DataTableViewOptions, IconButton } from '../../../components/shared';
import type { DataTableColumn } from '../../../components/shared';
import { Switch } from '../../../components/ui';

type WebhooksTableProps = {
  endpoints: WebhookEndpointDTO[];
  isLoading: boolean;
  onToggleEnabled: (endpoint: WebhookEndpointDTO) => void;
  onEdit: (endpoint: WebhookEndpointDTO) => void;
  onTest: (endpoint: WebhookEndpointDTO) => void;
  onShowDeliveries: (endpoint: WebhookEndpointDTO) => void;
  onRotateSecret: (endpoint: WebhookEndpointDTO) => void;
  onDelete: (endpoint: WebhookEndpointDTO) => void;
  pendingTargets?: WebhookPendingTarget[];
};

export function WebhooksTable({
  endpoints,
  isLoading,
  onToggleEnabled,
  onEdit,
  onTest,
  onShowDeliveries,
  onRotateSecret,
  onDelete,
  pendingTargets = []
}: WebhooksTableProps) {
  const text = useText();
  const [hiddenColumnKeys, setHiddenColumnKeys] = useState<string[]>([]);
  const isActionPending = (endpoint: WebhookEndpointDTO, action: WebhookPendingAction) => (
    pendingTargets.some((target) => target.endpointId === endpoint.id && target.action === action)
  );
  const columns = useMemo<DataTableColumn[]>(() => [
    { key: 'name', header: text.webhooks.name, minWidth: '10rem', mobileTitle: true },
    { key: 'url', header: text.webhooks.url, minWidth: '18rem', mobileSubtitle: true },
    { key: 'scope', header: text.webhooks.scope, align: 'center', width: '8rem', mobileBadge: true },
    { key: 'enabled', header: text.webhooks.enabled, viewLabel: text.webhooks.enabled, align: 'center', width: '7rem', mobileBadge: true },
    { key: 'failures', header: text.webhooks.failures, align: 'right', width: '6rem', mobilePriority: 1 },
    { key: 'last-success', header: text.webhooks.lastSuccess, width: '8rem', mobilePriority: 2 },
    { key: 'last-failure', header: text.webhooks.lastFailure, width: '8rem', mobilePriority: 3 },
    { key: 'created', header: text.common.createdAt, width: '8rem', mobilePriority: 4 },
    { key: 'secret', header: text.webhooks.secret, width: '9rem', mobilePriority: 5 },
    { key: 'actions', role: 'actions', header: text.webhooks.actions, align: 'right', minWidth: '16rem', hideable: false }
  ], [text]);

  return (
    <>
      <DataTableToolbar
        viewOptions={(
          <DataTableViewOptions
            columns={columns}
            hiddenColumnKeys={hiddenColumnKeys}
            onHiddenColumnKeysChange={setHiddenColumnKeys}
            label={text.common.view}
            menuLabel={text.common.toggleColumns}
            resetLabel={text.common.reset}
          />
        )}
      />
      <DataTable
        ariaLabel={text.webhooks.title}
        columns={columns}
        hiddenColumnKeys={hiddenColumnKeys}
        onHiddenColumnKeysChange={setHiddenColumnKeys}
        hiddenLabel={text.common.noColumnsSelected}
        showAllColumnsLabel={text.common.showAllColumns}
        emptyLabel={text.webhooks.empty}
        loading={isLoading}
        loadingLabel={text.common.loading}
        rows={endpoints.map((endpoint) => ({
        key: endpoint.id,
        cells: [
          <span className="automation-primary-cell">{endpoint.name}</span>,
          { content: <code className="automation-code">{endpoint.url}</code>, title: endpoint.url },
          scopeLabel(endpoint, text),
          <Switch
            size="sm"
            checked={endpoint.enabled}
            onCheckedChange={() => onToggleEnabled(endpoint)}
            disabled={isActionPending(endpoint, 'toggle')}
            aria-label={endpoint.enabled ? text.common.enabled : text.common.disabled}
          />,
          endpoint.failure_count,
          endpoint.last_success_at ? relativeTime(endpoint.last_success_at) : '-',
          endpoint.last_failure_at ? relativeTime(endpoint.last_failure_at) : '-',
          relativeTime(endpoint.created_at),
          endpoint.secret_preview || '-',
          <div className="table-actions">
            <IconButton title={text.webhooks.edit} onClick={() => onEdit(endpoint)}>
              <Edit3 size={14} />
            </IconButton>
            <IconButton title={text.webhooks.test} onClick={() => onTest(endpoint)} disabled={isActionPending(endpoint, 'test')}>
              <Play size={14} />
            </IconButton>
            <IconButton title={text.webhooks.deliveries} onClick={() => onShowDeliveries(endpoint)}>
              <ListChecks size={14} />
            </IconButton>
            <IconButton title={text.webhooks.rotateSecret} onClick={() => onRotateSecret(endpoint)} disabled={isActionPending(endpoint, 'rotateSecret')}>
              <RefreshCw size={14} />
            </IconButton>
            <IconButton title={text.webhooks.delete} onClick={() => onDelete(endpoint)} disabled={isActionPending(endpoint, 'delete')}>
              <Trash2 size={14} />
            </IconButton>
          </div>
        ]
      }))}
      />
    </>
  );
}

function scopeLabel(endpoint: WebhookEndpointDTO, text: ReturnType<typeof useText>) {
  if (endpoint.scope === 'domain') return `${text.webhooks.scopeDomain} #${endpoint.domain_id || '-'}`;
  if (endpoint.scope === 'mailbox') return `${text.webhooks.scopeMailbox} #${endpoint.mailbox_id || '-'}`;
  return text.webhooks.scopeAll;
}
