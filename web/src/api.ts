export type Int64String = `${number}`;
export type UsageValue = Int64String | 'true' | 'false' | 'unlimited';

export type ApiEnvelope<T> = {
  success: boolean;
  data: T;
  error?: unknown;
  usage?: Record<string, UsageValue>;
};

type OpenString = string & {};

export type PaginatedResponse<T> = {
  items: T[];
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
};

export type Domain = {
  id: number;
  domain: string;
  mode: 'public' | 'private';
  owner_id?: number;
  active: boolean;
  mx_verified: boolean;
  wildcard_enabled: boolean;
  wildcard_requested?: boolean;
  mx_auto_retry_enabled?: boolean;
  mx_auto_retry_started_at?: string;
  mx_auto_retry_until?: string;
  mx_auto_retry_next_at?: string;
  mx_auto_retry_last_at?: string;
  mx_auto_retry_count?: number;
  first_verified_at?: string;
  pending_delete_at?: string;
  last_mx_check_at?: string;
  last_mx_records?: string;
  last_check_message?: string;
  domain_expires_at?: string;
  mailbox_created_count?: number;
  health_failure_count?: number;
  health_recovery_count?: number;
  last_health_status?: string;
  last_health_run_id?: number;
  last_healthy_at?: string;
  last_unhealthy_at?: string;
  message_count?: number;
  created_at: string;
  updated_at: string;
};

export type PublicDomainItem = {
  id?: number;
  domain: string;
  mode: 'public' | 'private';
  message_count?: number;
};

export type DomainAvailability = {
  domains?: string[];
  public_domains?: PublicDomainItem[];
  private_domains?: PublicDomainItem[];
  public_unavailable_reason?: string;
};

export type MessageSummary = {
  id: string;
  recipient: string;
  from_address: string;
  from_name?: string;
  subject: string;
  verification_code?: string;
  seen: boolean;
  preview: string;
  attachment_count?: number;
  created_at: string;
  expires_at: string;
};

/** SSE event pushed via /api/inbox-stream — matches backend events.MessageEvent */
export type InboxSSEEvent = {
  id: string;
  recipient: string;
  subject: string;
  from: string;
  created_at: string;
};

/** Parse an RFC 5322 "From" value (e.g. "Name <addr>" or "addr") into parts. */
export function parseFromAddress(from: string): { from_address: string; from_name?: string } {
  const match = from.match(/^\s*(.+?)\s*<([^>]+)>\s*$/);
  if (match) {
    return { from_name: match[1].trim(), from_address: match[2].trim() };
  }
  return { from_address: from.trim() };
}

export type MessageDetail = {
  id: string;
  recipient: string;
  from_address: string;
  from_name?: string;
  subject: string;
  verification_code?: string;
  seen: boolean;
  text_content?: string;
  html_content?: string;
  headers_json?: string;
  attachment_count?: number;
  attachments?: AttachmentMetadata[];
  created_at: string;
  expires_at: string;
};

export type AttachmentMetadata = {
  id: string;
  message_id?: string;
  sequence: number;
  filename?: string;
  content_type?: string;
  disposition?: string;
  content_id?: string;
  transfer_encoding?: string;
  size_bytes: number;
  sha256?: string;
  inline: boolean;
  created_at: string;
};

export type ShareResourceType = 'mailbox' | (string & {});

export type ShareLinkDTO = {
  id: number;
  resource_type: ShareResourceType;
  mailbox_id?: number;
  mailbox_email?: string;
  token?: string;
  access_key?: string;
  token_prefix: string;
  share_url?: string;
  access_url?: string;
  key_set?: boolean;
  expires_at?: string;
  revoked_at?: string;
  access_count: number;
  last_accessed_at?: string;
  created_at: string;
  updated_at: string;
};

export type AdminShareLinkDTO = {
  id: number;
  resource_type: ShareResourceType;
  mailbox_id?: number;
  token_prefix: string;
  key_set?: boolean;
  expires_at?: string;
  revoked_at?: string;
  access_count: number;
  last_accessed_at?: string;
  created_at: string;
  updated_at: string;
  owner_id: number;
  owner_email?: string;
  owner_role?: 'user' | 'admin' | OpenString;
  mailbox_email?: string;
  mailbox_owner_id?: number;
};

export type ShareLinkAccessLogDTO = {
  id: number;
  share_link_id: number;
  resource_type: ShareResourceType;
  mailbox_id?: number;
  success: boolean;
  failure_reason?: string;
  ip: string;
  user_agent: string;
  created_at: string;
};

