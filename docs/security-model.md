# Security Model

This document records intentional security boundaries so future audits can
distinguish deliberate product behavior from accidental exposure.

## API Key Reveal

HLOOL Mail intentionally supports revealing existing API keys from the Web
Console. This is a product and operations choice, not an implementation bug.

The design means:

- API key management is a Web Console session-only capability.
- API keys cannot create, list, manage, or reveal API keys.
- A signed-in owner can reveal their own API keys.
- An administrator can reveal a user's API key for support and operations.
- Reveal actions must be audited and treated as sensitive account activity.

Operational expectations:

- Treat database backups, application logs, admin sessions, and support tooling
  as sensitive because an authorized reveal path exists.
- Do not put revealed API keys in URLs, screenshots, tickets, long-lived chat
  logs, browser request history, or frontend source code.
- Prefer rotation over reveal when the operator does not need the existing key.
- If a deployment does not want recoverable API keys, disable or remove reveal
  locally and rotate existing keys after clearing stored recoverable values.

## Session And Automation Boundary

The Web Console uses the `gptmail_session` cookie for human administration.
Automation uses `X-API-Key`.

These boundaries are intentional:

- Webhook, share-link, user, admin, OAuth, passkey, notification,
  announcement, and API-key management are session-only surfaces.
- API-key automation is limited to mailbox, message, domain-selection, and
  aggregate stats routes that are explicitly listed in `docs/api-boundary.md`.
- Public shared mailbox routes must not consume API-key quota.

## Browser Write Requests

Cookie-authenticated browser write requests should be protected against CSRF.
At minimum, sensitive session writes should reject cross-site `Origin` or
`Referer` values that do not match the deployment origin.

## Webhook Delivery

Webhook delivery is server-initiated outbound HTTP. URL validation must be
enforced on the actual connection target, not only on a preflight DNS lookup,
because attacker-controlled DNS can change between validation and dialing.
