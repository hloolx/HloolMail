---
name: hlool-mail-api
description: Use HLOOL Mail public APIs to create temporary mailboxes, guide private-domain setup, read inbound emails, extract verification codes, and mark messages as read. Use when a user asks an AI agent to receive email, use HLOOL Mail, bind a custom domain for API-based receiving, poll a temporary inbox, or integrate verification-code workflows with HLOOL Mail.
---

# HLOOL Mail API

## Core Rule

Use only the documented public API. Do not reverse engineer the website, scrape the web console, guess hidden endpoints, or use undocumented authentication methods.

Protected API calls use:

```http
X-API-Key: YOUR_KEY
```

Ask the user for the HLOOL Mail base URL and API key if they are not already available. HLOOL Mail is open source and self-hostable, so do not assume a fixed official API host; the base URL should be the user's own instance, such as `https://your-hlool-mail.example`. Do not print the full API key back to the user.

This skill is for API-key automation only. Login, API-key creation, domain management, MX checks, share-link management, admin work, user management, and live streams are web-console tasks. API-key automation may request a mailbox share only during `POST /api/generate-email`.

## Workflow

1. If the user has not already supplied an exact mailbox or domain, call `GET /api/domains/available` with `X-API-Key` before creating mailboxes.
2. Treat `data.public_domains` and `data.private_domains` as the source of truth for selectable domains. Use legacy `data.domains` only as a fallback for public root-domain names.
3. Present public and private domains as grouped choices. If the user wants multiple mailboxes or wants to process several domains, support selecting multiple domains before calling `POST /api/generate-email`.
4. Do not ask the user to manually type a private domain when `data.private_domains` already contains API-key-accessible private domains.
5. For a private domain that is not listed, guide the user to add it in the web console and point DNS MX to the platform MX target. Domain management and MX verification are web-console tasks, not public API tasks.
6. Generate a mailbox with `POST /api/generate-email`, passing the selected `domain` unless the user explicitly wants a random root-domain mailbox. For subdomain mailboxes, pass `"address_type":"subdomain"` and optionally `"subdomain":"label"`; omit `subdomain` to let HLOOL Mail generate the label, and omit `domain` only when the user accepts a random available wildcard parent.
7. Ask the target service to send mail to that mailbox.
8. Poll `GET /api/emails/next?email=...` every 3 seconds until a new unread message appears.
9. If the response has `has_email=false`, wait and poll again. Stop after about 120 seconds and report a timeout.
10. If the response has `has_email=true`, extract verification codes from `message.subject`, `message.text_content`, or `message.html_content`.
11. Do not call a separate mark-read endpoint after `/api/emails/next`; it marks the returned message read automatically.

Read [references/api-reference.md](references/api-reference.md) when you need exact endpoint examples, response shapes, or error handling details.

## Private Domains

Guide the user, do not silently proceed:

- First check `GET /api/domains/available`. If `data.private_domains` has entries, offer those domains directly instead of asking the user to type them.
- Ask the user to add their domain in the HLOOL Mail web console.
- Ask the user to add the MX record shown by the product.
- Use wildcard MX only when the user needs subdomain mailboxes such as `user@abc.example.com`. `*.example.com` is a DNS/wildcard pattern, not a mailbox suffix; API clients should normally pass `domain:"example.com"` with `address_type:"subdomain"`.
- Verify API readiness by generating a mailbox on that domain.

Treat private-domain setup as successful only when `POST /api/generate-email` returns an email on that private domain and the response `domain.domain` matches the requested domain.

## Mailbox Sharing

When the user needs a shareable mailbox, pass `"share": true` or `"share": {"enabled": true}` to `POST /api/generate-email`. The response may include `data.share.url` for the share page and `data.share.access_url`, which includes `#key=...` in the URL fragment and can open the shared mailbox directly. Full token/key values are returned once and cannot be viewed again later.

Public shared mailbox reads use GET token/key endpoints:

- `GET /api/shared/:token?key=...`
- `GET /api/shared/:token/messages?key=...&page=1&per_page=20`
- `GET /api/shared/:token/messages/:message_id?key=...`

## Public Domains

Public domains are fast but less reliable with third-party websites. If the target website rejects an address or no verification email arrives, suggest:

- Generate a different mailbox.
- Try another public domain from `GET /api/domains/available` using `X-API-Key`, then read `data.public_domains` or legacy `data.domains`.
- Use a different local-part prefix.
- Wait briefly before requesting another verification email.
- Use a private domain for important or long-running automation.

## Polling Guidance

For verification-code automation, prefer `GET /api/emails/next?email=MAILBOX`. It returns either `{ "has_email": false, "message": null }` or `{ "has_email": true, "message": {...} }`. Poll every 3 seconds, stop after about 120 seconds, and stop immediately after `has_email=true`. The endpoint marks the returned message as read, so the next poll only returns another unread message. If no mail arrives, explain likely causes: target site blocked the domain, target site delayed sending, wrong mailbox address, private-domain MX not verified, or API key lacks access to that mailbox.

Use `GET /api/emails?email=...&page=1&per_page=20`, `GET /api/email/:id`, and `PATCH /api/email/:id/read` only when the user needs manual inspection or a custom flow. The `page/per_page` list form returns `{items,page,per_page,total,total_pages}` in `data`; the older `limit` form returns an array in `data`.

## Output Style

When helping a user, report the mailbox address, whether the domain is public or private, the selected domain list when multiple domains were used, the latest message status, and any extracted code. Keep implementation details brief unless the user asks for raw API traces.
