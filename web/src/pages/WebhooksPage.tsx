import { FormEvent, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Edit3, ListChecks, Play, Plus, RefreshCw, Trash2, Webhook, X } from 'lucide-react';
import { toast } from 'sonner';
import type { PaginatedResponse, WebhookDeliveryDTO, WebhookEndpointDTO } from '../api';
import { api, patchJSON, postJSON } from '../api';
import { useText } from '../locales';
import { copy } from '../lib/clipboard';
import { relativeTime } from '../lib/display';
import { useCopyState } from '../hooks/useCopyState';
import { ConfirmModal, DataTable, DialogShell, EmptyState, IconButton, PaginationControls } from '../components/shared';

const WEBHOOK_PER_PAGE = 10;
const DELIVERY_PER_PAGE = 20;
const MESSAGE_RECEIVED = 'message.received';

type WebhookFormState = {
  name: string;
  url: string;
  enabled: boolean;
  scope: 'all' | 'domain' | 'mailbox';
  domainId: string;
  mailboxId: string;
  messageReceived: boolean;
};

export function WebhooksPage() {
  const text = useText();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [editorTarget, setEditorTarget] = useState<WebhookEndpointDTO | 'new' | null>(null);
  const [deliveriesTarget, setDeliveriesTarget] = useState<WebhookEndpointDTO | null>(null);
  const [rotateTarget, setRotateTarget] = useState<WebhookEndpointDTO | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WebhookEndpointDTO | null>(null);
  const [oneTimeSecret, setOneTimeSecret] = useState<WebhookEndpointDTO | null>(null);
  const webhooks = useQuery({
    queryKey: ['webhooks', page],
    queryFn: () => api<PaginatedResponse<WebhookEndpointDTO>>(`/api/webhooks?page=${page}&per_page=${WEBHOOK_PER_PAGE}`),
    retry: false
  });

  const toggle = useMutation({
    mutationFn: (endpoint: WebhookEndpointDTO) => patchJSON<WebhookEndpointDTO>(`/api/webhooks/${endpoint.id}`, { enabled: !endpoint.enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks'] });
      toast.success(text.webhooks.saved);
    },
    onError: (error) => toast.error(error.message)
  });
  const rotate = useMutation({
    mutationFn: (endpoint: WebhookEndpointDTO) => postJSON<WebhookEndpointDTO>(`/api/webhooks/${endpoint.id}/rotate-secret`, {}),
    onSuccess: (data) => {
      setRotateTarget(null);
      setOneTimeSecret(data);
      queryClient.invalidateQueries({ queryKey: ['webhooks'] });
      toast.success(text.webhooks.secretRotated);
    },
    onError: (error) => toast.error(error.message)
  });
  const test = useMutation({
    mutationFn: (endpoint: WebhookEndpointDTO) => postJSON<WebhookDeliveryDTO>(`/api/webhooks/${endpoint.id}/test`, {}),
    onSuccess: (_data, endpoint) => {
      queryClient.invalidateQueries({ queryKey: ['webhook-deliveries', endpoint.id] });
      toast.success(text.webhooks.testQueued);
    },
    onError: (error) => toast.error(error.message)
  });
  const remove = useMutation({
    mutationFn: (endpoint: WebhookEndpointDTO) => api(`/api/webhooks/${endpoint.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ['webhooks'] });
      toast.success(text.webhooks.deleted);
    },
    onError: (error) => toast.error(error.message)
  });

  return (
    <div className="grid gap-4">
      <section className="panel">
        <div className="panel-header api-key-panel-header">
          <div>
            <h2>{text.webhooks.title}</h2>
            <p>{webhooks.data?.total ?? 0} {text.webhooks.count}</p>
          </div>
          <button className="btn-primary" onClick={() => setEditorTarget('new')}>
            <Plus size={16} />
            {text.webhooks.createButton}
          </button>
        </div>
        <p className="api-key-helper">{text.webhooks.desc}</p>
        {oneTimeSecret && <OneTimeSecretCard endpoint={oneTimeSecret} onClose={() => setOneTimeSecret(null)} />}
        {webhooks.isError ? (
          <EmptyState label={webhooks.error.message} />
        ) : (
          <DataTable
            ariaLabel={text.webhooks.title}
            columns={[
              { key: 'name', header: text.webhooks.name, minWidth: '10rem' },
              { key: 'url', header: text.webhooks.url, minWidth: '18rem' },
              { key: 'scope', header: text.webhooks.scope, align: 'center', width: '8rem' },
              { key: 'enabled', header: text.webhooks.enabled, align: 'center', width: '7rem' },
              { key: 'failures', header: text.webhooks.failures, align: 'right', width: '6rem' },
              { key: 'last-success', header: text.webhooks.lastSuccess, width: '8rem' },
              { key: 'last-failure', header: text.webhooks.lastFailure, width: '8rem' },
              { key: 'secret', header: text.webhooks.secret, width: '9rem' },
              { key: 'actions', header: text.webhooks.actions, align: 'right', minWidth: '16rem' }
            ]}
            emptyLabel={webhooks.isLoading ? text.common.loading : text.webhooks.empty}
            rows={(webhooks.data?.items || []).map((endpoint) => ({
              key: endpoint.id,
              cells: [
                <span className="automation-primary-cell">{endpoint.name}</span>,
                { content: <code className="automation-code">{endpoint.url}</code>, title: endpoint.url },
                scopeLabel(endpoint, text),
                <button
                  className={`toggle-switch toggle-switch-sm ${endpoint.enabled ? 'on' : ''}`}
                  onClick={() => toggle.mutate(endpoint)}
                  disabled={toggle.isPending}
                  role="switch"
                  aria-checked={endpoint.enabled}
                  aria-label={endpoint.enabled ? text.common.enabled : text.common.disabled}
                >
                  <span className="toggle-switch-knob" />
                </button>,
                endpoint.failure_count,
                endpoint.last_success_at ? relativeTime(endpoint.last_success_at) : '-',
                endpoint.last_failure_at ? relativeTime(endpoint.last_failure_at) : '-',
                endpoint.secret_preview || '-',
                <div className="table-actions">
                  <IconButton title={text.webhooks.edit} onClick={() => setEditorTarget(endpoint)}>
                    <Edit3 size={14} />
                  </IconButton>
                  <IconButton title={text.webhooks.test} onClick={() => test.mutate(endpoint)} disabled={test.isPending}>
                    <Play size={14} />
                  </IconButton>
                  <IconButton title={text.webhooks.deliveries} onClick={() => setDeliveriesTarget(endpoint)}>
                    <ListChecks size={14} />
                  </IconButton>
                  <IconButton title={text.webhooks.rotateSecret} onClick={() => setRotateTarget(endpoint)} disabled={rotate.isPending}>
                    <RefreshCw size={14} />
                  </IconButton>
                  <IconButton title={text.webhooks.delete} onClick={() => setDeleteTarget(endpoint)} disabled={remove.isPending}>
                    <Trash2 size={14} />
                  </IconButton>
                </div>
              ]
            }))}
          />
        )}
        <PaginationControls page={webhooks.data?.page || page} totalPages={webhooks.data?.total_pages || 1} onPageChange={setPage} />
      </section>

      {editorTarget && (
        <WebhookEditor
          endpoint={editorTarget === 'new' ? undefined : editorTarget}
          onClose={() => setEditorTarget(null)}
          onSaved={(endpoint) => {
            setEditorTarget(null);
            if (endpoint.secret) setOneTimeSecret(endpoint);
            queryClient.invalidateQueries({ queryKey: ['webhooks'] });
          }}
        />
      )}
      {deliveriesTarget && <WebhookDeliveriesModal endpoint={deliveriesTarget} onClose={() => setDeliveriesTarget(null)} />}
      <ConfirmModal
        open={Boolean(rotateTarget)}
        title={text.webhooks.rotateSecret}
        description={text.webhooks.rotateSecretConfirm}
        confirmText={text.webhooks.rotateSecret}
        cancelText={text.common.cancel}
        onConfirm={() => rotateTarget && rotate.mutate(rotateTarget)}
        onCancel={() => setRotateTarget(null)}
      />
      <ConfirmModal
        open={Boolean(deleteTarget)}
        title={text.webhooks.delete}
        description={text.webhooks.deleteConfirm}
        danger
        confirmText={text.common.delete}
        cancelText={text.common.cancel}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function WebhookEditor({
  endpoint,
  onClose,
  onSaved
}: {
  endpoint?: WebhookEndpointDTO;
  onClose: () => void;
  onSaved: (endpoint: WebhookEndpointDTO) => void;
}) {
  const text = useText();
  const [form, setForm] = useState<WebhookFormState>(() => formFromEndpoint(endpoint));
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const isEdit = Boolean(endpoint);
  const save = useMutation({
    mutationFn: () => {
      const body = formPayload(form);
      return isEdit
        ? patchJSON<WebhookEndpointDTO>(`/api/webhooks/${endpoint!.id}`, body)
        : postJSON<WebhookEndpointDTO>('/api/webhooks', body);
    },
    onSuccess: (data) => {
      toast.success(isEdit ? text.webhooks.saved : text.webhooks.created);
      onSaved(data);
    },
    onError: (error) => toast.error(error.message)
  });

  useEffect(() => setForm(formFromEndpoint(endpoint)), [endpoint]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  return (
    <DialogShell
      as="form"
      className="modal-panel automation-dialog"
      titleId="webhook-editor-title"
      descriptionId="webhook-editor-desc"
      onClose={onClose}
      onSubmit={submit}
      initialFocusRef={nameInputRef}
    >
        <div className="modal-header">
          <div>
            <h2 id="webhook-editor-title">{isEdit ? text.webhooks.editTitle : text.webhooks.createTitle}</h2>
            <p id="webhook-editor-desc">{text.webhooks.dialogDesc}</p>
          </div>
          <IconButton title={text.common.close} onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        <div className="automation-form">
          <label className="api-key-field">
            {text.webhooks.name}
            <input ref={nameInputRef} className="input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
          </label>
          <label className="api-key-field">
            {text.webhooks.url}
            <input className="input" type="url" value={form.url} placeholder={text.webhooks.urlPlaceholder} onChange={(event) => setForm({ ...form, url: event.target.value })} required />
          </label>
          <label className="check-row automation-check-row">
            <input type="checkbox" checked={form.messageReceived} onChange={(event) => setForm({ ...form, messageReceived: event.target.checked })} />
            {text.webhooks.eventMessageReceived}
          </label>
          <div className="api-key-field">
            {text.webhooks.scope}
            <div className="segmented-control">
              {(['all', 'domain', 'mailbox'] as const).map((scope) => (
                <button
                  type="button"
                  key={scope}
                  className={`segment-choice ${form.scope === scope ? 'segment-choice-active' : ''}`}
                  onClick={() => setForm({ ...form, scope })}
                >
                  {scope === 'all' ? text.webhooks.scopeAll : scope === 'domain' ? text.webhooks.scopeDomain : text.webhooks.scopeMailbox}
                </button>
              ))}
            </div>
          </div>
          {form.scope === 'domain' && (
            <label className="api-key-field">
              {text.webhooks.domainId}
              <input className="input" inputMode="numeric" value={form.domainId} onChange={(event) => setForm({ ...form, domainId: event.target.value })} required />
            </label>
          )}
          {form.scope === 'mailbox' && (
            <label className="api-key-field">
              {text.webhooks.mailboxId}
              <input className="input" inputMode="numeric" value={form.mailboxId} onChange={(event) => setForm({ ...form, mailboxId: event.target.value })} required />
            </label>
          )}
          <label className="check-row automation-check-row">
            <input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />
            {text.webhooks.enabled}
          </label>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>{text.common.cancel}</button>
          <button className="btn-primary" disabled={save.isPending || !form.name.trim() || !form.url.trim() || !form.messageReceived}>
            <Webhook size={16} />
            {isEdit ? text.webhooks.save : text.common.create}
          </button>
        </div>
    </DialogShell>
  );
}

function OneTimeSecretCard({ endpoint, onClose }: { endpoint: WebhookEndpointDTO; onClose: () => void }) {
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
      <button className="btn-secondary" onClick={() => { copy(endpoint.secret || ''); markCopied(); }}>
        {copied ? <Check size={16} /> : <Copy size={16} />}
        {copied ? text.common.copied : text.webhooks.copySecret}
      </button>
      <IconButton title={text.common.close} onClick={onClose}>
        <X size={14} />
      </IconButton>
    </div>
  );
}

function WebhookDeliveriesModal({ endpoint, onClose }: { endpoint: WebhookEndpointDTO; onClose: () => void }) {
  const text = useText();
  const [page, setPage] = useState(1);
  const deliveries = useQuery({
    queryKey: ['webhook-deliveries', endpoint.id, page],
    queryFn: () => api<PaginatedResponse<WebhookDeliveryDTO>>(`/api/webhooks/${endpoint.id}/deliveries?page=${page}&per_page=${DELIVERY_PER_PAGE}`),
    retry: false
  });
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

function formFromEndpoint(endpoint?: WebhookEndpointDTO): WebhookFormState {
  return {
    name: endpoint?.name || '',
    url: endpoint?.url || '',
    enabled: endpoint?.enabled ?? true,
    scope: endpoint?.scope === 'domain' || endpoint?.scope === 'mailbox' ? endpoint.scope : 'all',
    domainId: endpoint?.domain_id ? String(endpoint.domain_id) : '',
    mailboxId: endpoint?.mailbox_id ? String(endpoint.mailbox_id) : '',
    messageReceived: endpoint?.events?.includes(MESSAGE_RECEIVED) ?? true
  };
}

function formPayload(form: WebhookFormState) {
  return {
    name: form.name.trim(),
    url: form.url.trim(),
    events: form.messageReceived ? [MESSAGE_RECEIVED] : [],
    scope: form.scope,
    domain_id: form.scope === 'domain' ? Number(form.domainId) : undefined,
    mailbox_id: form.scope === 'mailbox' ? Number(form.mailboxId) : undefined,
    enabled: form.enabled
  };
}

function scopeLabel(endpoint: WebhookEndpointDTO, text: ReturnType<typeof useText>) {
  if (endpoint.scope === 'domain') return `${text.webhooks.scopeDomain} #${endpoint.domain_id || '-'}`;
  if (endpoint.scope === 'mailbox') return `${text.webhooks.scopeMailbox} #${endpoint.mailbox_id || '-'}`;
  return text.webhooks.scopeAll;
}

function deliveryStatus(delivery: WebhookDeliveryDTO, text: ReturnType<typeof useText>) {
  const cls = delivery.status === 'succeeded' ? 'status-ok' : delivery.status === 'failed' ? 'status-bad' : 'status-warn';
  return <span className={`status-pill ${cls}`}>{text.webhooks.deliveryStatus[delivery.status] || delivery.status}</span>;
}
