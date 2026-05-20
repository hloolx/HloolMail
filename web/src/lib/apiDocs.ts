import type { InstallStatus } from '../api';
import { currentText } from '../locales';
import type { Language } from '../store';

export const API_DOCS_MD_PATH = '/api/docs.md';
export const API_SKILL_MD_PATH = '/api/skill.md';
export const API_OPENAPI_JSON_PATH = '/api/openapi.json';
export const API_OPENAPI_YAML_PATH = '/api/openapi.yaml';

export type DocAuth = 'public' | 'apiKey' | 'session';
export type DocMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';
export type DocEndpoint = {
  method: DocMethod;
  path: string;
  auth: DocAuth;
  requestPath: string;
  queryTemplate?: string;
  bodyTemplate?: string;
  dangerous?: boolean;
  zhTitle?: string;
  zhDesc?: string;
  enTitle: string;
  enDesc: string;
};

type OpenAPIFrontendOperation = {
  method?: string;
  path?: string;
  auth?: string;
  requestPath?: string;
  queryTemplate?: string;
  bodyTemplate?: string;
  dangerous?: boolean;
  title?: string;
  description?: string;
};

type OpenAPIOperation = {
  summary?: string;
  description?: string;
  parameters?: Array<{
    name?: string;
    in?: string;
    required?: boolean;
    example?: unknown;
  }>;
  'x-hlool-auth'?: string;
};

export type OpenAPIDocument = {
  paths?: Record<string, Partial<Record<Lowercase<DocMethod>, OpenAPIOperation>>>;
  'x-hlool-frontend'?: OpenAPIFrontendOperation[];
};

// Generated fallback snapshot from internal/apispec.FrontendProjection.
// The live /api/openapi.json projection is used when available.
const GENERATED_FRONTEND_PROJECTION: OpenAPIFrontendOperation[] = [
  { method: 'GET', path: '/api/docs.md', auth: 'public', requestPath: '/api/docs.md', title: 'Markdown docs', description: 'Read the AI-readable Markdown API reference.' },
  { method: 'GET', path: '/api/domains/available', auth: 'apiKey', requestPath: '/api/domains/available', title: 'Available domains', description: 'List public domains and API-key-accessible private domains.' },
  { method: 'DELETE', path: '/api/email/:id', auth: 'apiKey', requestPath: '/api/email/msg-uuid', dangerous: true, title: 'Delete message', description: 'Delete one message the API-key actor can access.' },
  { method: 'GET', path: '/api/email/:id', auth: 'apiKey', requestPath: '/api/email/msg-uuid', title: 'Read message', description: 'Read text body, headers, read state, and attachment metadata for one message.' },
  { method: 'PATCH', path: '/api/email/:id/read', auth: 'apiKey', requestPath: '/api/email/msg-uuid/read', title: 'Mark as read', description: 'Mark one message as read.' },
  { method: 'GET', path: '/api/emails', auth: 'apiKey', requestPath: '/api/emails', queryTemplate: 'email=verify@example.com&page=1&per_page=20', title: 'List messages', description: 'List messages for a mailbox without auto-marking them read.' },
  { method: 'DELETE', path: '/api/emails/clear', auth: 'apiKey', requestPath: '/api/emails/clear', queryTemplate: 'email=verify@example.com', dangerous: true, title: 'Clear inbox', description: 'Delete all messages for one mailbox.' },
  { method: 'GET', path: '/api/emails/next', auth: 'apiKey', requestPath: '/api/emails/next', queryTemplate: 'email=verify@example.com', title: 'Next unread email', description: 'Poll for the newest unread message and mark it read automatically.' },
  { method: 'POST', path: '/api/generate-email', auth: 'apiKey', requestPath: '/api/generate-email', bodyTemplate: '{\n  "prefix": "verify",\n  "domain": ""\n}', title: 'Generate mailbox', description: 'Create a mailbox on a chosen domain or a random public domain.' },
  { method: 'GET', path: '/api/health', auth: 'public', requestPath: '/api/health', title: 'Health', description: 'Check whether the API service is reachable.' },
  { method: 'DELETE', path: '/api/mailboxes/:id', auth: 'apiKey', requestPath: '/api/mailboxes/45', dangerous: true, title: 'Delete mailbox', description: 'Delete one mailbox record and its stored messages.' },
  { method: 'GET', path: '/api/mailboxes', auth: 'apiKey', requestPath: '/api/mailboxes', queryTemplate: 'page=1&per_page=20', title: 'List mailboxes', description: 'List mailboxes created by the API-key owner.' },
  { method: 'GET', path: '/api/openapi.json', auth: 'public', requestPath: '/api/openapi.json', title: 'OpenAPI JSON', description: 'Read the machine-readable OpenAPI document.' },
  { method: 'GET', path: '/api/openapi.yaml', auth: 'public', requestPath: '/api/openapi.yaml', title: 'OpenAPI YAML', description: 'Read the machine-readable OpenAPI document as YAML.' },
  { method: 'GET', path: '/api/skill.md', auth: 'public', requestPath: '/api/skill.md', title: 'Skill guide', description: 'Read the AI assistant skill instructions.' },
  { method: 'GET', path: '/api/stats', auth: 'apiKey', requestPath: '/api/stats', title: 'Stats', description: 'Fetch stats visible to the API-key owner.' },
  { method: 'GET', path: '/api/version', auth: 'public', requestPath: '/api/version', title: 'Version', description: 'Read service version metadata.' }
];

