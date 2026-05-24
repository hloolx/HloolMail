import { useMutation, useQuery } from '@tanstack/react-query';
import type { UseMutationOptions } from '@tanstack/react-query';
import { api, patchJSON, postJSON } from '../../api';
import type {
  PaginatedResponse,
  WebhookDeliveryDTO,
  WebhookEndpointDTO,
  WebhookFormErrors,
  WebhookFormPayload,
  WebhookFormState,
  WebhookScope
} from './types';

export const WEBHOOKS_PER_PAGE = 10;
export const WEBHOOK_DELIVERIES_PER_PAGE = 20;
export const MESSAGE_RECEIVED_EVENT = 'message.received';

export const webhookKeys = {
  all: ['webhooks'] as const,
  list: (page: number, perPage: number) => ['webhooks', page, perPage] as const,
  deliveriesRoot: (endpointId: number) => ['webhook-deliveries', endpointId] as const,
  deliveries: (endpointId: number, page: number) => ['webhook-deliveries', endpointId, page] as const
};

type MutationOptions<TData, TVariables> = UseMutationOptions<TData, Error, TVariables>;

type WebhookValidationMessages = Record<
  | 'nameRequired'
  | 'urlRequired'
  | 'urlInvalid'
  | 'urlHttps'
  | 'eventRequired'
  | 'domainIdRequired'
  | 'mailboxIdRequired',
  string
>;

export function fetchWebhooks(page: number, perPage = WEBHOOKS_PER_PAGE) {
  return api<PaginatedResponse<WebhookEndpointDTO>>(`/api/webhooks?page=${page}&per_page=${perPage}`);
}

export function fetchWebhookDeliveries(endpointId: number, page: number, perPage = WEBHOOK_DELIVERIES_PER_PAGE) {
  return api<PaginatedResponse<WebhookDeliveryDTO>>(`/api/webhooks/${endpointId}/deliveries?page=${page}&per_page=${perPage}`);
}

export function saveWebhook(endpointId: number | undefined, payload: WebhookFormPayload) {
  return endpointId
    ? patchJSON<WebhookEndpointDTO>(`/api/webhooks/${endpointId}`, payload)
    : postJSON<WebhookEndpointDTO>('/api/webhooks', payload);
}

export function toggleWebhookEnabled(endpoint: WebhookEndpointDTO) {
  return patchJSON<WebhookEndpointDTO>(`/api/webhooks/${endpoint.id}`, { enabled: !endpoint.enabled });
}

export function rotateWebhookSecret(endpoint: WebhookEndpointDTO) {
  return postJSON<WebhookEndpointDTO>(`/api/webhooks/${endpoint.id}/rotate-secret`, {});
}

export function testWebhook(endpoint: WebhookEndpointDTO) {
  return postJSON<WebhookDeliveryDTO>(`/api/webhooks/${endpoint.id}/test`, {});
}

export async function deleteWebhook(endpoint: WebhookEndpointDTO) {
  await api<unknown>(`/api/webhooks/${endpoint.id}`, { method: 'DELETE' });
}

export function useWebhooksQuery(page: number, perPage = WEBHOOKS_PER_PAGE) {
  return useQuery({
    queryKey: webhookKeys.list(page, perPage),
    queryFn: () => fetchWebhooks(page, perPage),
    retry: false
  });
}

export function useWebhookDeliveriesQuery(endpointId: number, page: number) {
  return useQuery({
    queryKey: webhookKeys.deliveries(endpointId, page),
    queryFn: () => fetchWebhookDeliveries(endpointId, page),
    retry: false
  });
}

export function useSaveWebhookMutation(endpoint?: WebhookEndpointDTO, options?: MutationOptions<WebhookEndpointDTO, WebhookFormState>) {
  return useMutation({
    mutationFn: (form: WebhookFormState) => saveWebhook(endpoint?.id, formPayload(form)),
    ...options
  });
}

export function useToggleWebhookMutation(options?: MutationOptions<WebhookEndpointDTO, WebhookEndpointDTO>) {
  return useMutation({
    mutationFn: toggleWebhookEnabled,
    ...options
  });
}

export function useRotateWebhookSecretMutation(options?: MutationOptions<WebhookEndpointDTO, WebhookEndpointDTO>) {
  return useMutation({
    mutationFn: rotateWebhookSecret,
    ...options
  });
}

export function useTestWebhookMutation(options?: MutationOptions<WebhookDeliveryDTO, WebhookEndpointDTO>) {
  return useMutation({
    mutationFn: testWebhook,
    ...options
  });
}

export function useDeleteWebhookMutation(options?: MutationOptions<void, WebhookEndpointDTO>) {
  return useMutation({
    mutationFn: deleteWebhook,
    ...options
  });
}

export function formFromEndpoint(endpoint?: WebhookEndpointDTO): WebhookFormState {
  return {
    name: endpoint?.name || '',
    url: endpoint?.url || '',
    enabled: endpoint?.enabled ?? true,
    scope: normalizeWebhookScope(endpoint?.scope),
    domainId: endpoint?.domain_id ? String(endpoint.domain_id) : '',
    mailboxId: endpoint?.mailbox_id ? String(endpoint.mailbox_id) : '',
    messageReceived: endpoint?.events?.includes(MESSAGE_RECEIVED_EVENT) ?? true
  };
}

export function formPayload(form: WebhookFormState): WebhookFormPayload {
  return {
    name: form.name.trim(),
    url: form.url.trim(),
    events: form.messageReceived ? [MESSAGE_RECEIVED_EVENT] : [],
    scope: form.scope,
    domain_id: form.scope === 'domain' ? Number(form.domainId) : undefined,
    mailbox_id: form.scope === 'mailbox' ? Number(form.mailboxId) : undefined,
    enabled: form.enabled
  };
}

export function validateWebhookForm(form: WebhookFormState, messages: WebhookValidationMessages): WebhookFormErrors {
  const errors: WebhookFormErrors = {};
  const name = form.name.trim();
  const url = form.url.trim();

  if (!name) errors.name = messages.nameRequired;
  if (!url) {
    errors.url = messages.urlRequired;
  } else {
    try {
      const parsed = new URL(url);
      if (!['https:', 'http:'].includes(parsed.protocol)) {
        errors.url = messages.urlInvalid;
      } else if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
        errors.url = messages.urlHttps;
      }
    } catch {
      errors.url = messages.urlInvalid;
    }
  }

  if (!form.messageReceived) errors.events = messages.eventRequired;
  if (form.scope === 'domain' && !isPositiveInteger(form.domainId)) errors.domainId = messages.domainIdRequired;
  if (form.scope === 'mailbox' && !isPositiveInteger(form.mailboxId)) errors.mailboxId = messages.mailboxIdRequired;

  return errors;
}

function normalizeWebhookScope(scope?: string): WebhookScope {
  return scope === 'domain' || scope === 'mailbox' ? scope : 'all';
}

function isPositiveInteger(value: string) {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return false;
  return Number(normalized) > 0;
}
