# HLOOL Mail Security Audit Results - 2026-05-21

> Target: `https://email.hlool.cc/`
> Mode: low-risk online audit plus local static review.
> Production data handling: sensitive values are redacted. Full API keys, mailbox addresses, message content, share links, cookies, and secrets are intentionally omitted.

## Executive Summary

Overall result: partial pass with important follow-up fixes.

Confirmed good:

- Public bootstrap endpoints did not expose runtime secrets.
- Turnstile is enabled and rejected login attempts without a token before password verification.
- API key-only access was rejected for API key management, share-link management, webhook management, admin stats, and announcements.
- Public OpenAPI/docs/skill did not expose removed old share-password contract strings.

Needs attention:

- Production frontend assets still contain hidden development install/default credential strings.
- The one-time audit key has broad visibility and must be deleted or revoked after this pass.
- Notifications accepted API key access during the audit; local code is now updated to make notification REST cookie/session-only, pending deployment verification.
- `GET /api/stats/timeseries`, `/api/domains*` domain-management paths, and `/api/announcements*` are now locally updated to be cookie/session-only, pending deployment verification. `GET /api/domains/available` remains API-key accessible.
- Invalid API key attempts now have a local pre-auth IP/global limiter and redacted failure logging, pending deployment verification.

Immediate next actions:

1. Delete or revoke the one-time audit key, then confirm a harmless API-key request returns `401` or `403`.
2. Remove hidden development install/default account strings from production frontend builds.
3. Rebuild and redeploy, then confirm production assets no longer contain default development credential or hidden install bypass strings.
4. Deploy the notification REST cookie/session-only fix and verify API key-only requests return `401`.
5. Deploy the web-session boundary and invalid API-key pre-auth limiter changes, then verify production behavior.

## 1. Scope Completed

Completed in this pass:

- Public read-only API checks.
- API key read-only checks with the one-time audit key.
- API key boundary checks against session/admin management routes.
- Low-count negative checks for invalid API key, fake login, and invalid share token.
- Production OpenAPI/docs keyword checks for removed or unsafe share/password contract text.
- Production frontend asset keyword check for hidden install/default-account leftovers and old share unlock strings.
- Sub-agent review of the audit plan and result interpretation.
- Beginner-friendly Chinese report added at `docs/SECURITY_AUDIT_REPORT_CN_2026-05-21.md`.

Not performed:

- No delete, clear, rotate, reveal, install, user mutation, OAuth mutation, or password-change requests.
- No Webhook creation or outbound Webhook delivery tests.
- No SMTP production abuse/load tests.
- No SSE connection tests.
- No real-user mailbox content inspection.

## 2. Credential Handling

- The provided key was treated as a one-time audit key.
- The full key is not written in this report.
- The key should be deleted or revoked after this audit pass.
- Audit key lifecycle status: deletion/revocation is still pending owner confirmation.
- Suggested verification after deletion: repeat one harmless API-key request such as `GET /api/stats` and confirm it returns `401` or `403`.
- One command returned sensitive mailbox data while checking `/api/mailboxes`; that raw response was not saved into this report. The finding is recorded only as "sensitive output exists for this endpoint when using this audit key."

## 2.1 Scope Guardrail

This pass stayed inside the low-risk audit boundary:

- The negative login and invalid API key checks were low-count boundary checks, not brute-force tests.
- No `X-Forwarded-For` bypass test was run against production.
- No production Webhook, SMTP, or SSE stress check was run.
- No destructive API request was sent.

## 3. Public Endpoint Results

