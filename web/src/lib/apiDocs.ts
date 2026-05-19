import type { InstallStatus } from '../api';
import { currentText } from '../locales';
import type { Language } from '../store';

export const API_DOCS_MD_PATH = '/api/docs.md';
export const API_SKILL_MD_PATH = '/api/skill.md';

export type DocAuth = 'public' | 'apiKey';
export type DocMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';
export type DocEndpoint = {
  method: DocMethod;
  path: string;
  auth: DocAuth;
  requestPath: string;
  queryTemplate?: string;
  bodyTemplate?: string;
  dangerous?: boolean;
  zhTitle: string;
  zhDesc: string;
  enTitle: string;
  enDesc: string;
};

export const API_DOC_ENDPOINTS: DocEndpoint[] = [
  {
    method: 'GET',
    path: '/api/domains/available',
    auth: 'apiKey',
    requestPath: '/api/domains/available',
    zhTitle: '可用域名',
    zhDesc: '使用 API Key 时返回可用公有域名、可访问私有域名，并保留 data.domains 兼容字段。',
    enTitle: 'Available domains',
    enDesc: 'List available public domains and API-key-accessible private domains.'
  },
  {
    method: 'POST',
    path: '/api/generate-email',
    auth: 'apiKey',
    requestPath: '/api/generate-email',
    bodyTemplate: '{\n  "prefix": "verify",\n  "domain": ""\n}',
    zhTitle: '生成邮箱',
    zhDesc: '创建邮箱；传入 domain 可指定已验证域名，不传则随机公有域名。',
    enTitle: 'Generate mailbox',
    enDesc: 'Create a mailbox. Pass domain for a verified domain, or omit it for a random public domain.'
  },
  {
    method: 'GET',
    path: '/api/mailboxes',
    auth: 'apiKey',
    requestPath: '/api/mailboxes',
    zhTitle: '邮箱列表',
    zhDesc: '列出当前 API key 所属用户创建的 mailbox。',
    enTitle: 'List mailboxes',
    enDesc: 'List mailboxes created by the API key owner.'
  },
  {
    method: 'DELETE',
    path: '/api/mailboxes/:id',
    auth: 'apiKey',
    requestPath: '/api/mailboxes/1',
    dangerous: true,
    zhTitle: '删除邮箱',
    zhDesc: '删除一个 mailbox 记录，已收到的邮件会保留。',
    enTitle: 'Delete mailbox',
    enDesc: 'Delete one mailbox record while preserving stored messages.'
  },
  {
    method: 'GET',
    path: '/api/emails?email=&limit=',
    auth: 'apiKey',
    requestPath: '/api/emails',
    queryTemplate: 'email=verify@example.com&limit=50',
    zhTitle: '读取收件箱',
    zhDesc: '按邮箱查询邮件摘要，返回主题、预览、时间和 seen 已读状态。',
    enTitle: 'Read inbox',
    enDesc: 'List message summaries by mailbox, including subject, preview, time, and seen state.'
  },
  {
    method: 'GET',
    path: '/api/emails/next?email=',
    auth: 'apiKey',
    requestPath: '/api/emails/next',
    queryTemplate: 'email=verify@example.com',
    zhTitle: '读取新邮件',
    zhDesc: '返回最新未读邮件正文并自动标记已读；没有新邮件时返回 has_email=false。',
    enTitle: 'Next unread email',
    enDesc: 'Return the newest unread message with content, mark it read automatically, or return has_email=false.'
  },
  {
    method: 'GET',
    path: '/api/email/:id',
    auth: 'apiKey',
    requestPath: '/api/email/msg-uuid',
    zhTitle: '查看邮件详情',
    zhDesc: '按邮件 ID 读取纯文本正文、headers 和 seen 已读状态。',
    enTitle: 'Read message',
    enDesc: 'Read text body, headers, and seen state for one message by ID.'
  },
  {
    method: 'PATCH',
    path: '/api/email/:id/read',
    auth: 'apiKey',
    requestPath: '/api/email/msg-uuid/read',
    zhTitle: '标记邮件已读',
    zhDesc: '把单封邮件标记为已读，返回 id 和 seen=true。',
    enTitle: 'Mark as read',
    enDesc: 'Mark one message as read and return id plus seen=true.'
  },
  {
    method: 'DELETE',
    path: '/api/email/:id',
    auth: 'apiKey',
    requestPath: '/api/email/msg-uuid',
    dangerous: true,
    zhTitle: '删除邮件',
    zhDesc: '删除当前 API key 有权限访问的一封邮件。',
    enTitle: 'Delete message',
    enDesc: 'Delete one message the API key is allowed to access.'
  },
  {
    method: 'DELETE',
    path: '/api/emails/clear?email=',
    auth: 'apiKey',
    requestPath: '/api/emails/clear',
    queryTemplate: 'email=verify@example.com',
    dangerous: true,
    zhTitle: '清空邮箱',
    zhDesc: '清空某个邮箱下的全部邮件。',
    enTitle: 'Clear inbox',
    enDesc: 'Delete all messages for one mailbox.'
  },
  {
    method: 'GET',
    path: '/api/stats',
    auth: 'apiKey',
    requestPath: '/api/stats',
    zhTitle: '统计',
    zhDesc: '获取 API key 所属用户可见的统计数据。',
    enTitle: 'Stats',
    enDesc: 'Fetch stats visible to the API key owner.'
  },
  {
    method: 'GET',
    path: '/api/docs.md',
    auth: 'public',
    requestPath: '/api/docs.md',
    zhTitle: 'Markdown 文档',
    zhDesc: '唯一的 AI Markdown 接口说明入口。',
    enTitle: 'Markdown docs',
    enDesc: 'The single AI-readable Markdown API reference link.'
  }
];

