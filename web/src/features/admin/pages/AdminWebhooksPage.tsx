import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ListChecks, Loader2, RefreshCw, Search, ShieldOff, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import type { AdminWebhookEndpointDTO, WebhookDeliveryDTO } from '../../../api';
import {
  useAdminWebhookDeliveriesQuery,
  useAdminWebhooksQuery,
  useDeleteAdminWebhookMutation,
  useDisableAdminWebhookMutation
} from '../../webhooks/queries';
import { useText } from '../../../locales';
import { relativeTime } from '../../../lib/display';
import { queryKeys } from '../../../lib/queryKeys';
import { useTableUrlState } from '../../../hooks/useTableUrlState';
import { ConfirmModal, DataTable, DataTableToolbar, DataTableViewOptions, DialogShell, IconButton, PaginationControls } from '../../../components/shared';
import type { DataTableColumn } from '../../../components/shared';
import { Badge } from '../../../components/ui';
import { AdminPageFrame } from '../components/AdminPageFrame';
import { queryErrorMessage } from '../utils/adminFormatting';

const ADMIN_WEBHOOK_PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
const ADMIN_WEBHOOK_STATUS_OPTIONS = ['all', 'enabled', 'disabled'] as const;
const ADMIN_WEBHOOK_SCOPE_OPTIONS = ['any', 'all', 'domain', 'mailbox'] as const;

type AdminWebhookFilters = {
  status: (typeof ADMIN_WEBHOOK_STATUS_OPTIONS)[number];
  scope: (typeof ADMIN_WEBHOOK_SCOPE_OPTIONS)[number];
};

const DEFAULT_ADMIN_WEBHOOK_FILTERS: AdminWebhookFilters = {
  status: 'all',
  scope: 'any'
};

export function AdminWebhooksPage() {
  const text = useText();
  return (
    <AdminPageFrame title={text.page['admin-webhooks']}>
      <AdminWebhooksPanel />
    </AdminPageFrame>
  );
}