| ID | Endpoint | Auth | Status | Result |
| --- | --- | --- | ---: | --- |
| PUB-001 | `GET /api/health` | none | 200 | OK, JSON status only |
| PUB-002 | `GET /api/version` | none | 200 | Version reported as `0.1.13` |
| PUB-003 | `GET /api/version/check` | none | 200 | Current/latest both `0.1.13`, no update |
| PUB-004 | `GET /api/auth/login-settings` | none | 200 | Installed=true, Turnstile=true, Passkey=true, 1 OAuth provider |
| PUB-005 | `GET /api/install/status` | none | 200 | Installed=true; public config fields only: expected MX, mail hostname, public base URL |
| PUB-012 | `GET /api/oauth/providers` | none | 200 | 1 provider listed |
| PUB-015 | `GET /api/docs.md` | none | 200 | Public Markdown docs returned |
| PUB-016 | `GET /api/skill.md` | none | 200 | Public skill doc returned |
| PUB-017 | `GET /api/openapi.json` | none | 200 | Public OpenAPI JSON returned |
| PUB-018 | `GET /api/openapi.yaml` | none | 200 | Public OpenAPI YAML returned |

Public endpoint conclusion:

- No database URL, session secret, inbox token secret, or private runtime config was observed in public bootstrap responses.
- Login protection is configured with Turnstile and Passkey enabled.

## 4. API Key Read-Only Results

| ID | Endpoint | Status | Result |
| --- | --- | ---: | --- |
| KEY-001 | `GET /api/domains/available` | 200 | 6 public domains and 1 private domain visible to the audit key |
| KEY-002 | `GET /api/stats` | 200 | Scoped stats returned: 7 domains, 303 mailboxes, 411 messages, 2 API keys, 6 public domains |
| KEY-003 | `GET /api/stats/timeseries?days=7` | 200 | 7 data points returned during audit; local code now expects API key-only requests to return 401 after deployment |
| KEY-004 | `GET /api/mailboxes` | 200 | Sensitive output: full mailbox list is available to this audit key; raw output omitted |
| KEY-005 | `GET /api/mailboxes/stats` | 200 | Quota/stat fields returned |
| KEY-006 | `GET /api/emails` without required email query | 400 | Rejected with `valid email required` |
| KEY-009 | `GET /api/domains` | 200 | 7 domains visible during audit; local code now expects API key-only requests to return 401 after deployment |

API key read-only conclusion:

- The audit key has broad visibility, including private domain visibility and mailbox listing.
- This may be acceptable for an intentionally broad one-time audit key, but would be too broad for a normal automation key unless the key owner is meant to have that scope.
- `GET /api/stats/timeseries` and `GET /api/domains` were accessible with API key during the audit. Product decision is now cookie/session-only; local code has been updated and should be verified after deployment.

## 5. API Key Boundary Checks

| ID | Endpoint | Auth Used | Status | Result |
| --- | --- | --- | ---: | --- |
| AKM-006 | `GET /api/api-keys` | API key only | 401 | Rejected with `login required` |
| SHM-010 | `GET /api/share-links` | API key only | 401 | Rejected with `login required` |
| WH-008 | `GET /api/webhooks` | API key only | 401 | Rejected with `login required` |
| ADM-001-keyonly | `GET /api/admin/stats` | API key only | 403 | Rejected with `admin token required` |
| NOT-001 | `GET /api/notifications` | API key | 200 | Accepted during audit; local code now expects API key-only requests to return 401 after deployment |
| NOT-002 | `GET /api/notifications/unread-count` | API key | 200 | Accepted during audit; local code now expects API key-only requests to return 401 after deployment |
| ANN-004 | `GET /api/announcements` | API key only | 401 | Rejected with `login required` |

Boundary conclusion:

- API key management, share-link management, webhook management, admin stats, and announcements are not accessible with API key alone.
- Notifications were accessible with API key during the audit. Product decision is now cookie/session-only; local code has been updated and should be verified after deployment.

## 6. Negative Auth Checks

| ID | Check | Count | Statuses | Result |
| --- | --- | ---: | --- | --- |
| AUTH-invalid-api-key | Invalid API key to `GET /api/stats` | 3 | 401, 401, 401 | All rejected as `api key invalid`; no 429 observed within 3 requests |
| AUTH-fake-login | Fake login without Turnstile token | 3 | 400, 400, 400 | All blocked by `turnstile verification required` before password check |
| SHR-invalid-token | Invalid share token | 1 | 404 | Generic `share link not found` |