export type PublicSharedMailboxMetadata = {
  id: number;
  email: string;
  local_part?: string;
  host?: string;
  domain_id?: number;
  message_count?: number;
  last_message_at?: string;
  created_at?: string;
};

export type PublicSharedLocked = {
  resource_type: ShareResourceType;
  token_prefix: string;
  key_required?: boolean;
  locked?: boolean;
  expires_at?: string;
  mailbox?: PublicSharedMailboxMetadata;
};

export type PublicSharedMailbox = {
  resource_type: 'mailbox';
  token_prefix?: string;
  expires_at?: string;
  mailbox: PublicSharedMailboxMetadata;
};

export type PublicSharedMailboxMessage = {
  id: string;
  recipient: string;
  from_address: string;
  from_name?: string;
  subject: string;
  verification_code?: string;
  text_content?: string;
  html_content?: string;
  attachments: AttachmentMetadata[];
  created_at: string;
  expires_at: string;
  seen?: boolean;
  preview?: string;
  headers_json?: string;
  attachment_count?: number;
};

export type PublicSharedResponse = PublicSharedLocked | PublicSharedMailbox;

export type WebhookEndpointDTO = {
  id: number;
  name: string;
  url: string;
  secret?: string;
  secret_preview?: string;
  enabled: boolean;
  events: string[];
  scope: 'all' | 'domain' | 'mailbox' | OpenString;
  domain_id?: number;
  mailbox_id?: number;
  last_success_at?: string;
  last_failure_at?: string;
  failure_count: number;
  disabled_at?: string;
  created_at: string;
  updated_at: string;
};

export type AdminWebhookEndpointDTO = {
  id: number;
  owner_id: number;
  owner_email?: string;
  owner_role?: 'user' | 'admin' | OpenString;
  name: string;
  url: string;
  enabled: boolean;
  events: string[];
  scope: 'all' | 'domain' | 'mailbox' | OpenString;
  domain_id?: number;
  domain_name?: string;
  mailbox_id?: number;
  mailbox_email?: string;
  last_success_at?: string;
  last_failure_at?: string;
  failure_count: number;
  disabled_at?: string;
  created_at: string;
  updated_at: string;
};

export type WebhookDeliveryDTO = {
  id: string;
  endpoint_id: number;
  event_type: string;
  message_id?: string;
  status: 'pending' | 'delivering' | 'retry' | 'succeeded' | 'failed' | OpenString;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at?: string;
  last_attempt_at?: string;
  succeeded_at?: string;
  response_status?: number;
  response_body?: string;
  error?: string;
  created_at: string;
  updated_at: string;
};

export type APIKey = {
  id: number;
  name: string;
  key_prefix: string;
  enabled: boolean;
  daily_limit: number;
  total_limit: number;
  used_today: number;
  total_used: number;
  last_used_at?: string;
  expires_at?: string;
  created_at: string;
};

export type User = {
  id: number;
  email: string;
  nickname: string;
  avatar_url?: string;
  email_verified?: boolean;
  role: 'user' | 'admin';
  enabled: boolean;
  daily_limit: number;
  total_limit: number;
  used_today: number;
  total_used: number;
  public_mailbox_created: number;
  public_mailbox_today: number;
  public_mailbox_date?: string;
  private_mailbox_created: number;
  onboarding_required?: boolean;
  onboarding_completed_at?: string;
  onboarding_skipped_at?: string;
  last_used_at?: string;
  created_at: string;
};

export type MailboxInfo = {
  id: number;
  owner_id: number;
  email: string;
  local_part: string;
  host: string;
  domain_id: number;
  message_count: number;
  last_message_at?: string;
  created_at: string;
};

export type MailboxStats = {
  public_mailbox_created: number;
  public_mailbox_today: number;
  public_mailbox_daily_limit: number;
  api_key_public_mailbox_daily_limit: number;
  private_mailbox_created: number;
  has_public_domain: boolean;
  require_public_domain: boolean;
};

export type SystemQuotaSettings = {
  id: number;
  public_domain_mailbox_limit: number;
  user_daily_public_mailbox_limit: number;
  require_public_domain_for_quota: boolean;
  enable_user_onboarding: boolean;
  created_at: string;
  updated_at: string;
};

export type UserOnboardingStatus = {
  enabled: boolean;
  required: boolean;
  require_public_domain_for_quota: boolean;
  has_ready_public_domain: boolean;
  has_mailbox: boolean;
  has_api_key: boolean;
  can_complete: boolean;
  next_step?: 'domain' | 'mailbox' | 'api-key' | 'api-docs' | OpenString;
  completed: boolean;
  skipped: boolean;
  completed_at?: string;
  skipped_at?: string;
};

