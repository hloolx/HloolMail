import { useMutation, useQuery } from '@tanstack/react-query';
import type { UseMutationOptions } from '@tanstack/react-query';
import { api, patchJSON, postJSON } from '../../api';
import { queryKeys } from '../../lib/queryKeys';
import type {
  AdminWebhookEndpointDTO,
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

export const webhookKeys = queryKeys.webhooks;

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

export function fetchAdminWebhooks(query: string) {
  return api<PaginatedResponse<AdminWebhookEndpointDTO>>(`/api/admin/webhooks?${query}`);
}

export function fetchAdminWebhookDeliveries(endpointId: number, page: number, perPage = WEBHOOK_DELIVERIES_PER_PAGE) {
  return api<PaginatedResponse<WebhookDeliveryDTO>>(`/api/admin/webhooks/${endpointId}/deliveries?page=${page}&per_page=${perPage}`);
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

export function disableAdminWebhook(endpoint: AdminWebhookEndpointDTO) {
  return postJSON<AdminWebhookEndpointDTO>(`/api/admin/webhooks/${endpoint.id}/disable`, {});
}

export async function deleteAdminWebhook(endpoint: AdminWebhookEndpointDTO) {
  await api<unknown>(`/api/admin/webhooks/${endpoint.id}`, { method: 'DELETE' });
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

export function useAdminWebhooksQuery(query: string) {
  return useQuery({
    queryKey: queryKeys.admin.webhooks(query),
    queryFn: () => fetchAdminWebhooks(query),
    retry: false,
    staleTime: 30_000
  });
}

export function useAdminWebhookDeliveriesQuery(endpointId: number, page: number) {
  return useQuery({
    queryKey: queryKeys.admin.webhookDeliveries(endpointId, page),
    queryFn: () => fetchAdminWebhookDeliveries(endpointId, page),
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

export function useDisableAdminWebhookMutation(options?: MutationOptions<AdminWebhookEndpointDTO, AdminWebhookEndpointDTO>) {
  return useMutation({
    mutationFn: disableAdminWebhook,
    ...options
  });
}

export function useDeleteAdminWebhookMutation(options?: MutationOptions<void, AdminWebhookEndpointDTO>) {
  return useMutation({
    mutationFn: deleteAdminWebhook,
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
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !parsed.hostname || isBlockedWebhookHost(parsed.hostname)) {
        errors.url = webhookURLPolicyMessage(messages);
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

function webhookURLPolicyMessage(messages: WebhookValidationMessages) {
  return /[\u3400-\u9fff]/.test(messages.urlHttps)
    ? 'Webhook URL 请使用 HTTPS 公网地址，不能指向 localhost、127.0.0.1 或内网地址'
    : 'Use a public HTTPS webhook URL; localhost, 127.0.0.1, and private/internal addresses are not allowed';
}

function isBlockedWebhookHost(hostname: string) {
  const host = hostname.trim().toLowerCase().replace(/^\[(.*)\]$/, '$1');
  if (!host) return true;
  if (host === 'localhost' || host === 'metadata.google.internal' || host.endsWith('.localhost')) return true;

  const ipv4 = parseIPv4Address(host);
  if (ipv4) return isBlockedIPv4Address(ipv4);

  if (host.includes(':')) return isBlockedIPv6Address(host);

  return false;
}

function parseIPv4Address(host: string) {
  const parts = host.split('.');
  if (parts.length !== 4) return null;

  const octets = parts.map((part) => {
    if (!/^\d+$/.test(part)) return Number.NaN;
    const value = Number(part);
    return Number.isInteger(value) && value >= 0 && value <= 255 ? value : Number.NaN;
  });

  return octets.every(Number.isFinite) ? octets : null;
}

function isBlockedIPv4Address(octets: number[]) {
  const [a, b, c] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && ((b === 0 && (c === 0 || c === 2)) || b === 168)) ||
    (a === 198 && ((b === 18 || b === 19) || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function isBlockedIPv6Address(host: string) {
  const groups = parseIPv6Groups(host);
  if (!groups) return false;

  return BLOCKED_IPV6_PREFIXES.some(([prefix, bits]) => matchesIPv6Prefix(groups, prefix, bits));
}

const BLOCKED_IPV6_PREFIXES: Array<[number[], number]> = [
  [ipv6Prefix('::'), 128],
  [ipv6Prefix('::1'), 128],
  [ipv6Prefix('::ffff:0:0'), 96],
  [ipv6Prefix('64:ff9b::'), 96],
  [ipv6Prefix('100::'), 64],
  [ipv6Prefix('2001::'), 23],
  [ipv6Prefix('2001:db8::'), 32],
  [ipv6Prefix('fc00::'), 7],
  [ipv6Prefix('fe80::'), 10],
  [ipv6Prefix('ff00::'), 8]
];

function ipv6Prefix(value: string) {
  const groups = parseIPv6Groups(value);
  if (!groups) throw new Error(`Invalid IPv6 prefix: ${value}`);
  return groups;
}

function parseIPv6Groups(host: string) {
  if (host.includes('.')) return null;
  const sections = host.split('::');
  if (sections.length > 2) return null;

  const left = parseIPv6Section(sections[0]);
  const right = sections.length === 2 ? parseIPv6Section(sections[1]) : [];
  if (!left || !right) return null;

  if (sections.length === 1) return left.length === 8 ? left : null;

  const zeroCount = 8 - left.length - right.length;
  if (zeroCount < 1) return null;

  return [...left, ...Array(zeroCount).fill(0), ...right];
}

function parseIPv6Section(section: string) {
  if (!section) return [];
  const groups = section.split(':');
  const parsed = groups.map((group) => (/^[\da-f]{1,4}$/i.test(group) ? Number.parseInt(group, 16) : Number.NaN));
  return parsed.every(Number.isFinite) ? parsed : null;
}

function matchesIPv6Prefix(groups: number[], prefix: number[], bits: number) {
  const fullGroups = Math.floor(bits / 16);
  const remainingBits = bits % 16;
  for (let index = 0; index < fullGroups; index += 1) {
    if (groups[index] !== prefix[index]) return false;
  }
  if (remainingBits === 0) return true;

  const mask = (0xffff << (16 - remainingBits)) & 0xffff;
  return (groups[fullGroups] & mask) === (prefix[fullGroups] & mask);
}

function normalizeWebhookScope(scope?: string): WebhookScope {
  return scope === 'domain' || scope === 'mailbox' ? scope : 'all';
}

function isPositiveInteger(value: string) {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return false;
  return Number(normalized) > 0;
}
