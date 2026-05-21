# HLOOL Mail Security Audit Plan

> Target: production instance, exact URL kept in private operational context.
> Mode: low-risk security audit.
> Rule: do not record full API keys, cookies, share keys, mailbox lists, message bodies, or secrets.

## Red Lines

- Do not brute-force passwords, API keys, share tokens, or share keys.
- Do not run load tests or repeated loops against production.
- Do not run delete, clear, rotate, reveal, install, user mutation, OAuth mutation, password-change, Webhook delivery, SMTP abuse, or SSE stress tests without exact per-request approval.
- Do not paste full secrets into Markdown, terminal output, screenshots, or sub-agent prompts.
- Stop if a response contains real user content; record only that sensitive content appeared.

## Credential Rules

- Use a temporary one-time audit API key only.
- Delete or revoke the audit key after the audit.
- Verify deletion by retrying one harmless API-key request and expecting rejection.
- Report only redacted key labels.

## Test Record Fields

| Field | Meaning |
| --- | --- |
| ID | Stable audit ID |
| Target | `production`, `local-code`, `local-db`, or `build-artifact` |
| Method/path | API path or checked artifact |
| Auth used | `none`, `api-key-redacted`, `session`, `admin-session`, `share-token`, `not-run` |
| Count | Number of requests, usually 1 |
| Expected | Safe expected behavior |
| Actual | Status and short result |
| Sensitive output | `no`, `redacted`, or `yes-stop` |
| Risk | `critical`, `high`, `medium`, `low`, `info` |
| Verdict | `pass`, `fail`, `needs-review`, `not-run` |

## Safe Online Checks

Public read-only:

- `GET /api/health`
- `GET /api/version`
- `GET /api/version/check`
- `GET /api/auth/login-settings`
- `GET /api/install/status`
- `GET /api/oauth/providers`
- `GET /api/docs.md`
- `GET /api/skill.md`
- `GET /api/openapi.json`
- `GET /api/openapi.yaml`

API key read-only:

- `GET /api/domains/available`
- `GET /api/stats`
- `GET /api/stats/timeseries`
- `GET /api/mailboxes/stats`
- `GET /api/emails` only with approved mailbox query, otherwise test missing-query validation only
- `GET /api/domains`

API key boundary checks:

- `GET /api/api-keys` should require session.
- `GET /api/share-links` should require session.
- `GET /api/webhooks` should require session.
- `GET /api/admin/stats` should require admin session or approved admin token, not plain API key.
- `GET /api/announcements` should require session.
- `GET /api/notifications*` must be Web Console cookie/session-only.
- `GET /api/stats/timeseries` must be Web Console cookie/session-only.
- `/api/domains*` domain-management paths must be Web Console cookie/session-only, except `GET /api/domains/available`.

Low-count negative checks:

- Up to 3 invalid API key requests.
- Up to 3 fake login requests, only if Turnstile/login behavior is being verified.
- One invalid share token request.

## Static Or Local-Only Checks

- Hidden install shortcut/default credentials in source and build assets.
- `.env`, `.claude`, local DB, build, release, and ignored folders for secrets.
- Webhook SSRF validation and DNS rebinding behavior.
- SMTP size, recipient, unknown local-part, and cleanup behavior.
- Email HTML sanitizer and Markdown rendering.
- SSE connection caps and disconnect cleanup.

## Findings To Classify

Critical or High:

- Production frontend contains hidden install/default credential code.
- Any default admin can be created on production.
- Any full secret is exposed in public response or tracked artifact.

Medium:

- Broad audit key visibility.
- Notification REST accessible with API key when notifications are intended to be cookie/session-only.
- Announcement REST accessible with API key when announcements are intended to be cookie/session-only.
- Stats timeseries or domain-management paths accessible with API key when they are intended to be cookie/session-only.
- Invalid API key auth does DB/bcrypt work before cheap throttling.
- API key can access endpoints outside the documented automation surface.

Low:

- Session-only routes authenticate/consume API key before rejecting.
- Docs and implementation wording drift.

## Reporting

Use [SECURITY_AUDIT_RESULTS_2026-05-21.md](C:/Users/12153/daima/邮箱/docs/SECURITY_AUDIT_RESULTS_2026-05-21.md) as the live result record for the current pass.

For a beginner-friendly owner summary and step-by-step remediation order, use [SECURITY_AUDIT_REPORT_CN_2026-05-21.md](C:/Users/12153/daima/邮箱/docs/SECURITY_AUDIT_REPORT_CN_2026-05-21.md).

When sharing reports outside the controlled repo, redact exact default credential strings, hidden install flag names, API keys, mailbox addresses, message content, cookies, and share tokens.
