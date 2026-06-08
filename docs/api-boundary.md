# API Boundary Freeze

Generated for phase 0 on 2026-05-20 from the current working tree.

This document is intentionally about boundaries, not implementation. It records the
current router surface and the API contract decisions that later phases must
preserve.

Security model notes that are intentionally broader than route ownership live
in [security-model.md](security-model.md). In particular, API key reveal is a
deliberate Web Console capability and should be audited as sensitive operator
activity rather than treated as accidental API exposure.

Phase 8 update: share is now documented as mailbox-only. API-key automation may
create a mailbox share during `POST /api/generate-email`; share-link management
remains web-session only, public shared mailbox reads skip API-key
auth/consume/log, and full share links can be regenerated but not revealed.

Phase 5 update: webhook backend routes are now implemented. Webhook management
is web-session only, API key headers are ignored on `/api/webhooks*`, SMTP only
enqueues deliveries after message storage, and delivery is handled by the
backend worker when `WEBHOOKS_ENABLED` is not `false`.

## Baseline

| Check | Command | Result |
| --- | --- | --- |
| Go tests | `go test ./...` | Passed: 138 tests in 20 packages |
| Web build | `npm run build` in `web` | Passed: TypeScript + Vite build. Vite reported the existing large chunk warning for `assets/index-*.js` |

## Hard Rules

- Do not add or document `/api/v1`. The service uses `/api/...` without a version prefix.
- Do not put SSE routes in the API-key automation OpenAPI surface.
- SSE is web-console realtime only. `/api/inbox-stream`, `/api/notification-stream`, and `/api/announcement-stream` must be session-only.
- Automation realtime delivery must use Webhooks, not SSE.
- Webhook management endpoints must be session-only.
- Share is mailbox-only in the public API and docs. Public reads use token plus mailbox access key.
- Public docs/OpenAPI/shared-token reads and session-only Web Console routes must not consume API-key quota, even if an API key header is sent.
- Ordinary workspace routes must stay owner-scoped. Admin accounts do not get cross-user data from ordinary share/mailbox/stats/webhook/domain routes.
- Cross-user or global operational views belong under `/api/admin/*` and must require an admin web session. Non-admin sessions must receive forbidden responses.
- API-key behavior must remain compatible: API keys keep their account-scoped automation surface and must not grant session-only or admin-global access.

## Boundary Matrix

| Surface | Auth | Enters API-key automation OpenAPI | Current routes | Planned or reserved routes | Notes |
| --- | --- | --- | --- | --- | --- |
| API-key automation | `X-API-Key` | Yes | `POST /api/generate-email`, `GET /api/domains/available`, mailbox routes, email routes, `GET /api/stats` | None | This is the stable automation surface for agents and scripts. `GET /api/domains/available` is the domain-selection source of truth for both public domains and API-key-accessible private domains. `generate-email` may create a mailbox share when `share` is enabled. |
| Web session | `gptmail_session` cookie | No | auth/user/passkey/OAuth identity, domain management, API-key management, share-link management, webhook management, notifications, announcements, admin, install/web setup, SSE | None | Ordinary Web Console routes are owner-scoped even for admins. API key headers must not grant access to session-only management routes. |
| Public | None | Public metadata only, not API-key automation | `GET /api/health`, `GET /api/version`, `GET /api/version/check`, `GET /api/docs.md`, `GET /api/skill.md`, `GET /api/openapi.json`, `GET /api/openapi.yaml`, `GET /api/shared/:token`, `GET /api/shared/:token/messages`, `GET /api/shared/:token/messages/:message_id`, login/register/OAuth/install bootstrap routes | None | Public docs/meta/shared mailbox read paths must skip API-key authentication and quota consumption. |

## 个人工作区 vs 管理后台

普通工作区页面和普通 API 路由只代表当前 owner 的可见范围。管理员进入普通页面时也按普通 owner scope 处理；如果需要跨用户审计、汇总或处置，必须进入管理后台并调用 `/api/admin/*`。

归位规则:

- `share`: `/api/share-links*` 只管理当前账号自己的邮箱分享；跨用户分享链接的查看、撤销、删除和访问日志只放在 `/api/admin/share-links*`，且不得返回完整 token 或 share key。
- `mailbox`: `/api/mailboxes*`、`/api/emails*`、`/api/email/*` 只返回当前 session 或 API key 有权访问的邮箱与邮件。跨用户邮箱/邮件数量只能以管理后台经过裁剪的统计字段出现，不在普通邮箱路由开放。
- `stats`: `/api/stats` 和 `/api/stats/timeseries` 是当前工作区视角；全站用户、域名、邮件、配额和调用量汇总走 `/api/admin/stats`、`/api/admin/quota-alerts` 等管理接口。
- `webhook`: `/api/webhooks*` 是当前账号的 session-only 管理面，`scope=all` 只能表示当前 owner 可见范围内的全部事件，不表示全站事件。
- `domain`: `/api/domains*` 是当前账号的域名管理面；管理员在普通域名页也只看和操作自己 owner 范围内的域名。`GET /api/domains/available` 只返回可选公共域名和当前 actor 可访问的私有域名。跨用户域名健康、MX 检测和处置走 `/api/admin/domain-health`、`/api/admin/domains/:id/*`、`/api/admin/domain-check-*`。

## API-key Automation Surface