function markdownAuthLabel(auth: DocAuth) {
  return {
    public: 'None',
    apiKey: 'API key'
  }[auth];
}

function endpointMarkdownRow(endpoint: DocEndpoint) {
  return `| \`${endpoint.method}\` | \`${endpoint.path}\` | ${markdownAuthLabel(endpoint.auth)} | ${endpoint.enDesc} |`;
}

export function endpointTitle(endpoint: DocEndpoint, language: Language) {
  return language === 'zh-CN' ? endpoint.zhTitle : endpoint.enTitle;
}

export function endpointDesc(endpoint: DocEndpoint, language: Language) {
  return language === 'zh-CN' ? endpoint.zhDesc : endpoint.enDesc;
}

export function authLabel(auth: DocAuth, text = currentText()) {
  return {
    public: text.apiDocs.publicAuth,
    apiKey: text.apiDocs.apiKeyAuth
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

export function apiDocMarkdown(baseURL: string, config?: InstallStatus['config']) {
  const base = (config?.public_base_url || baseURL).replace(/\/$/, '');
  const expectedMX = (config?.expected_mx || config?.mail_hostname || 'mail.example.com').replace(/\.$/, '');
  return [
    '# HLOOL Mail API Guide for AI Assistants',
    '',
    'This document is meant for a user\'s AI assistant. Do not reverse engineer the service, guess hidden endpoints, or invent parameters. Use only the public API behavior described here.',
    '',
    `API base URL: \`${base}\``,
    `AI-readable docs: \`${base}${API_DOCS_MD_PATH}\``,
    'All HTTP endpoints use the `/api/` prefix. There is no `/api/v1` or `/api/v2` version prefix.',
    '',
    '## Authentication',
    '',
    'Use the API key header for all protected API calls:',
    '',
    '```http',
    'X-API-Key: YOUR_KEY',
    '```',
    '',
    'For API automation, use `X-API-Key` only. Domain management, MX checks, and API key creation are web-console tasks the user must complete in the product UI.',
    '',
    '## Private Domain Flow',
    '',
    'If the user wants to use a private domain such as `example.com`, guide them through this flow:',
    '',
    '1. Ask the user to add `example.com` as a private domain in the web console.',
    '2. Ask the user to add an MX record in their DNS provider pointing to the platform MX target.',
    '3. After DNS is ready, ask the user to complete MX verification in the web console.',
    '4. You can discover API-key-accessible private domains from `GET /api/domains/available` in `data.private_domains`.',
    '5. Use `POST /api/generate-email` with the private domain. If the response returns that domain, API access is working.',
    '',
    'DNS records the user should add:',
    '',
    '```dns',
    `example.com.    MX  10 ${expectedMX}.`,
    `*.example.com.  MX  10 ${expectedMX}.`,
    '```',
    '',
    'The wildcard record is only needed for subdomain mailboxes such as `user@abc.example.com`.',
    '',
    'Verify private-domain API access:',
    '',
    '```bash',
    `curl -X POST "${base}/api/generate-email" \\`,
    '  -H "Content-Type: application/json" \\',
    '  -H "X-API-Key: YOUR_KEY" \\',
    '  -d \'{"prefix":"verify","domain":"example.com"}\'',
    '```',
    '',
    'If `data.email` is `verify@example.com` and `data.domain.domain` is `example.com`, the private domain is ready for API use.',
    '',
    '## Public Domain Flow',
    '',
    'Public domains are convenient for quick testing, but some websites may block temporary-mail domains. If a website rejects the address or no verification email arrives, suggest generating a new mailbox on another public domain, using a different prefix, waiting briefly, or binding a private domain.',
    '',
    '```bash',
    `curl "${base}/api/domains/available" \\`,
    '  -H "X-API-Key: YOUR_KEY"',
    '```',
    '',
    'The API-key response keeps legacy public names in `data.domains` and also returns `data.public_domains` plus `data.private_domains` metadata. New clients should prefer the metadata arrays.',
    '',
    '```bash',
    `curl -X POST "${base}/api/generate-email" \\`,
    '  -H "Content-Type: application/json" \\',
    '  -H "X-API-Key: YOUR_KEY" \\',
    "  -d '{}'",
    '```',
    '',
    '## Reading Mail',
    '',
    'After a mailbox is generated, the target website sends email to that address. For verification-code automation, use simple polling: call `GET /api/emails/next?email=MAILBOX` every 3 seconds for up to 120 seconds. If no mail has arrived it returns `has_email=false`; if a new unread message exists it returns the message content and marks that message read automatically. Stop polling as soon as `has_email=true`.',
    '',
    '```bash',
    `curl "${base}/api/emails/next?email=verify@example.com" \\`,
    '  -H "X-API-Key: YOUR_KEY"',
    '```',
    '',
    'For a plain message list without auto-marking, use:',
    '',
    '```bash',
    `curl "${base}/api/emails?email=verify@example.com&limit=10" \\`,
    '  -H "X-API-Key: YOUR_KEY"',
    '```',
    '',
    '```bash',
    `curl "${base}/api/email/msg-uuid" \\`,
    '  -H "X-API-Key: YOUR_KEY"',
    '```',
    '',
    '```bash',
    `curl -X PATCH "${base}/api/email/msg-uuid/read" \\`,
    '  -H "X-API-Key: YOUR_KEY"',
    '```',
    '',
    'Extract verification codes from `subject`, `preview`, or `text_content`. Prefer the newest unread message from the expected sender when possible.',
    '',
    '## API Endpoints',
    '',
    '| Method | Path | Auth | Purpose |',
    '| --- | --- | --- | --- |',
    ...API_DOC_ENDPOINTS.map(endpointMarkdownRow),
    '',
    '## Response Envelope',
    '',
    '```json',
    '{',
    '  "success": true,',
    '  "data": {},',
    '  "error": null,',
    '  "usage": {',
    '    "used_today": "12",',
    '    "daily_limit": "200000",',
    '    "remaining_today": "199988",',
    '    "daily_unlimited": "false",',
    '    "total_usage": "238",',
    '    "total_limit": "0",',
    '    "remaining_total": "unlimited",',
    '    "total_unlimited": "true"',
    '  }',
    '}',
    '```',
    '',
    '`usage` appears only for API-key requests. Numeric usage values are strings so JavaScript clients can safely handle large integers. Unlimited quota is reported as `"unlimited"` in remaining fields with matching `*_unlimited` flags.',
    ''
  ].join('\n');
}