Negative auth conclusion:

- Requests without a Turnstile token were observed being rejected before password verification; no brute-force or credential-stuffing proof was performed.
- Invalid share token behavior is generic and low information.
- Invalid API key attempts are rejected, but no throttling was visible within 3 requests. Per the plan, this is not a standalone proof of vulnerability; combined with static review, it remains a hardening item because invalid API key authentication happens before route-level rate limiting.

## 7. OpenAPI And Public Docs Checks

Checked production `openapi.json`, `docs.md`, and `skill.md` for these removed or unsafe strings:

- `/api/v1`
- `/api/shared/{token}/access`
- `/api/shared/:token/access`
- `password_required`
- `clear_password`
- `message share`
- `邮件分享`

Result:

- No forbidden keyword hits were found.
- This suggests production public docs match the newer mailbox-share contract and do not expose the old message-share/password unlock contract.

## 7.1 Production Frontend Asset Check

Checked the production homepage and one loaded JavaScript asset:

| Asset | Result |
| --- | --- |
| `/assets/index-BbPg-FPW.js` | Contains default development credential and hidden install bypass strings; did not hit old share/password keywords in this keyword pass |

Frontend asset conclusion:

- The production frontend bundle still contains the hidden development install shortcut/default credential strings.
- Current production is already installed, so `POST /api/install` should reject normal reinstall attempts.
- Even so, default-account/dev-install logic should not be shipped in production frontend assets.

## 8. Findings

### Finding 0: Production frontend contains hidden dev install/default credential strings

Severity: High.

Evidence:

- Production JS asset `/assets/index-BbPg-FPW.js` contains a default development credential string. The exact string is redacted from this report to reduce secondary exposure.
- The same asset contains a hidden install bypass flag string. The exact string is redacted from this report to reduce secondary exposure.
- Earlier static review linked these strings to a hidden install shortcut and default development administrator flow.

Impact:

- A production client bundle exposes default credential and hidden install behavior.
- On a fresh, reset, or misdetected installation state, this could become a real default-admin creation path.
- Even when backend install protection blocks it on the current live instance, this is a serious release hygiene and trust issue.

Recommendation:

- Remove the hidden development install shortcut from production builds.
- Ensure production build artifacts do not contain default development credentials, hidden install bypass flags, or default admin copy.
- Add a build/release check that fails if these strings appear in production assets.
- Keep backend protection that refuses install after an admin exists.

### Finding 1: Audit key has broad visibility

Severity: Medium, or High if this key is not intentionally admin-like.

Evidence:

- `GET /api/domains/available` returned both public and private domain visibility.
- `GET /api/stats` returned broad system/account counts.
- `GET /api/mailboxes` returned a full mailbox list to the audit key.

Impact:

- If this key leaks, mailbox addresses and account-level operational data are exposed.
- The key has unlimited usage according to returned usage metadata.

Recommendation:

- Delete or revoke this one-time audit key after the audit.
- For future audits, create a temporary key with the smallest possible scope and expiry.
- For normal automation keys, avoid broad visibility unless it is required.

### Finding 2: Notification REST accepted API key during audit

Severity: Medium.

Evidence:

- `GET /api/notifications` returned 200 with API key.
- `GET /api/notifications/unread-count` returned 200 with API key.
- Both responses included API usage metadata, meaning the API key path was active.

Impact:

- Documentation and code comments describe notifications as Web Console state.
- If API key access is not intended, this exposes user notification metadata outside the session-only surface.

Recommendation:

- Product decision: notification REST is Web Console cookie/session-only.
- Local remediation: `/api/notifications*` is skipped by API-key middleware, notification handlers require session login, and regression tests cover API key-only rejection plus no quota/log consumption.
- Deployment verification: after release, confirm API key-only requests to `/api/notifications*` return `401 login required` while cookie session requests still work.