export type AppNotification = {
  id: number;
  user_id?: number;
  domain_id?: number;
  type: 'MX_FAILED' | 'MX_RECOVERED' | 'DOMAIN_EXPIRING' | 'DOMAIN_EXPIRED' | OpenString;
  message: string;
  read: boolean;
  created_at: string;
};

export type InstallStatus = {
  installed: boolean;
  site_api_calls_today?: number;
  registered_users?: number;
  hosted_domains?: number;
  api_interfaces?: {
    yyds_compatibility_enabled: boolean;
  };
  config?: {
    http_addr: string;
    smtp_addr: string;
    public_base_url: string;
    mail_hostname: string;
    expected_mx: string;
    database_driver: string;
    database_url: string;
    env_path?: string;
  };
  deployment?: {
    kind: string;
    container: boolean;
    config_locked: boolean;
    config_lock_reason?: string;
  };
};

export type InstallResult = {
  installed: boolean;
  restart_required: boolean;
  env_written: boolean;
  env_error?: string;
  env_path: string;
  env_content?: string;
  deployment_kind: string;
  config_lock_reason?: string;
};

export type Announcement = {
  id: number;
  title: string;
  content: string;
  admin_id: number;
  read: boolean;
  created_at: string;
  updated_at: string;
};

export type AdminAnnouncement = Announcement & {
  reader_count: number;
  deleted_at?: string;
};

export type InstallDNSProbe = {
  source: string;
  resolver?: string;
  authoritative: boolean;
  verified: boolean;
  mx_records?: string[];
  error?: string;
};

export type InstallDNSMXCheck = {
  domain: string;
  mx_verified: boolean;
  dns_status: string;
  mx_records?: string[];
  dns_checks?: InstallDNSProbe[];
  check_message?: string;
};

export type InstallAddressCheck = {
  host: string;
  expected_ip: string;
  verified: boolean;
  addresses?: string[];
  error?: string;
};

export type InstallDNSCheckResult = {
  verified: boolean;
  domain: string;
  mail_hostname: string;
  expected_mx: string;
  address_check?: InstallAddressCheck;
  mx_check?: InstallDNSMXCheck;
  wildcard_check?: InstallDNSMXCheck | null;
  message: string;
};

type RequestOptions = RequestInit & {
  apiKey?: string;
  timeout?: number;
  retries?: number;
  retryDelay?: number;
};

export type ApiErrorKind = 'http' | 'business' | 'parse' | 'timeout' | 'abort';

type ApiErrorOptions = {
  httpStatus?: number;
  kind?: ApiErrorKind;
  error?: unknown;
};

export class ApiError extends Error {
  status: number;
  httpStatus: number;
  kind: ApiErrorKind;
  error?: unknown;

  constructor(message: string, status: number, options: ApiErrorOptions = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.httpStatus = options.httpStatus ?? status;
    this.kind = options.kind ?? 'http';
    this.error = options.error;
  }
}

const DEFAULT_TIMEOUT = 30000;
const BUSINESS_ERROR_STATUS = 422;
const pendingGetRequests = new Map<string, Promise<unknown>>();
let sessionRequestEpoch = 0;

export function clearPendingGetRequests() {
  sessionRequestEpoch += 1;
  pendingGetRequests.clear();
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const {
    apiKey,
    timeout = DEFAULT_TIMEOUT,
    retries = 0,
    retryDelay = 1000,
    ...fetchOptions
  } = options;

  if (isDedupableDefaultGet(fetchOptions)) {
    const dedupeHeaders = buildRequestHeaders(fetchOptions.headers, fetchOptions.body, apiKey);
    const dedupeKey = getDedupeKey(path, dedupeHeaders, apiKey);
    const pending = pendingGetRequests.get(dedupeKey);
    if (pending) return pending as Promise<T>;

    const request = runApiRequest<T>(path, fetchOptions, apiKey, timeout, retries, retryDelay);
    pendingGetRequests.set(dedupeKey, request);
    try {
      return await request;
    } finally {
      if (pendingGetRequests.get(dedupeKey) === request) {
        pendingGetRequests.delete(dedupeKey);
      }
    }
  }

  return runApiRequest<T>(path, fetchOptions, apiKey, timeout, retries, retryDelay);
}