export const API_DOC_ENDPOINTS_FALLBACK = endpointsFromProjection(GENERATED_FRONTEND_PROJECTION);

export async function fetchOpenAPIDocument(): Promise<OpenAPIDocument> {
  const response = await fetch(API_OPENAPI_JSON_PATH, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' }
  });
  if (!response.ok) throw new Error(response.statusText);
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('application/json')) {
    throw new Error('openapi endpoint did not return json');
  }
  return response.json();
}

export function docEndpointsFromOpenAPI(spec?: OpenAPIDocument | null): DocEndpoint[] {
  const projection = endpointsFromProjection(spec?.['x-hlool-frontend'] || []);
  if (projection.length > 0) return projection;
  const derived = deriveEndpointsFromPaths(spec);
  if (derived.length > 0) return derived;
  return API_DOC_ENDPOINTS_FALLBACK;
}

function endpointsFromProjection(items: OpenAPIFrontendOperation[]): DocEndpoint[] {
  const endpoints: DocEndpoint[] = [];
  for (const item of items) {
    const method = normalizeMethod(item.method);
    const path = normalizePathTemplate(item.path || item.requestPath || '');
    const auth = normalizeAuth(item.auth);
    if (!method || !path || auth === 'session') continue;
    const title = item.title || fallbackTitle(method, path);
    const description = item.description || title;
    endpoints.push({
      method,
      path,
      auth,
      requestPath: item.requestPath || requestPathFromTemplate(path),
      queryTemplate: item.queryTemplate || undefined,
      bodyTemplate: item.bodyTemplate || undefined,
      dangerous: Boolean(item.dangerous),
      enTitle: title,
      enDesc: description,
      zhTitle: title,
      zhDesc: description
    });
  }
  return endpoints;
}

function deriveEndpointsFromPaths(spec?: OpenAPIDocument | null): DocEndpoint[] {
  if (!spec?.paths) return [];
  const endpoints: DocEndpoint[] = [];
  for (const [rawPath, item] of Object.entries(spec.paths)) {
    for (const method of ['get', 'post', 'patch', 'delete'] as const) {
      const operation = item?.[method];
      if (!operation) continue;
      const auth = normalizeAuth(operation['x-hlool-auth']);
      if (auth === 'session') continue;
      const typedMethod = method.toUpperCase() as DocMethod;
      const path = normalizePathTemplate(rawPath);
      endpoints.push({
        method: typedMethod,
        path,
        auth,
        requestPath: requestPathFromTemplate(path, operation),
        queryTemplate: queryTemplateFromParameters(operation.parameters),
        enTitle: operation.summary || fallbackTitle(typedMethod, path),
        enDesc: operation.description || operation.summary || fallbackTitle(typedMethod, path),
        zhTitle: operation.summary || fallbackTitle(typedMethod, path),
        zhDesc: operation.description || operation.summary || fallbackTitle(typedMethod, path)
      });
    }
  }
  return endpoints.sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`));
}

function normalizeMethod(value?: string): DocMethod | null {
  const method = (value || '').toUpperCase();
  return method === 'GET' || method === 'POST' || method === 'PATCH' || method === 'DELETE' ? method : null;
}

function normalizeAuth(value?: string): DocAuth {
  if (value === 'apiKey' || value === 'X-API-Key') return 'apiKey';
  if (value === 'session' || value === 'cookie/session') return 'session';
  return 'public';
}

function normalizePathTemplate(path: string) {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return normalized.replace(/\{([^}]+)\}/g, ':$1');
}

function requestPathFromTemplate(path: string, operation?: OpenAPIOperation) {
  return path.replace(/:([A-Za-z0-9_]+)/g, (_match, name) => {
    const param = operation?.parameters?.find((item) => item.in === 'path' && item.name === name);
    if (typeof param?.example === 'string' || typeof param?.example === 'number') return String(param.example);
    return name === 'id' && path.includes('/email/') ? 'msg-uuid' : '1';
  });
}

function queryTemplateFromParameters(parameters?: OpenAPIOperation['parameters']) {
  const query = (parameters || [])
    .filter((item) => item.in === 'query' && (item.required || item.example !== undefined))
    .map((item) => `${encodeURIComponent(item.name || '')}=${encodeURIComponent(String(item.example ?? ''))}`)
    .filter((item) => !item.startsWith('='));
  return query.join('&') || undefined;
}

function fallbackTitle(method: DocMethod, path: string) {
  return `${method} ${path}`;
}

function markdownAuthLabel(auth: DocAuth) {
  return {
    public: 'None',
    apiKey: 'API key',
    session: 'cookie/session'
  }[auth];
}

function endpointMarkdownRow(endpoint: DocEndpoint) {
  return `| \`${endpoint.method}\` | \`${endpoint.path}\` | ${markdownAuthLabel(endpoint.auth)} | ${endpoint.enDesc} |`;
}