export function AdminWebhooksPanel() {
  const text = useText();
  const queryClient = useQueryClient();
  const [deliveriesTarget, setDeliveriesTarget] = useState<AdminWebhookEndpointDTO | null>(null);
  const [disableTarget, setDisableTarget] = useState<AdminWebhookEndpointDTO | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminWebhookEndpointDTO | null>(null);
  const [hiddenColumnKeys, setHiddenColumnKeys] = useState<string[]>([]);
  const webhookUrlState = useTableUrlState<AdminWebhookFilters>({
    defaultPageSize: 10,
    defaultSearch: '',
    defaultFilters: DEFAULT_ADMIN_WEBHOOK_FILTERS,
    pageParam: 'webhookPage',
    pageSizeParam: 'webhookPageSize',
    searchParam: 'webhookSearch',
    filterParams: { status: 'webhookStatus', scope: 'webhookScope' },
    filterOptions: { status: ADMIN_WEBHOOK_STATUS_OPTIONS, scope: ADMIN_WEBHOOK_SCOPE_OPTIONS },
    pageSizeOptions: ADMIN_WEBHOOK_PAGE_SIZE_OPTIONS
  });
  const { page, pageSize, search, filters } = webhookUrlState;
  const query = buildAdminWebhooksQuery(search, filters, page, pageSize);
  const webhooks = useAdminWebhooksQuery(query);
  const list = webhooks.data?.items || [];
  const columns = useMemo<DataTableColumn[]>(() => [
    { key: 'name', header: text.webhooks.name, minWidth: '12rem', hideable: false, mobileTitle: true },
    { key: 'owner', header: text.admin.webhooks.colOwner, minWidth: '13rem', mobileSubtitle: true },
    { key: 'url', header: text.webhooks.url, minWidth: '18rem', hideable: true },
    { key: 'scope', header: text.webhooks.scope, align: 'center', width: '10rem', mobileBadge: true },
    { key: 'status', header: text.webhooks.status, align: 'center', width: '7rem', mobileBadge: true },
    { key: 'failures', header: text.webhooks.failures, align: 'right', width: '6rem', mobilePriority: 1 },
    { key: 'last-success', header: text.webhooks.lastSuccess, width: '8rem', mobilePriority: 2 },
    { key: 'last-failure', header: text.webhooks.lastFailure, width: '8rem', mobilePriority: 3 },
    { key: 'created', header: text.common.createdAt, width: '8rem', mobilePriority: 4 },
    { key: 'actions', role: 'actions', header: text.webhooks.actions, align: 'right', minWidth: '11rem', hideable: false }
  ], [text]);

  const disable = useDisableAdminWebhookMutation({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.webhooksRoot });
      setDisableTarget(null);
      toast.success(text.admin.webhooks.disabledToast);
    },
    onError: (error) => {
      toast.error(error.message);
    }
  });
  const deleteWebhook = useDeleteAdminWebhookMutation({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.webhooksRoot });
      setDeleteTarget(null);
      toast.success(text.admin.webhooks.deletedToast);
    },
    onError: (error) => {
      toast.error(error.message);
    }
  });

  const resultCount = text.admin.webhooks.resultCount
    .replace('{shown}', String(list.length))
    .replace('{total}', String(webhooks.data?.total ?? 0));
  const disablingWebhookId = disable.isPending ? disable.variables?.id : null;
  const deletingWebhookId = deleteWebhook.isPending ? deleteWebhook.variables?.id : null;

  return (
    <section className="panel admin-table-panel" id="admin-webhooks">
      <div className="panel-header admin-panel-header">
        <div>
          <h2>{text.admin.webhooks.title}</h2>
          <p>{text.admin.webhooks.desc}</p>
        </div>
        <button className="btn-secondary" type="button" onClick={() => webhooks.refetch()} disabled={webhooks.isFetching}>
          <RefreshCw size={14} className={webhooks.isFetching ? 'animate-spin' : ''} aria-hidden="true" />
          {text.common.refresh}
        </button>
      </div>
      <DataTableToolbar
        className="admin-domain-health-toolbar"
        search={(
          <label className="admin-domain-health-search" aria-label={text.admin.webhooks.search}>
            <Search size={15} aria-hidden="true" />
            <input
              value={search}
              onChange={(event) => webhookUrlState.setSearch(event.target.value, 'replace')}
              placeholder={text.admin.webhooks.searchPlaceholder}
            />
          </label>
        )}
        filters={(
          <div className="admin-domain-health-filters">
            <select className="input" value={filters.status} aria-label={text.admin.webhooks.filterStatus} onChange={(event) => webhookUrlState.setFilter('status', event.target.value as AdminWebhookFilters['status'])}>
              <option value="all">{text.admin.webhooks.filterStatusAll}</option>
              <option value="enabled">{text.common.enabled}</option>
              <option value="disabled">{text.common.disabled}</option>
            </select>
            <select className="input" value={filters.scope} aria-label={text.admin.webhooks.filterScope} onChange={(event) => webhookUrlState.setFilter('scope', event.target.value as AdminWebhookFilters['scope'])}>
              <option value="any">{text.admin.webhooks.filterScopeAll}</option>
              <option value="all">{text.webhooks.scopeAll}</option>
              <option value="domain">{text.webhooks.scopeDomain}</option>
              <option value="mailbox">{text.webhooks.scopeMailbox}</option>
            </select>
          </div>
        )}
        state={<span className="admin-domain-health-count">{resultCount}</span>}
        viewOptions={(
          <DataTableViewOptions
            columns={columns}
            hiddenColumnKeys={hiddenColumnKeys}
            onHiddenColumnKeysChange={setHiddenColumnKeys}
            label={text.common.view}
            menuLabel={text.common.toggleColumns}
            resetLabel={text.common.reset}
            emptyLabel={text.common.noToggleColumns}
          />
        )}
      />
      <DataTable
        ariaLabel={text.admin.webhooks.title}
        emptyLabel={text.admin.webhooks.empty}
        loading={webhooks.isLoading}
        loadingLabel={text.common.loading}
        error={webhooks.isError}
        errorLabel={queryErrorMessage(webhooks.error, text.admin.webhooks.empty)}
        retryLabel={text.common.retry}
        onRetry={() => webhooks.refetch()}
        retryPending={webhooks.isFetching}
        columns={columns}
        hiddenColumnKeys={hiddenColumnKeys}
        onHiddenColumnKeysChange={setHiddenColumnKeys}
        hiddenLabel={text.common.noColumnsSelected}
        showAllColumnsLabel={text.common.showAllColumns}
        rows={list.map((endpoint) => {
          const rowPending = disablingWebhookId === endpoint.id || deletingWebhookId === endpoint.id;
          const target = webhookTargetText(endpoint, text);
          return {
            key: endpoint.id,
            cells: [
              <span className="automation-primary-cell">{endpoint.name}</span>,
              ownerTarget(endpoint, text),
              <code className="automation-code">{endpoint.url}</code>,
              scopeTarget(endpoint, text),
              webhookStatus(endpoint, text),
              endpoint.failure_count,
              endpoint.last_success_at ? relativeTime(endpoint.last_success_at) : '-',
              endpoint.last_failure_at ? relativeTime(endpoint.last_failure_at) : '-',
              relativeTime(endpoint.created_at),
              <div className="table-actions" data-webhook-id={endpoint.id}>
                <IconButton title={text.webhooks.deliveries} ariaLabel={`${text.webhooks.deliveries} ${target}`} onClick={() => setDeliveriesTarget(endpoint)} disabled={rowPending}>
                  <ListChecks size={14} aria-hidden="true" />
                </IconButton>
                <IconButton
                  title={text.common.disabled}
                  ariaLabel={`${text.common.disabled} ${target}`}
                  onClick={() => setDisableTarget(endpoint)}
                  disabled={rowPending || !endpoint.enabled}
                >
                  {disablingWebhookId === endpoint.id ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <ShieldOff size={14} aria-hidden="true" />}
                </IconButton>
                <IconButton
                  title={text.common.delete}
                  ariaLabel={`${text.common.delete} ${target}`}
                  onClick={() => setDeleteTarget(endpoint)}
                  disabled={rowPending}
                >
                  {deletingWebhookId === endpoint.id ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Trash2 size={14} aria-hidden="true" />}
                </IconButton>
              </div>
            ]
          };
        })}
      />
      <PaginationControls
        page={webhooks.data?.page || page}
        totalPages={webhooks.data?.total_pages || 1}
        onPageChange={webhookUrlState.setPage}
        rowsPerPage={pageSize}
        rowsPerPageOptions={[...ADMIN_WEBHOOK_PAGE_SIZE_OPTIONS]}
        onRowsPerPageChange={webhookUrlState.setPageSize}
        rowsPerPageLabel={text.common.rowsPerPage}
      />
      {deliveriesTarget && <AdminWebhookDeliveriesModal endpoint={deliveriesTarget} onClose={() => setDeliveriesTarget(null)} />}
      <ConfirmModal
        open={disableTarget !== null}
        title={text.common.disabled}
        description={disableTarget ? text.admin.webhooks.disableConfirm.replace('{target}', webhookTargetText(disableTarget, text)) : ''}
        confirmText={text.common.disabled}
        cancelText={text.common.cancel}
        danger
        confirmLoading={disable.isPending}
        onConfirm={() => disableTarget ? disable.mutateAsync(disableTarget) : undefined}
        onCancel={() => {
          if (!disable.isPending) setDisableTarget(null);
        }}
      />
      <ConfirmModal
        open={deleteTarget !== null}
        title={text.common.delete}
        description={deleteTarget ? text.admin.webhooks.deleteConfirm.replace('{target}', webhookTargetText(deleteTarget, text)) : ''}
        confirmText={text.common.delete}
        cancelText={text.common.cancel}
        danger
        confirmLoading={deleteWebhook.isPending}
        onConfirm={() => deleteTarget ? deleteWebhook.mutateAsync(deleteTarget) : undefined}
        onCancel={() => {
          if (!deleteWebhook.isPending) setDeleteTarget(null);
        }}
      />
    </section>
  );
}