async function runApiRequest<T>(
  path: string,
  fetchOptions: RequestInit,
  apiKey: string | undefined,
  timeout: number,
  retries: number,
  retryDelay: number
): Promise<T> {
  let lastError = new Error('request failed');

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const headers = buildRequestHeaders(fetchOptions.headers, fetchOptions.body, apiKey);

    let timedOut = false;
    const controller = new AbortController();
    const timeoutId = timeout > 0 ? window.setTimeout(() => {
      timedOut = true;
      abortController(controller, new DOMException('Request timed out', 'TimeoutError'));
    }, timeout) : undefined;
    const abortFromCaller = () => abortController(controller, fetchOptions.signal?.reason || new DOMException('Request aborted', 'AbortError'));
    if (fetchOptions.signal?.aborted) {
      abortFromCaller();
    } else {
      fetchOptions.signal?.addEventListener('abort', abortFromCaller, { once: true });
    }

    try {
      const response = await fetch(path, {
        ...fetchOptions,
        headers,
        signal: controller.signal,
        credentials: 'same-origin'
      });
      const raw = await response.text();
      let envelope: ApiEnvelope<T>;
      try {
        envelope = parseApiEnvelope<T>(raw);
      } catch {
        const fallback = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        const details = fallback ? `: ${fallback.slice(0, 120)}` : '';
        const message = response.ok
          ? `API ${path} returned non-JSON content. Check the backend route or sign-in state${details}`
          : fallback
            ? `Request failed (HTTP ${response.status})${details}`
            : (response.statusText || `HTTP ${response.status}`);
        throw new ApiError(message, response.status, { httpStatus: response.status, kind: 'parse' });
      }
      if (!response.ok || !envelope.success) {
        const businessFailure = response.ok && !envelope.success;
        throw new ApiError(
          String(envelope.error || response.statusText || `HTTP ${response.status}`),
          businessFailure ? BUSINESS_ERROR_STATUS : response.status,
          {
            httpStatus: response.status,
            kind: businessFailure ? 'business' : 'http',
            error: envelope.error
          }
        );
      }
      return envelope.data;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const retryable = err instanceof TypeError || err instanceof SyntaxError || timedOut;
      if (attempt < retries && retryable) {
        const delay = retryDelay * Math.pow(2, attempt) * (0.5 + Math.random() * 0.5);
        await new Promise((resolve) => window.setTimeout(resolve, delay));
        continue;
      }
      if (timedOut) {
        throw new ApiError('Request timed out', 408, { httpStatus: 408, kind: 'timeout', error: lastError });
      }
      if ((err as { name?: string })?.name === 'AbortError') {
        throw new ApiError('Request aborted', 0, { httpStatus: 0, kind: 'abort', error: lastError });
      }
      throw lastError;
    } finally {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      fetchOptions.signal?.removeEventListener('abort', abortFromCaller);
    }
  }

  throw lastError;
}

function abortController(controller: AbortController, reason: unknown) {
  try {
    controller.abort(reason);
  } catch {
    controller.abort();
  }
}

function parseApiEnvelope<T>(raw: string): ApiEnvelope<T> {
  const value = JSON.parse(raw) as unknown;
  if (!isApiEnvelope(value)) {
    throw new SyntaxError('Invalid API response envelope');
  }
  return value as ApiEnvelope<T>;
}

function isApiEnvelope(value: unknown): value is ApiEnvelope<unknown> {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'success' in value &&
      typeof (value as { success?: unknown }).success === 'boolean'
  );
}

function buildRequestHeaders(headersInit: HeadersInit | undefined, body: RequestInit['body'], apiKey?: string) {
  const headers = new Headers(headersInit);
  if (!headers.has('Content-Type') && isJSONBody(body)) {
    headers.set('Content-Type', 'application/json');
  }
  if (apiKey) headers.set('X-API-Key', apiKey);
  return headers;
}

function isJSONBody(body: RequestInit['body']) {
  return typeof body === 'string';
}

function isDedupableDefaultGet(fetchOptions: RequestInit) {
  return fetchOptions.method === undefined && fetchOptions.body == null && fetchOptions.signal === undefined;
}

function getDedupeKey(path: string, headers: Headers, apiKey?: string) {
  return JSON.stringify([
    path,
    apiKey || '',
    apiKey ? '' : sessionRequestEpoch,
    Array.from(headers.entries()).sort(([left], [right]) => left.localeCompare(right))
  ]);
}

function jsonHeaders(headersInit: HeadersInit | undefined) {
  const headers = new Headers(headersInit);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return headers;
}

export function postJSON<T>(path: string, body: unknown, options?: RequestOptions) {
  return api<T>(path, { ...options, method: 'POST', headers: jsonHeaders(options?.headers), body: JSON.stringify(body) });
}

export function patchJSON<T>(path: string, body: unknown, options?: RequestOptions) {
  return api<T>(path, { ...options, method: 'PATCH', headers: jsonHeaders(options?.headers), body: JSON.stringify(body) });
}