These endpoints are allowed in the API-key automation OpenAPI group:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/domains/available` | List selectable public domains and API-key-accessible private domains. Clients should prefer `data.public_domains` and `data.private_domains`; legacy `data.domains` is public-only fallback data. |
| `POST` | `/api/generate-email` | Create or reuse a mailbox for the API-key actor. |
| `GET` | `/api/mailboxes` | List generated mailboxes. |
| `GET` | `/api/mailboxes/stats` | Read mailbox quota/usage stats visible to the actor. |
| `DELETE` | `/api/mailboxes/:id` | Delete one owned mailbox and its stored messages. |
| `GET` | `/api/emails` | List messages for an authorized mailbox. |
| `GET` | `/api/emails/next` | Poll the next unread message and mark it read. |
| `GET` | `/api/email/:id` | Read one authorized message. |
| `PATCH` | `/api/email/:id/read` | Mark one authorized message read. |
| `DELETE` | `/api/email/:id` | Delete one authorized message. |
| `DELETE` | `/api/emails/clear` | Clear messages for an authorized mailbox. |
| `GET` | `/api/stats` | Read API-key-visible aggregate stats. |

`GET /api/stats/timeseries` is registered in the router for the Web Console
only. API-key automation should use `GET /api/stats` for aggregate stats.

## Web-session Surface

These route families are web-console/session routes and must stay out of the
API-key automation OpenAPI group:

| Family | Current or planned paths | Boundary |
| --- | --- | --- |
| Webhooks | Current: `GET/POST /api/webhooks`, `PATCH/DELETE /api/webhooks/:id`, `POST /api/webhooks/:id/rotate-secret`, `POST /api/webhooks/:id/test`, `GET /api/webhooks/:id/deliveries`; admin-global: `GET /api/admin/webhooks`, `POST /api/admin/webhooks/:id/disable`, `DELETE /api/admin/webhooks/:id`, `GET /api/admin/webhooks/:id/deliveries` | Session-only owner-scoped management. Admin-global webhook routes require a logged-in admin web session, may list/disable/delete and inspect deliveries, and must not reveal or rotate webhook secrets. Delivery runtime is backend worker initiated. |
| Share-link management | Current: `POST /api/share-links`, `GET /api/share-links`, `GET /api/share-links/:id`, `PATCH /api/share-links/:id`, `DELETE /api/share-links/:id`, `POST /api/share-links/:id/revoke`, `POST /api/share-links/:id/rotate-token`, `POST /api/share-links/:id/rotate-key`, `GET /api/share-links/:id/access-logs`; admin-global: `GET /api/admin/share-links`, `POST /api/admin/share-links/:id/revoke`, `DELETE /api/admin/share-links/:id`, `GET /api/admin/share-links/:id/access-logs` | Session-only owner-scoped management for mailbox shares. Admin-global share routes require a logged-in admin web session, list and disable outward-facing links, and must not reveal full token/key values. `rotate-token` remains owner-scoped and regenerates a complete one-time mailbox access URL. |
| SSE | Current: `GET /api/inbox-stream`, `GET /api/notification-stream`, `GET /api/announcement-stream` | Session-only web realtime. Excluded from OpenAPI automation. |
| Stats charts | Current: `GET /api/stats/timeseries`; admin-global: `GET /api/admin/stats/timeseries` | Ordinary chart data is owner-scoped session-only Web Console data. Admin-global trend data requires a logged-in admin web session. API-key automation should not access either timeseries route. |
| Domain management | Current: `/api/domains`, `/api/domains/request`, `/api/domains/batch-request`, `/api/domains/check-mx`, `/api/domains/:id`, `/api/domains/:id/mx-auto-retry`; admin-global: `POST /api/admin/domains/:id/check-mx`, `PATCH /api/admin/domains/:id`, `DELETE /api/admin/domains/:id` | Ordinary domain management is owner-scoped for all users, including admins. Admin-global domain actions require a logged-in admin web session. `GET /api/domains/available` remains API-key automation and returns public domains plus actor-owned private domains only. |
| API-key management | Current: `/api/api-keys`, `/api/api-keys/:id`, `/api/api-keys/:id/reveal` | Session-only; API keys cannot create, manage, or reveal API keys. Reveal is intentional Web Console behavior; see `docs/security-model.md`. |
| Admin | Current: `/api/admin/*` including `/api/admin/users*` | Admin/session-only. Cross-user management must stay in this namespace. |
| Notifications and announcements | Current: `/api/notifications*`, `/api/announcements*` | Web-console state, not automation API. |
| Auth and account | Current: `/api/auth/*`, `/api/user/oauth-identities*`, `/api/user/passkeys*`, `/api/oauth/*` | Browser account/session flows. |
| Install/setup | Current: `/api/install*`, `/api/auth/login-settings` | Public or setup web flow, not automation API. |

Webhook and share-link management may appear in an OpenAPI document only under a
clearly labeled "Web session API" group using cookie/session auth. They must not
appear in the API-key automation group.

## Final Review Checklist

- Response field redaction: ordinary responses and admin-global responses must not expose secret material such as full share token/key, webhook secret, API key secret, or unnecessary raw message fields. Public shared mailbox detail must not expose `headers_json` and must sanitize `html_content`.
- Ordinary route owner scope: `/api/share-links*`, mailbox/email routes, `/api/stats*`, `/api/webhooks*`, and `/api/domains*` must keep owner filters for normal users and admins using ordinary pages.
- Admin route authorization: every `/api/admin/*` route must require a valid admin web session, not an API key.
- Non-admin forbidden: authenticated non-admin sessions must receive forbidden responses from admin-global routes, including share/domain/quota/audit/admin stats surfaces.
- API key compatibility: existing API-key automation endpoints, quotas, usage logging, public docs, public shared reads, and session-only route skip behavior must not regress.

## Frontend Copy Boundary

- Ordinary page labels should say "workspace", "my", "current account", or otherwise avoid implying cross-user/global visibility.
- Admin Console labels may say "global", "all users", or "cross-user" only when backed by `/api/admin/*`.
- Webhook "all" copy means all events in the current owner scope unless it appears in admin-only documentation.

## Public Surface

| Method | Path | Current status | Boundary |
| --- | --- | --- | --- |
| `GET` | `/api/docs.md` | Registered | Public, no API-key quota. |
| `GET` | `/api/skill.md` | Registered | Public, no API-key quota. |
| `GET` | `/api/openapi.json` | Registered | Public metadata, no API-key quota. |
| `GET` | `/api/openapi.yaml` | Registered | Public metadata, no API-key quota. |
| `GET` | `/api/shared/:token` | Registered | Anonymous mailbox share metadata/read by token and optional key. |
| `GET` | `/api/shared/:token/messages` | Registered | Anonymous mailbox message list by token and key. |
| `GET` | `/api/shared/:token/messages/:message_id` | Registered | Anonymous mailbox message detail by token, key, and mailbox-scoped message ID. |

## Share Boundary

Share links are mailbox-only:

- `resource_type` is `mailbox`.
- `CreateShareLinkRequest` uses `mailbox_id`.
- `PatchShareLinkRequest` updates share metadata such as `expires_at`, not credentials.
- `/api/share-links` is owner-scoped for all users, including administrators.
- `/api/admin/share-links` is the admin-global visibility and disposal surface
  for outward-facing mailbox shares. It requires a logged-in admin web session,
  must not accept token-only admin auth, and must not reveal full token/key
  values.
- Full share token/key values are one-time secrets. Management APIs can rotate
  them to produce a new complete `access_url`, but cannot reveal the old link.
- Do not add a public `POST /api/shared/:token/access` unlock path; the public
  read surface is token plus `?key=...` on GET requests.
- Public share reads use token plus mailbox access key and must not consume API-key quota.
- Public mailbox message details must not expose `headers_json`.
- Public mailbox message details must sanitize `html_content`.
- Public share reads must not change `seen`.

## Webhook Boundary

- `/api/webhooks` is owner-scoped for all users, including administrators.
- `scope=all` means all events owned by the current owner, not all users.
- Admins must not use ordinary webhook routes to list, edit, rotate, test,
  delete, or inspect deliveries for another owner's webhook.
- `/api/admin/webhooks` is the admin-global visibility and disposal surface.
  It requires a logged-in admin web session, must not accept token-only admin
  auth, must not reveal full webhook secrets or secret previews, and must not
  expose secret rotation.

## Phase 0 Route Table From `internal/http/router.go`

At phase 0, the router registered 82 explicit API routes:

| Method | Path | Router group | Handler |
| --- | --- | --- | --- |
| `GET` | `/api/health` | `api` | `health` |
| `GET` | `/api/version` | `api` | `versionInfo` |
| `GET` | `/api/version/check` | `api` | `versionCheck` |
| `GET` | `/api/auth/login-settings` | `api` | `loginSettings` |
| `GET` | `/api/install/status` | `api` | `installStatus` |
| `POST` | `/api/install/dns-check` | `api` | `installDNSCheck` |
| `POST` | `/api/install` | `api` | `install` |
| `POST` | `/api/auth/login` | `api` | `login` |
| `POST` | `/api/auth/passkeys/login/start` | `api` | `beginPasskeyLogin` |
| `POST` | `/api/auth/passkeys/login/finish` | `api` | `finishPasskeyLogin` |
| `POST` | `/api/auth/register` | `api` | `register` |
| `GET` | `/api/oauth/providers` | `api` | `listOAuthProviders` |
| `GET` | `/api/oauth/:provider/login` | `api` | `oauthRedirect` |
| `GET` | `/api/oauth/:provider/callback` | `api` | `oauthCallback` |
| `GET` | `/api/docs.md` | `api` | `apiDocsMarkdown` |
| `GET` | `/api/skill.md` | `api` | `apiSkillMarkdown` |
| `POST` | `/api/auth/logout` | `authAPI` | `logout` |
| `GET` | `/api/auth/me` | `authAPI` | `me` |
| `GET` | `/api/user/oauth-identities` | `authAPI` | `listUserOAuthIdentities` |
| `DELETE` | `/api/user/oauth-identities/:provider` | `authAPI` | `unbindUserOAuthIdentity` |
| `GET` | `/api/user/passkeys` | `authAPI` | `listUserPasskeys` |
| `POST` | `/api/user/passkeys/register/start` | `authAPI` | `beginPasskeyRegistration` |
| `POST` | `/api/user/passkeys/register/finish` | `authAPI` | `finishPasskeyRegistration` |
| `DELETE` | `/api/user/passkeys/:id` | `authAPI` | `deleteUserPasskey` |
| `GET` | `/api/stats` | `authAPI` | `stats` |
| `GET` | `/api/stats/timeseries` | `authAPI` | `statsTimeseries` |
| `GET` | `/api/emails` | `mailGroup` | `listEmails` |
| `GET` | `/api/emails/next` | `mailGroup` | `nextEmail` |
| `GET` | `/api/email/:id` | `mailGroup` | `getEmail` |
| `PATCH` | `/api/email/:id/read` | `mailGroup` | `markEmailRead` |
| `DELETE` | `/api/email/:id` | `mailGroup` | `deleteEmail` |
| `DELETE` | `/api/emails/clear` | `mailGroup` | `clearEmails` |
| `GET` | `/api/mailboxes` | `mailGroup` | `listMailboxes` |
| `GET` | `/api/mailboxes/stats` | `mailGroup` | `mailboxStats` |
| `DELETE` | `/api/mailboxes/:id` | `mailGroup` | `deleteMailbox` |
| `GET` | `/api/inbox-stream` | `api` | `inboxStream` |
| `POST` | `/api/generate-email` | `api` | `generateEmail` |
| `POST` | `/api/domains/request` | `domainGroup` | `requestDomain` |
| `POST` | `/api/domains/batch-request` | `domainGroup` | `batchRequestDomain` |
| `POST` | `/api/domains/check-mx` | `domainGroup` | `checkMX` |
| `GET` | `/api/domains` | `domainGroup` | `listDomains` |
| `GET` | `/api/domains/available` | `domainGroup` | `availableDomains` |
| `GET` | `/api/domains/:id` | `domainGroup` | `getDomain` |
| `PATCH` | `/api/domains/:id` | `domainGroup` | `patchDomain` |
| `POST` | `/api/domains/:id/mx-auto-retry` | `domainGroup` | `setDomainMXAutoRetry` |
| `DELETE` | `/api/domains/:id` | `domainGroup` | `deleteDomain` |
| `GET` | `/api/api-keys` | `apiKeyGroup` | `listAPIKeys` |
| `POST` | `/api/api-keys` | `apiKeyGroup` | `createAPIKey` |
| `PATCH` | `/api/api-keys/:id` | `apiKeyGroup` | `patchAPIKey` |
| `DELETE` | `/api/api-keys/:id` | `apiKeyGroup` | `deleteAPIKey` |
| `POST` | `/api/api-keys/:id/reveal` | `apiKeyGroup` | `revealAPIKey` |
| `GET` | `/api/notifications` | `notificationGroup` | `listNotifications` |
| `GET` | `/api/notifications/unread-count` | `notificationGroup` | `unreadNotificationCount` |
| `PATCH` | `/api/notifications/:id/read` | `notificationGroup` | `markNotificationRead` |
| `POST` | `/api/notifications/read-all` | `notificationGroup` | `markAllNotificationsRead` |
| `GET` | `/api/notification-stream` | `api` | `notificationStream` |
| `GET` | `/api/announcements` | `announcementGroup` | `listAnnouncements` |
| `GET` | `/api/announcements/unread-count` | `announcementGroup` | `unreadAnnouncementCount` |
| `PATCH` | `/api/announcements/:id/read` | `announcementGroup` | `markAnnouncementRead` |
| `GET` | `/api/announcement-stream` | `api` | `announcementStream` |
| `GET` | `/api/admin/stats` | `adminGroup` | `adminStats` |
| `GET` | `/api/admin/stats/timeseries` | `adminGroup` | `adminStatsTimeseries` |
| `GET` | `/api/admin/users` | `adminGroup` | `listUsers` |
| `POST` | `/api/admin/users` | `adminGroup` | `createUser` |
| `GET` | `/api/admin/users/:id/api-keys` | `adminGroup` | `listUserAPIKeys` |
| `POST` | `/api/admin/users/:id/api-keys/:key_id/reveal` | `adminGroup` | `revealUserAPIKey` |
| `PATCH` | `/api/admin/users/:id` | `adminGroup` | `patchUser` |
| `DELETE` | `/api/admin/users/:id` | `adminGroup` | `deleteUser` |
| `GET` | `/api/admin/domain-health` | `adminGroup` | `adminDomainHealth` |
| `POST` | `/api/admin/domains/:id/check-mx` | `adminGroup` | `adminCheckDomainMX` |
| `PATCH` | `/api/admin/domains/:id` | `adminGroup` | `patchAdminDomain` |
| `DELETE` | `/api/admin/domains/:id` | `adminGroup` | `deleteAdminDomain` |
| `GET` | `/api/admin/domain-check-settings` | `adminGroup` | `adminDomainCheckSettings` |
| `PATCH` | `/api/admin/domain-check-settings` | `adminGroup` | `patchAdminDomainCheckSettings` |
| `POST` | `/api/admin/domain-check-runs` | `adminGroup` | `createAdminDomainCheckRun` |
| `GET` | `/api/admin/domain-check-runs` | `adminGroup` | `listAdminDomainCheckRuns` |
| `GET` | `/api/admin/domain-check-runs/:id` | `adminGroup` | `getAdminDomainCheckRun` |
| `GET` | `/api/admin/oauth/providers` | `adminGroup` | `adminListOAuthProviders` |
| `PATCH` | `/api/admin/oauth/providers/:provider` | `adminGroup` | `adminUpdateOAuthProvider` |
| `GET` | `/api/admin/quota-alerts` | `adminGroup` | `adminQuotaAlerts` |
| `GET` | `/api/admin/login-settings` | `adminGroup` | `adminLoginSettings` |
| `PATCH` | `/api/admin/login-settings` | `adminGroup` | `patchAdminLoginSettings` |
| `GET` | `/api/admin/quota-settings` | `adminGroup` | `adminQuotaSettings` |
| `PATCH` | `/api/admin/quota-settings` | `adminGroup` | `patchAdminQuotaSettings` |
| `GET` | `/api/admin/audit-logs` | `adminGroup` | `adminAuditLogs` |
| `GET` | `/api/admin/announcements` | `adminGroup` | `adminListAnnouncements` |
| `POST` | `/api/admin/announcements` | `adminGroup` | `adminCreateAnnouncement` |
| `DELETE` | `/api/admin/announcements/:id` | `adminGroup` | `adminDeleteAnnouncement` |

## Current Gaps To Feed Later Phases

- Current middleware explicitly skips API-key auth for `/api/docs.md`,
  `/api/skill.md`, public OpenAPI paths, public shared-token paths, session-only
  SSE, notifications, announcements, stats timeseries, domain management paths
  except `GET /api/domains/available`, and Web Console management paths.
- Phase 1 hardened SSE routes so API-key headers are ignored on
  `/api/inbox-stream`, `/api/notification-stream`, and
  `/api/announcement-stream`; handlers remain session-only and do not consume
  API-key quota or write `APIUsageLog` rows.
