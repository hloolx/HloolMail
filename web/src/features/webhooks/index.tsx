import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { WebhookEditorTarget, WebhookEndpointDTO, WebhookPendingAction, WebhookPendingTarget } from './types';
import {
  useDeleteWebhookMutation,
  useRotateWebhookSecretMutation,
  useTestWebhookMutation,
  useToggleWebhookMutation,
  useWebhooksQuery,
  webhookKeys
} from './queries';
import { WebhooksTable } from './components/WebhooksTable';
import { WebhookEditorDialog } from './components/WebhookEditorDialog';
import { WebhookDeliveriesDialog } from './components/WebhookDeliveriesDialog';
import { WebhookSecretCard } from './components/WebhookSecretCard';
import { useText } from '../../locales';
import { useTableUrlState } from '../../hooks/useTableUrlState';
import { ConfirmModal, EmptyState, PaginationControls } from '../../components/shared';
import { Button, PageHeader, Panel } from '../../components/ui';

const WEBHOOK_ROWS_PER_PAGE_OPTIONS = [10, 20, 50, 100];

export function WebhooksFeature() {
  const text = useText();
  const queryClient = useQueryClient();
  const {
    page,
    setPage,
    pageSize: rowsPerPage,
    setPageSize: setRowsPerPage
  } = useTableUrlState({
    defaultPageSize: 10,
    pageSizeParam: 'perPage',
    pageSizeOptions: WEBHOOK_ROWS_PER_PAGE_OPTIONS
  });
  const [editorTarget, setEditorTarget] = useState<WebhookEditorTarget>(null);
  const [deliveriesTarget, setDeliveriesTarget] = useState<WebhookEndpointDTO | null>(null);
  const [rotateTarget, setRotateTarget] = useState<WebhookEndpointDTO | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WebhookEndpointDTO | null>(null);
  const [oneTimeSecret, setOneTimeSecret] = useState<WebhookEndpointDTO | null>(null);
  const [pendingTargets, setPendingTargets] = useState<WebhookPendingTarget[]>([]);
  const pendingTargetKeys = useRef(new Set<string>());
  const webhooks = useWebhooksQuery(page, rowsPerPage);

  const toggle = useToggleWebhookMutation({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: webhookKeys.all });
      toast.success(text.webhooks.saved);
    },
    onError: (error) => toast.error(error.message)
  });
  const rotate = useRotateWebhookSecretMutation({
    onSuccess: (data) => {
      setRotateTarget(null);
      setOneTimeSecret(data);
      queryClient.invalidateQueries({ queryKey: webhookKeys.all });
      toast.success(text.webhooks.secretRotated);
    },
    onError: (error) => toast.error(error.message)
  });
  const test = useTestWebhookMutation({
    onSuccess: (_data, endpoint) => {
      queryClient.invalidateQueries({ queryKey: webhookKeys.deliveriesRoot(endpoint.id) });
      toast.success(text.webhooks.testQueued);
    },
    onError: (error) => toast.error(error.message)
  });
  const remove = useDeleteWebhookMutation({
    onSuccess: () => {
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: webhookKeys.all });
      toast.success(text.webhooks.deleted);
    },
    onError: (error) => toast.error(error.message)
  });
  const runWithEndpointPending = async (
    endpoint: WebhookEndpointDTO,
    action: WebhookPendingAction,
    mutation: () => Promise<unknown>
  ) => {
    const key = webhookPendingKey(endpoint.id, action);
    if (pendingTargetKeys.current.has(key)) return;

    pendingTargetKeys.current.add(key);
    setPendingTargets((current) => (
      current.some((target) => target.endpointId === endpoint.id && target.action === action)
        ? current
        : [...current, { endpointId: endpoint.id, action }]
    ));

    try {
      await mutation();
    } catch {
      // Mutation onError handlers own user feedback; keep this wrapper focused on pending state.
    } finally {
      pendingTargetKeys.current.delete(key);
      setPendingTargets((current) => (
        current.filter((target) => target.endpointId !== endpoint.id || target.action !== action)
      ));
    }
  };

  return (
    <div className="grid gap-4">
      <Panel>
        <PageHeader
          className="api-key-panel-header"
          title={text.webhooks.title}
          description={`${webhooks.data?.total ?? 0} ${text.webhooks.count}`}
          actions={
            <Button variant="primary" onClick={() => setEditorTarget('new')} leadingIcon={<Plus size={16} />}>
              {text.webhooks.createButton}
            </Button>
          }
        />
        <p className="api-key-helper">{text.webhooks.desc}</p>
        {oneTimeSecret && <WebhookSecretCard endpoint={oneTimeSecret} onClose={() => setOneTimeSecret(null)} />}
        {webhooks.isError ? (
          <EmptyState label={webhooks.error.message} />
        ) : (
          <WebhooksTable
            endpoints={webhooks.data?.items || []}
            isLoading={webhooks.isLoading}
            onToggleEnabled={(endpoint) => {
              void runWithEndpointPending(endpoint, 'toggle', () => toggle.mutateAsync(endpoint));
            }}
            onEdit={setEditorTarget}
            onTest={(endpoint) => {
              void runWithEndpointPending(endpoint, 'test', () => test.mutateAsync(endpoint));
            }}
            onShowDeliveries={setDeliveriesTarget}
            onRotateSecret={setRotateTarget}
            onDelete={setDeleteTarget}
            pendingTargets={pendingTargets}
          />
        )}
        <PaginationControls
          page={webhooks.data?.page || page}
          totalPages={webhooks.data?.total_pages || 1}
          onPageChange={setPage}
          rowsPerPage={rowsPerPage}
          rowsPerPageOptions={WEBHOOK_ROWS_PER_PAGE_OPTIONS}
          onRowsPerPageChange={setRowsPerPage}
          rowsPerPageLabel={text.common.rowsPerPage}
        />
      </Panel>

      {editorTarget && (
        <WebhookEditorDialog
          endpoint={editorTarget === 'new' ? undefined : editorTarget}
          onClose={() => setEditorTarget(null)}
          onSaved={(endpoint) => {
            setEditorTarget(null);
            if (endpoint.secret) setOneTimeSecret(endpoint);
            queryClient.invalidateQueries({ queryKey: webhookKeys.all });
          }}
        />
      )}
      {deliveriesTarget && <WebhookDeliveriesDialog endpoint={deliveriesTarget} onClose={() => setDeliveriesTarget(null)} />}
      <ConfirmModal
        open={Boolean(rotateTarget)}
        title={text.webhooks.rotateSecret}
        description={text.webhooks.rotateSecretConfirm}
        confirmText={text.webhooks.rotateSecret}
        cancelText={text.common.cancel}
        onConfirm={() => {
          if (rotateTarget) {
            void runWithEndpointPending(rotateTarget, 'rotateSecret', () => rotate.mutateAsync(rotateTarget));
          }
        }}
        onCancel={() => setRotateTarget(null)}
      />
      <ConfirmModal
        open={Boolean(deleteTarget)}
        title={text.webhooks.delete}
        description={text.webhooks.deleteConfirm}
        danger
        confirmText={text.common.delete}
        cancelText={text.common.cancel}
        onConfirm={() => {
          if (deleteTarget) {
            void runWithEndpointPending(deleteTarget, 'delete', () => remove.mutateAsync(deleteTarget));
          }
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function webhookPendingKey(endpointId: number, action: WebhookPendingAction) {
  return `${endpointId}:${action}`;
}
