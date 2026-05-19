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

Ask the user for the API base URL and API key if they are not already available. Do not print the full API key back to the user.

## Workflow

1. Determine whether the user wants a private-domain mailbox or a public-domain mailbox.
2. For private domains, make sure the user has added the domain in the web console and pointed DNS MX to the platform MX target. Domain management and MX verification are web-console tasks, not public API tasks.
3. Generate a mailbox with `POST /api/generate-email`.
4. Ask the target service to send mail to that mailbox.
5. Poll `GET /api/emails/next?email=...` every 3 seconds until a new unread message appears.
6. If the response has `has_email=false`, wait and poll again. Stop after about 120 seconds and report a timeout.
7. If the response has `has_email=true`, extract verification codes from `message.subject`, `message.text_content`, or `message.html_content`.
8. Do not call a separate mark-read endpoint after `/api/emails/next`; it marks the returned message read automatically.

Read [references/api-reference.md](references/api-reference.md) when you need exact endpoint examples, response shapes, or error handling details.

## Private Domains

Guide the user, do not silently proceed:

- Ask the user to add their domain in the HLOOL Mail web console.
- Ask the user to add the MX record shown by the product.
- Use wildcard MX only when the user needs subdomain mailboxes such as `user@abc.example.com`.
- Verify API readiness by generating a mailbox on that domain.

Treat private-domain setup as successful only when `POST /api/generate-email` returns an email on that private domain and the response `domain.domain` matches the requested domain.

## Public Domains

Public domains are fast but less reliable with third-party websites. If the target website rejects an address or no verification email arrives, suggest:

- Generate a different mailbox.
- Try another public domain from `GET /api/domains/available` using `X-API-Key`, then read `data.public_domains` or legacy `data.domains`.
- Use a different local-part prefix.
- Wait briefly before requesting another verification email.
- Use a private domain for important or long-running automation.

## Polling Guidance

For verification-code automation, prefer `GET /api/emails/next?email=MAILBOX`. It returns either `{ "has_email": false, "message": null }` or `{ "has_email": true, "message": {...} }`. Poll every 3 seconds, stop after about 120 seconds, and stop immediately after `has_email=true`. The endpoint marks the returned message as read, so the next poll only returns another unread message. If no mail arrives, explain likely causes: target site blocked the domain, target site delayed sending, wrong mailbox address, private-domain MX not verified, or API key lacks access to that mailbox.

Use `GET /api/emails?email=...&limit=10`, `GET /api/email/:id`, and `PATCH /api/email/:id/read` only when the user needs manual inspection or a custom flow.

## Output Style

When helping a user, report the mailbox address, whether the domain is public or private, the latest message status, and any extracted code. Keep implementation details brief unless the user asks for raw API traces.
