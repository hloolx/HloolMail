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
  { method: 'GET', path: '/api/docs.md', auth: 'public', requestPath: '/api/docs.md', title: 'Markdown 文档', description: '读取适合 AI 阅读的 Markdown API 参考。' },
  { method: 'GET', path: '/api/domains/available', auth: 'apiKey', requestPath: '/api/domains/available', title: '可用域名', description: '列出公共域名和当前 API Key 可访问的私有域名。' },
  { method: 'DELETE', path: '/api/email/:id', auth: 'apiKey', requestPath: '/api/email/msg-uuid', dangerous: true, title: '删除邮件', description: '删除当前 API Key 可访问的一封邮件。' },
  { method: 'GET', path: '/api/email/:id', auth: 'apiKey', requestPath: '/api/email/msg-uuid', title: '读取邮件', description: '读取一封邮件的正文、邮件头、已读状态和附件元数据。' },
  { method: 'PATCH', path: '/api/email/:id/read', auth: 'apiKey', requestPath: '/api/email/msg-uuid/read', title: '标记已读', description: '将一封邮件标记为已读。' },
  { method: 'GET', path: '/api/emails', auth: 'apiKey', requestPath: '/api/emails', queryTemplate: 'email=verify@example.com&page=1&per_page=20', title: '邮件列表', description: '列出邮箱邮件，不会自动标记已读。' },
  { method: 'DELETE', path: '/api/emails/clear', auth: 'apiKey', requestPath: '/api/emails/clear', queryTemplate: 'email=verify@example.com', dangerous: true, title: '清空收件箱', description: '删除一个邮箱中的全部邮件。' },
  { method: 'GET', path: '/api/emails/next', auth: 'apiKey', requestPath: '/api/emails/next', queryTemplate: 'email=verify@example.com', title: '下一封未读邮件', description: '轮询最新未读邮件，并自动标记为已读。' },
  { method: 'POST', path: '/api/generate-email', auth: 'apiKey', requestPath: '/api/generate-email', bodyTemplate: '{\n  "prefix": "verify",\n  "domain": "",\n  "share": false\n}', title: '生成邮箱', description: '创建邮箱，可同时生成带访问 key 的一次性分享 URL。' },
  { method: 'GET', path: '/api/health', auth: 'public', requestPath: '/api/health', title: '健康状态', description: '检查 API 服务是否可访问。' },
  { method: 'DELETE', path: '/api/mailboxes/:id', auth: 'apiKey', requestPath: '/api/mailboxes/45', dangerous: true, title: '删除邮箱', description: '删除一个邮箱记录及其已存储邮件。' },
  { method: 'GET', path: '/api/mailboxes', auth: 'apiKey', requestPath: '/api/mailboxes', queryTemplate: 'page=1&per_page=20', title: '邮箱列表', description: '列出 API Key 拥有者创建的邮箱。' },
  { method: 'GET', path: '/api/openapi.json', auth: 'public', requestPath: '/api/openapi.json', title: 'OpenAPI JSON', description: '读取机器可读的 OpenAPI 文档。' },
  { method: 'GET', path: '/api/openapi.yaml', auth: 'public', requestPath: '/api/openapi.yaml', title: 'OpenAPI YAML', description: '读取 YAML 格式的机器可读 OpenAPI 文档。' },
  { method: 'GET', path: '/api/shared/:token', auth: 'public', requestPath: '/api/shared/share-hloolmail_xxx', queryTemplate: 'key=sharekey-hloolmail_xxx', title: '读取分享邮箱', description: '打开分享 token；邮箱分享使用 share key 访问。' },
  { method: 'GET', path: '/api/shared/:token/messages', auth: 'public', requestPath: '/api/shared/share-hloolmail_xxx/messages', queryTemplate: 'key=sharekey-hloolmail_xxx&page=1&per_page=20', title: '分享邮箱邮件列表', description: '列出带 share key 的邮箱分享中的邮件。' },
  { method: 'GET', path: '/api/shared/:token/messages/:message_id', auth: 'public', requestPath: '/api/shared/share-hloolmail_xxx/messages/msg-uuid', queryTemplate: 'key=sharekey-hloolmail_xxx', title: '读取分享邮箱邮件', description: '从带 share key 的邮箱分享中读取一封邮件。' },
  { method: 'GET', path: '/api/skill.md', auth: 'public', requestPath: '/api/skill.md', title: 'Skill 指南', description: '读取 AI 助手 Skill 使用说明。' },
  { method: 'GET', path: '/api/stats', auth: 'apiKey', requestPath: '/api/stats', title: '统计信息', description: '获取 API Key 拥有者可见的统计数据。' },
  { method: 'GET', path: '/api/version', auth: 'public', requestPath: '/api/version', title: '版本信息', description: '读取服务版本元数据。' }
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
    if (!method || !path || auth === 'session' || !path.startsWith('/api/')) continue;
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
      if (!path.startsWith('/api/')) continue;
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
    public: '公开',
    apiKey: 'API Key',
    session: 'Cookie/会话'
  }[auth];
}

