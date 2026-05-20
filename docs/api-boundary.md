# API Boundary Freeze

Generated for phase 0 on 2026-05-20 from the current working tree.

This document is intentionally about boundaries, not implementation. It records the
current router surface and the API contract decisions that later phases must
preserve.

Phase 4 update: message share backend routes are now implemented. Share
management remains web-session only, public shared-token routes skip API-key
auth/consume/log, and mailbox share remains deferred.

Phase 5 update: webhook backend routes are now implemented. Webhook management
is web-session only, API key headers are ignored on `/api/webhooks*`, SMTP only
enqueues deliveries after message storage, and delivery is handled by the
backend worker when `WEBHOOKS_ENABLED` is not `false`.

## Baseline

| Check | Command | Result |
| --- | --- | --- |
| Go tests | `rtk go test ./...` | Passed: 94 tests in 14 packages |
| Web build | `rtk npm run build` in `web` | Passed: TypeScript + Vite build. Vite reported the existing large chunk warning for `assets/index-*.js` |

## Hard Rules

- Do not add or document `/api/v1`. The service uses `/api/...` without a version prefix.
- Do not put SSE routes in the API-key automation OpenAPI surface.
- SSE is web-console realtime only. `/api/inbox-stream`, `/api/notification-stream`, and `/api/announcement-stream` must be session-only.
- Automation realtime delivery must use Webhooks, not SSE.
- Webhook management endpoints must be session-only.
- Share phase 1 is message share only. Mailbox share is phase 2.
- Public docs/OpenAPI/shared-token reads must not consume API-key quota, even if a bad API key header is sent.

## Boundary Matrix

| Surface | Auth | Enters API-key automation OpenAPI | Current routes | Planned or reserved routes | Notes |
| --- | --- | --- | --- | --- | --- |
| API-key automation | `X-API-Key` | Yes | `POST /api/generate-email`, `GET /api/domains/available`, mailbox routes, email routes, `GET /api/stats` | None | This is the stable automation surface for agents and scripts. |
| Web session | `gptmail_session` cookie | No | auth/user/passkey/OAuth identity, domain management, API-key management, share-link management, webhook management, notifications, announcements, admin, install/web setup, SSE | None | API key headers must not grant access to session-only management routes. |
| Public | None | Public metadata only, not API-key automation | `GET /api/health`, `GET /api/version`, `GET /api/version/check`, `GET /api/docs.md`, `GET /api/skill.md`, `GET /api/shared/:token`, `POST /api/shared/:token/access`, login/register/OAuth/install bootstrap routes | `GET /api/openapi.json`, `GET /api/openapi.yaml` | Public docs/meta/shared-token read paths must skip API-key authentication and quota consumption. |

## API-key Automation Surface

These endpoints are allowed in the API-key automation OpenAPI group:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/domains/available` | List public domains and API-key-accessible private domains. |
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

`GET /api/stats/timeseries` is currently registered in the router, but it is not
part of the phase 7 API-key automation list unless a later boundary review
explicitly promotes it.

## Web-session Surface

These route families are web-console/session routes and must stay out of the
API-key automation OpenAPI group:

| Family | Current or planned paths | Boundary |
| --- | --- | --- |
| Webhooks | Current: `GET/POST /api/webhooks`, `PATCH/DELETE /api/webhooks/:id`, `POST /api/webhooks/:id/rotate-secret`, `POST /api/webhooks/:id/test`, `GET /api/webhooks/:id/deliveries` | Session-only management. Delivery runtime is backend worker initiated. |
| Share-link management | Current: `POST /api/share-links`, `GET /api/share-links`, `GET /api/share-links/:id`, `PATCH /api/share-links/:id`, `POST /api/share-links/:id/revoke`, `POST /api/share-links/:id/rotate-token`, `GET /api/share-links/:id/access-logs` | Session-only management. Phase 1 resource type is `message` only. |
| SSE | Current: `GET /api/inbox-stream`, `GET /api/notification-stream`, `GET /api/announcement-stream` | Session-only web realtime. Excluded from OpenAPI automation. |
| Domain management | Current: `/api/domains`, `/api/domains/request`, `/api/domains/batch-request`, `/api/domains/check-mx`, `/api/domains/:id`, `/api/domains/:id/mx-auto-retry` | Web-console task, except `GET /api/domains/available` which is API-key automation. |
| API-key management | Current: `/api/api-keys`, `/api/api-keys/:id`, `/api/api-keys/:id/reveal` | Session-only; API keys cannot create or manage API keys. |
| Admin | Current: `/api/admin/*`, `/api/users*` | Admin/session-only. |
| Notifications and announcements | Current: `/api/notifications*`, `/api/announcements*` | Web-console state, not automation API. |
| Auth and account | Current: `/api/auth/*`, `/api/user/oauth-identities*`, `/api/user/passkeys*`, `/api/oauth/*` | Browser account/session flows. |
| Install/setup | Current: `/api/install*`, `/api/auth/login-settings` | Public or setup web flow, not automation API. |

Webhook and share-link management may later appear in an OpenAPI document only
under a clearly labeled "Web session API" group using cookie/session auth. They
must not appear in the API-key automation group.

## Public Surface

| Method | Path | Current status | Boundary |
| --- | --- | --- | --- |
| `GET` | `/api/docs.md` | Registered | Public, no API-key quota. |
| `GET` | `/api/skill.md` | Registered | Public, no API-key quota. |
| `GET` | `/api/openapi.json` | Planned | Public metadata, no API-key quota. |
| `GET` | `/api/openapi.yaml` | Planned | Public metadata, no API-key quota. |
| `GET` | `/api/shared/:token` | Registered | Anonymous read by token. Must not mark message seen. |
| `POST` | `/api/shared/:token/access` | Registered | Anonymous password/access flow. Password must not be sent in query string. |

## Share Boundary

Phase 1 share links are message-only:

- `resource_type` must be `message`.
- Public share read is anonymous token-based read only.
- Public responses must not expose `headers_json`.
- Public responses must sanitize `html_content`.
- Public share access must not change `seen`.
- Mailbox share is explicitly deferred to phase 2 because it can accidentally
  expose future mail.

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
| `GET` | `/api/users` | `userGroup` | `listUsers` |
| `POST` | `/api/users` | `userGroup` | `createUser` |
| `PATCH` | `/api/users/:id` | `userGroup` | `patchUser` |
| `DELETE` | `/api/users/:id` | `userGroup` | `deleteUser` |
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
| `GET` | `/api/admin/domain-health` | `adminGroup` | `adminDomainHealth` |
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

- Current router has no `/api/openapi.json` or `/api/openapi.yaml` routes.
- Current middleware explicitly skips API-key auth for `/api/docs.md`,
  `/api/skill.md`, public shared-token paths, session-only SSE, and webhook
  management paths; OpenAPI public paths must join the public skip list when
  implemented.
- Phase 1 hardened SSE routes so API-key headers are ignored on
  `/api/inbox-stream`, `/api/notification-stream`, and
  `/api/announcement-stream`; handlers remain session-only and do not consume
  API-key quota or write `APIUsageLog` rows.