function AdminWebhookDeliveriesModal({ endpoint, onClose }: { endpoint: AdminWebhookEndpointDTO; onClose: () => void }) {
  const text = useText();
  const [page, setPage] = useState(1);
  const deliveries = useAdminWebhookDeliveriesQuery(endpoint.id, page);

  return (
    <DialogShell
      className="modal-panel automation-log-modal"
      titleId="admin-webhook-deliveries-title"
      descriptionId="admin-webhook-deliveries-desc"
      onClose={onClose}
    >
      <div className="modal-header">
        <div>
          <h2 id="admin-webhook-deliveries-title">{text.webhooks.deliveriesTitle}</h2>
          <p id="admin-webhook-deliveries-desc">{webhookTargetText(endpoint, text)}</p>
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
          emptyLabel={text.webhooks.noDeliveries}
          loading={deliveries.isLoading}
          loadingLabel={text.common.loading}
          error={deliveries.isError}
          errorLabel={queryErrorMessage(deliveries.error, text.webhooks.noDeliveries)}
          retryLabel={text.common.retry}
          onRetry={() => deliveries.refetch()}
          retryPending={deliveries.isFetching}
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

function buildAdminWebhooksQuery(search: string, filters: AdminWebhookFilters, page: number, perPage: number) {
  const params = new URLSearchParams({
    page: String(page),
    per_page: String(perPage)
  });
  if (search.trim()) params.set('q', search.trim());
  if (filters.status !== 'all') params.set('status', filters.status);
  if (filters.scope !== 'any') params.set('scope', filters.scope);
  return params.toString();
}

function ownerTarget(endpoint: AdminWebhookEndpointDTO, text: ReturnType<typeof useText>) {
  return (
    <div className="admin-domain-cell">
      <b>{endpoint.owner_email || text.admin.webhooks.ownerUnknown}</b>
      <small>{endpoint.owner_role || `#${endpoint.owner_id}`}</small>
    </div>
  );
}

function scopeTarget(endpoint: AdminWebhookEndpointDTO, text: ReturnType<typeof useText>) {
  if (endpoint.scope === 'domain') {
    return `${text.webhooks.scopeDomain} ${endpoint.domain_name || (endpoint.domain_id ? `#${endpoint.domain_id}` : '-')}`;
  }
  if (endpoint.scope === 'mailbox') {
    return `${text.webhooks.scopeMailbox} ${endpoint.mailbox_email || (endpoint.mailbox_id ? `#${endpoint.mailbox_id}` : '-')}`;
  }
  return text.webhooks.scopeAll;
}

function webhookStatus(endpoint: AdminWebhookEndpointDTO, text: ReturnType<typeof useText>) {
  return endpoint.enabled
    ? <span className="status-pill status-ok">{text.common.enabled}</span>
    : <span className="status-pill status-bad">{text.common.disabled}</span>;
}

function webhookTargetText(endpoint: AdminWebhookEndpointDTO, text: ReturnType<typeof useText>) {
  const owner = endpoint.owner_email || `${text.admin.webhooks.ownerUnknown} #${endpoint.owner_id}`;
  return `${endpoint.name} / ${owner}`;
}

function deliveryStatus(delivery: WebhookDeliveryDTO, text: ReturnType<typeof useText>) {
  const variant = delivery.status === 'succeeded' ? 'success' : delivery.status === 'failed' ? 'danger' : 'warning';
  return <Badge variant={variant} size="sm">{text.webhooks.deliveryStatus[delivery.status] || delivery.status}</Badge>;
}