export function endpointTitle(endpoint: DocEndpoint, language: Language) {
  return language === 'zh-CN' ? endpoint.zhTitle || endpoint.enTitle : endpoint.enTitle;
}

export function endpointDesc(endpoint: DocEndpoint, language: Language) {
  return language === 'zh-CN' ? endpoint.zhDesc || endpoint.enDesc : endpoint.enDesc;
}

export function authLabel(auth: DocAuth, text = currentText()) {
  return {
    public: text.apiDocs.publicAuth,
    apiKey: text.apiDocs.apiKeyAuth,
    session: 'cookie/session'
  }[auth];
}

export function explorerDefaults(endpoint: DocEndpoint) {
  return {
    path: endpoint.requestPath,
    query: endpoint.queryTemplate || '',
    body: endpoint.bodyTemplate || ''
  };
}

export function apiSkillPrompt(skillURL: string, docsURL: string) {
  return [
    'Please use this HLOOL Mail skill:',
    skillURL,
    '',
    'Then read the API reference here:',
    docsURL,
    '',
    'Use only the documented /api/ endpoints. Ask me for my X-API-Key and target mailbox/domain before making protected calls. For verification codes, call GET /api/emails/next?email=MAILBOX every 3 seconds for up to 120 seconds. If has_email=false, keep polling; if has_email=true, extract the code from message.subject, message.text_content, or message.html_content. The endpoint marks the message read automatically.'
  ].join('\n');
}

export function apiDocMarkdown(baseURL: string, config?: InstallStatus['config'], endpoints: DocEndpoint[] = API_DOC_ENDPOINTS_FALLBACK) {
  const base = (config?.public_base_url || baseURL).replace(/\/$/, '');
  const expectedMX = (config?.expected_mx || config?.mail_hostname || 'mail.example.com').replace(/\.$/, '');
  return [
    '# HLOOL Mail API Guide for AI Assistants',
    '',
    'This document is generated from the OpenAPI projection fallback. The server copy at `/api/docs.md` is authoritative when available.',
    '',
    `API base URL: \`${base}\``,
    `Markdown docs: \`${base}${API_DOCS_MD_PATH}\``,
    `OpenAPI JSON: \`${base}${API_OPENAPI_JSON_PATH}\``,
    '',
    '## Authentication',
    '',
    'Use the API key header for API-key automation calls:',
    '',
    '```http',
    'X-API-Key: YOUR_KEY',
    '```',
    '',
    'Domain creation, MX verification, login, and API key creation are web-console tasks.',
    '',
    '## Private Domain Flow',
    '',
    'Ask the user to add and verify their domain in the web console, then call `POST /api/generate-email` with the requested domain.',
    '',
    '```dns',
    `example.com.    MX  10 ${expectedMX}.`,
    `*.example.com.  MX  10 ${expectedMX}.`,
    '```',
    '',
    '## Reading Mail',
    '',
    'For verification-code automation, call `GET /api/emails/next?email=MAILBOX` every 3 seconds for up to 120 seconds. Stop after `has_email=true`; the endpoint marks that message read automatically.',
    '',
    '## API Endpoints',
    '',
    '| Method | Path | Auth | Purpose |',
    '| --- | --- | --- | --- |',
    ...endpoints.map(endpointMarkdownRow),
    '',
    '## Response Envelope',
    '',
    '```json',
    '{',
    '  "success": true,',
    '  "data": {},',
    '  "error": null',
    '}',
    '```',
    ''
  ].join('\n');
}