### Finding 2a: Session-only announcement route likely authenticated and consumed API key before rejecting

Severity: Low.

Evidence:

- `GET /api/announcements` with API key returned `401 login required`.
- Static review shows announcements are not in the API-key skip list, while handlers require login.

Impact:

- A valid API key may be authenticated, quota-consumed, and usage-logged before a route that ultimately rejects with `login required`.
- This is not direct data exposure, but it makes session-only boundaries less clean.

Recommendation:

- Local remediation: `/api/announcements*` is skipped by API-key middleware, handlers require session login, and regression tests cover API key-only rejection plus no quota/log consumption.
- Deployment verification: after release, confirm API key-only requests to `/api/announcements*` return `401 login required` while cookie session requests still work.

### Finding 3: `stats/timeseries` and `domains` were API-key accessible during audit

Severity: Low to Medium, depending on intended contract.

Evidence:

- `GET /api/stats/timeseries?days=7` returned 200 with API key.
- `GET /api/domains` returned 200 with API key.

Impact:

- Earlier boundary docs treat `stats/timeseries` as not part of the stable API-key automation surface.
- Domain management is mostly described as Web Console work, except `domains/available`.

Recommendation:

- Product decision: `GET /api/stats/timeseries` and `/api/domains*` domain-management paths are Web Console cookie/session-only.
- Local remediation: these paths are skipped by API-key middleware, relevant handlers require session login, and regression tests cover API key-only rejection plus no quota/log consumption.
- `GET /api/domains/available` remains API-key accessible for automation.
- Deployment verification: after release, confirm API key-only requests to these paths are rejected while cookie session requests still work.

### Finding 4: Invalid API key rejection lacked visible low-count throttle during audit

Severity: Low to Medium hardening item.

Evidence:

- Three invalid API key requests all returned 401.
- No 429 appeared within 3 requests.
- Static review already showed optional API key auth runs before route-level rate limit.

Impact:

- Attackers may be able to repeatedly force API key lookup work.
- The low-count online test does not prove exploitability, but the design deserves a pre-auth/IP throttle.

Recommendation:

- Local remediation: API key auth attempts pass through a cheap IP/global limiter before API key authentication.
- Local remediation: failed API key authentication logs only a short fingerprint, source IP, path, and reason; it does not log the attempted key.
- Responses remain generic: invalid keys continue to return `api key invalid`; pre-auth limiter returns `rate limit exceeded`.
- Deployment verification: after release, repeated invalid API key requests should eventually return `429`.

## 9. Confirmed Good Points

- Public install status on an installed system did not expose database URL or secrets.
- Requests without a Turnstile token were rejected before password verification.
- API key-only access was rejected for API key management, share-link management, webhook management, admin stats, and announcements.
- Production OpenAPI/docs/skill did not contain removed old share unlock/password contract strings.
- Invalid share token returned a generic 404.

## 10. Open Items

- Need a session/admin browser audit if the owner wants Web Console route verification.
- Need local-only or controlled-environment Webhook SSRF tests; no production SSRF test was run.
- Need local-only SMTP abuse tests; no production SMTP load test was run.
- Need source/build cleanup for previously found hidden install shortcut and local secret artifacts.
- Delete or revoke the one-time audit key after review.

## 11. Sub-Agent Cross-Check Summary

Two review passes checked the interpretation of the findings.

Agreed conclusions:

- The result should be reported as a partial pass, not a full pass.
- The production frontend development/default-account strings should be treated as High priority.
- Notification, announcement, stats timeseries, and domain-management API-key access were boundary issues and are now explicitly designed as cookie/session-only in local code.
- `stats/timeseries` and `domains` API-key access should be documented or restricted.
- The audit key's broad visibility is acceptable only if it is truly temporary and is revoked after the audit.
- Low-risk online checks are not brute-force proof; the report should describe observed protection and hardening needs.