function endpointMarkdownRow(endpoint: DocEndpoint) {
  return `| \`${endpoint.method}\` | \`${endpoint.path}\` | ${markdownAuthLabel(endpoint.auth)} | ${endpoint.zhDesc || endpoint.enDesc} |`;
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
    '请使用这个 HLOOL Mail Skill：',
    skillURL,
    '',
    '然后读取这里的 API 参考：',
    docsURL,
    '',
    '默认只使用文档中列出的 /api/ 端点。调用受保护接口前，先向我索要 X-API-Key 和目标邮箱/域名。验证码场景中，每 3 秒调用一次 GET /api/emails/next?email=MAILBOX，最多等待 120 秒。若 has_email=false 就继续轮询；若 has_email=true，就从 message.subject、message.text_content 或 message.html_content 中提取验证码。该端点会自动将返回邮件标记为已读。'
  ].join('\n');
}

export function apiDocMarkdown(baseURL: string, config?: InstallStatus['config'], endpoints: DocEndpoint[] = API_DOC_ENDPOINTS_FALLBACK) {
  const base = (config?.public_base_url || baseURL).replace(/\/$/, '');
  const expectedMX = (config?.expected_mx || config?.mail_hostname || 'mail.example.com').replace(/\.$/, '');
  return [
    '# HLOOL Mail API 助手指南',
    '',
    '本文档由 OpenAPI projection fallback 生成。可访问时，以服务端 `/api/docs.md` 为准。',
    '',
    `API 基础 URL: \`${base}\``,
    `Markdown 文档: \`${base}${API_DOCS_MD_PATH}\``,
    `OpenAPI JSON: \`${base}${API_OPENAPI_JSON_PATH}\``,
    '',
    '## 认证',
    '',
    'API Key 自动化调用使用请求头：',
    '',
    '```http',
    'X-API-Key: YOUR_KEY',
    '```',
    '',
    '域名创建、MX 验证、登录和 API Key 创建都属于 Web Console 任务。',
    '',
    '## 私有域名流程',
    '',
    '让用户先在 Web Console 中添加并验证域名，然后调用 `POST /api/generate-email` 并传入该域名。',
    '',
    '```dns',
    `example.com.    MX  10 ${expectedMX}.`,
    `*.example.com.  MX  10 ${expectedMX}.`,
    '```',
    '',
    '## 读取邮件',
    '',
    '验证码自动化建议每 3 秒调用一次 `GET /api/emails/next?email=MAILBOX`，最多等待 120 秒。拿到 `has_email=true` 后停止；该端点会自动将返回邮件标记为已读。',
    '',
    '## API 端点',
    '',
    '| 方法 | 路径 | 认证 | 用途 |',
    '| --- | --- | --- | --- |',
    ...endpoints.map(endpointMarkdownRow),
    '',
    '## 响应信封',
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
