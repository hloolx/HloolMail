import type {
  AdminWebhookEndpointDTO as ApiAdminWebhookEndpointDTO,
  PaginatedResponse as ApiPaginatedResponse,
  WebhookDeliveryDTO as ApiWebhookDeliveryDTO,
  WebhookEndpointDTO as ApiWebhookEndpointDTO
} from '../../api';

export type PaginatedResponse<T> = ApiPaginatedResponse<T>;
export type AdminWebhookEndpointDTO = ApiAdminWebhookEndpointDTO;
export type WebhookDeliveryDTO = ApiWebhookDeliveryDTO;
export type WebhookEndpointDTO = ApiWebhookEndpointDTO;

export type WebhookScope = 'all' | 'domain' | 'mailbox';

export type WebhookFormState = {
  name: string;
  url: string;
  enabled: boolean;
  scope: WebhookScope;
  domainId: string;
  mailboxId: string;
  messageReceived: boolean;
};

export type WebhookFormErrors = Partial<Record<'name' | 'url' | 'events' | 'domainId' | 'mailboxId', string>>;

export type WebhookFormPayload = {
  name: string;
  url: string;
  events: string[];
  scope: WebhookScope;
  domain_id?: number;
  mailbox_id?: number;
  enabled: boolean;
};

export type WebhookEditorTarget = WebhookEndpointDTO | 'new' | null;

export type WebhookPendingAction = 'toggle' | 'test' | 'rotateSecret' | 'delete';

export type WebhookPendingTarget = {
  endpointId: number;
  action: WebhookPendingAction;
};
