import type { Domain, PaginatedResponse, PublicDomainItem, User } from '../api';

type OpenString = string & {};

export type Stats = {
  messages: number;
  domains: number;
  api_keys: number;
  mailboxes: number;
  public_domains: number;
  api_calls_today: number;
  domain_list?: PublicDomainItem[];
};

export type TimeseriesStats = {
  days: string[];
  messages: number[];
  domains: number[];
  api_calls: number[];
};

export type AdminStats = {
  messages: number;
  total_domains?: number;
  active_domains: number;
  failed_domains: number;
  pending_domains?: number;
  stale_domains?: number;
  users?: number;
  enabled_users?: number;
  disabled_users?: number;
  api_keys?: number;
  active_api_keys?: number;
  disabled_api_keys?: number;
  api_usage_today: number;
  dev_mode?: boolean;
  admin_token_enabled?: boolean;
  admin_token_is_default?: boolean;
  expected_mx?: string;
  message_retention_hours?: number;
};

export type AdminDomainHealth = Domain & {
  message_count: number;
  severity: 'ok' | 'warning' | 'critical';
  issue: string;
  owner_email?: string;
};

export type DomainCheckRun = {
  id: number;
  trigger: 'schedule' | 'manual' | OpenString;
  status: 'running' | 'success' | 'failed' | 'canceled' | OpenString;
  total: number;
  checked: number;
  passed: number;
  failed: number;
  started_at: string;
  finished_at?: string;
  error_message?: string;
};

export type DomainCheckSettings = {
  id: number;
  enabled: boolean;
  interval_minutes: number;
  timeout_ms: number;
  max_concurrency: number;
  resolver_list_json: string;
  resolvers: string[];
  check_inactive: boolean;
  failure_threshold: number;
  recovery_threshold: number;
  global_probe_enabled: boolean;
  last_run_at?: string;
  next_run_at?: string;
  last_run?: DomainCheckRun;
  recent_runs?: DomainCheckRun[];
  created_at?: string;
  updated_at?: string;
};

export type DomainCheckResultRecord = {
  id: number;
  run_id: number;
  domain_id: number;
  domain: string;
  expected_mx: string;
  mx_verified: boolean;
  wildcard_ok: boolean;
  status: string;
  mx_records_json: string;
  probes_json: string;
  error_message?: string;
  duration_ms: number;
  created_at: string;
};

export type DomainCheckRunsPage = {
  runs: DomainCheckRun[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
};

export type DomainCheckRunDetail = {
  run: DomainCheckRun;
  records: DomainCheckResultRecord[];
};

export type AdminQuotaAlert = {
  kind: 'user' | 'api_key';
  id: number;
  label: string;
  owner?: string;
  enabled: boolean;
  daily_limit: number;
  used_today: number;
  total_limit: number;
  total_used: number;
  last_used_at?: string;
  severity: 'warning' | 'critical';
  reason: string;
};

export type AuditLog = {
  id: number;
  category: 'security' | 'activity' | 'system' | OpenString;
  severity: 'info' | 'warning' | 'critical' | OpenString;
  action: string;
  actor: string;
  target_type: string;
  target_id: string;
  target: string;
  metadata?: string;
  created_at: string;
};

export type AuditLogPage = PaginatedResponse<AuditLog>;

export type OAuthProvider = {
  provider: 'github' | 'linuxdo' | OpenString;
  name: string;
  enabled: boolean;
  configured: boolean;
  auth_url: string;
  client_id?: string;
  client_secret?: string;
  redirect_url?: string;
};

export type DNSRecord = {
  type: string;
  name: string;
  priority?: number;
  value: string;
};

export type DNSInstructions = {
  mx: DNSRecord;
  wildcard_mx: DNSRecord;
};

export type DNSProbe = {
  source: string;
  resolver?: string;
  authoritative: boolean;
  verified: boolean;
  mx_records?: string[];
  error?: string;
};

export type DomainCreateResult = {
  domain: Domain;
  dns: DNSInstructions;
};

export type DomainCheckResult = {
  domain: string;
  mx_verified: boolean;
  dns_status?: 'verified' | 'propagating' | 'misconfigured' | 'not_found' | 'error';
  wildcard_enabled: boolean;
  wildcard_checked?: boolean;
  check_message?: string;
  mx_records?: string[];
  ns_records?: string[];
  a_records?: string[];
  dns_checks?: DNSProbe[];
  wildcard_dns_checks?: DNSProbe[];
  domain_expires_at?: string;
};

export type BatchDomainInput = {
  raw: string;
  domain: string;
  wildcard: boolean;
};

export type BatchDomainItemResult = {
  raw: string;
  domain: string;
  status: 'created' | 'already_exists' | 'owned_by_other' | 'invalid' | 'error';
  domain_record?: import('../api').Domain;
  dns?: DNSInstructions;
  error?: string;
};

export type BatchDomainResponse = {
  results: BatchDomainItemResult[];
};

export type MeResponse = {
  installed: boolean;
  user: User | null;
};

export type LoginSettings = {
  id: number;
  registration_open: boolean;
  email_registration_enabled: boolean;
  email_verification_mode: 'internal' | 'smtp';
  internal_sender_prefix: string;
  smtp_host: string;
  smtp_port: number;
  smtp_security: 'none' | 'starttls' | 'tls';
  smtp_username: string;
  smtp_password: string;
  smtp_from_name: string;
  smtp_from_email: string;
  turnstile_enabled: boolean;
  turnstile_site_key: string;
  turnstile_secret_key: string;
  passkey_enabled: boolean;
  updated_at?: string;
};

export type PublicLoginSettings = {
  installed: boolean;
  registration_open?: boolean;
  email_registration_enabled?: boolean;
  email_verification_mode?: 'internal' | 'smtp';
  turnstile_enabled?: boolean;
  turnstile_site_key?: string;
  passkey_enabled?: boolean;
  oauth_providers?: OAuthProvider[];
};

export type RegisterCaptcha = {
  captcha_id: string;
  challenge: string;
  expires_at: string;
};

export type RegisterResponse = {
  email_verification_required: boolean;
  verification_id: string;
  expires_at: string;
};
