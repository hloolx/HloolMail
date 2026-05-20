# HLOOL Mail API Reference

Use `X-API-Key` for protected calls. This reference covers API-key automation only; login, API-key creation, domain management, MX checks, admin work, user management, and live streams are web-console tasks.

HLOOL Mail is open source and self-hostable. Set `BASE_URL` to the user's own HLOOL Mail instance, not to a fixed official API host:

```bash
BASE_URL="https://your-hlool-mail.example"
API_KEY="key-hloolmail_xxx"
```

## Generate Mailbox

Recommended domain-selection flow:

1. Call `GET /api/domains/available` with `X-API-Key`.
2. Build choices from `data.public_domains` and `data.private_domains`.
3. Let the user choose one or more domains when the workflow needs multiple mailboxes.
4. Pass the selected domain to `POST /api/generate-email`.

Private or specific public domain:

```bash
curl -X POST "$BASE_URL/api/generate-email" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{"prefix":"verify","domain":"example.com"}'
```

Random public-domain mailbox:

```bash
curl -X POST "$BASE_URL/api/generate-email" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{}'
```

Create a mailbox and a mailbox share in the same API-key call:

```bash
curl -X POST "$BASE_URL/api/generate-email" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{"prefix":"verify","domain":"example.com","share":true}'
```

Success:

```json
{
  "success": true,
  "data": {
    "email": "verify@example.com",
    "domain_id": 12,
    "domain": {
      "domain": "example.com",
      "mode": "private",
      "active": true,
      "mx_verified": true
    }
  },
  "error": null
}
```

New mailbox creation returns HTTP `201`. Reusing an existing mailbox owned by the same API-key owner returns HTTP `200` with `data.reuse=true`. `prefix` is optional and is normalized to lowercase letters, digits, `.`, `-`, and `_`; if it normalizes to empty, the API generates a random local part.

When `share` is `true` or an object such as `{ "enabled": true, "expires_at": "2026-06-01T00:00:00Z" }`, `data.share` describes the mailbox share. `data.share.url` is the share page URL, and `data.share.access_url` includes `?key=...` for direct shared mailbox access. Full token/key values are returned once; the server stores only hashes, so old complete links cannot be viewed again.

## Read Shared Mailbox

Shared mailbox reads are public token/key GET endpoints; do not send `X-API-Key` and do not use a POST unlock endpoint:

```bash
curl "$BASE_URL/api/shared/$SHARE_TOKEN?key=$SHARE_KEY"
curl "$BASE_URL/api/shared/$SHARE_TOKEN/messages?key=$SHARE_KEY&page=1&per_page=20"
curl "$BASE_URL/api/shared/$SHARE_TOKEN/messages/msg-uuid?key=$SHARE_KEY"
```

## List Available Domains

```bash
curl "$BASE_URL/api/domains/available" \
  -H "X-API-Key: $API_KEY"
```

Use this as the domain-picker source of truth before creating mailboxes. It returns active, MX-verified public domains in `data.public_domains` and API-key-accessible private domains in `data.private_domains`. Legacy `data.domains` only contains public-domain strings and should be used as a fallback for older clients. Public domains may be blocked by some websites.

Clients and AI agents should present `public_domains` and `private_domains` as grouped selectable options. Do not ask the user to type a private domain when it already appears in `private_domains`.

Response:

```json
{
  "success": true,
  "data": {
    "domains": ["public.example.com", "mailbox.example.net"],
    "public_domains": [
      { "id": 1, "domain": "public.example.com", "mode": "public", "message_count": 0 }
    ],
    "private_domains": [
      { "id": 12, "domain": "example.com", "mode": "private", "message_count": 0 }
    ]
  },
  "error": null
}
```

## List Mailboxes

```bash
curl "$BASE_URL/api/mailboxes?page=1&per_page=20" \
  -H "X-API-Key: $API_KEY"
```

Passing `page`, `per_page`, or `q` returns a paginated object. `q` searches `email`, `local_part`, and `host`. Calling `/api/mailboxes` without those parameters returns a legacy array in `data`.

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": 45,
        "email": "verify@example.com",
        "local_part": "verify",
        "host": "example.com",
        "domain_id": 12,
        "created_at": "2026-05-18T08:00:00Z",
        "updated_at": "2026-05-18T08:00:00Z",
        "message_count": 1,
        "last_message_at": "2026-05-18T08:05:00Z"
      }
    ],
    "page": 1,
    "per_page": 20,
    "total": 1,
    "total_pages": 1
  },
  "error": null
}
```

## List Messages

```bash
curl "$BASE_URL/api/emails?email=verify@example.com&page=1&per_page=20" \
  -H "X-API-Key: $API_KEY"
```

Passing `page` or `per_page` returns a paginated object. The older `limit` form returns an array in `data`.

Response:

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "msg-uuid",
        "recipient": "verify@example.com",
        "from_address": "sender@example.com",
        "from_name": "Sender",
        "subject": "Your code is 123456",
        "seen": false,
        "preview": "Your verification code is 123456",
        "created_at": "2026-05-18T08:00:00Z",
        "expires_at": "2026-05-19T08:00:00Z"
      }
    ],
    "page": 1,
    "per_page": 20,
    "total": 1,
    "total_pages": 1
  },
  "error": null
}
```

## Get Next Unread Message

Use this for verification-code automation. Call it every 3 seconds until `has_email` is true, then stop. The returned message is marked read automatically.

```bash
curl "$BASE_URL/api/emails/next?email=verify@example.com" \
  -H "X-API-Key: $API_KEY"
```

No unread mail yet:

```json
{
  "success": true,
  "data": {
    "has_email": false,
    "message": null
  },
  "error": null
}
```

Unread mail found:

```json
{
  "success": true,
  "data": {
    "has_email": true,
    "message": {
      "id": "msg-uuid",
      "recipient": "verify@example.com",
      "from_address": "sender@example.com",
      "from_name": "Sender",
      "subject": "Your code is 123456",
      "seen": true,
      "text_content": "Your verification code is 123456",
      "html_content": "<p>Your verification code is 123456</p>",
      "created_at": "2026-05-18T08:00:00Z",
      "expires_at": "2026-05-19T08:00:00Z"
    }
  },
  "error": null
}
```

## Read Message

```bash
curl "$BASE_URL/api/email/msg-uuid" \
  -H "X-API-Key: $API_KEY"
```

The API-key detail response includes `text_content` and `headers_json`; the web session view also includes sanitized `html_content`. Extract codes from subject, preview, or text content.

## Mark Message Read

```bash
curl -X PATCH "$BASE_URL/api/email/msg-uuid/read" \
  -H "X-API-Key: $API_KEY"
```

Response:

```json
{
  "success": true,
  "data": {
    "id": "msg-uuid",
    "seen": true
  },
  "error": null
}
```

## Delete Mail

Delete one message:

```bash
curl -X DELETE "$BASE_URL/api/email/msg-uuid" \
  -H "X-API-Key: $API_KEY"
```

Clear one mailbox:

```bash
curl -X DELETE "$BASE_URL/api/emails/clear?email=verify@example.com" \
  -H "X-API-Key: $API_KEY"
```

Delete one mailbox record and the messages stored for that exact address:

```bash
curl -X DELETE "$BASE_URL/api/mailboxes/45" \
  -H "X-API-Key: $API_KEY"
```

```json
{
  "success": true,
  "data": {
    "deleted": true,
    "messages_deleted": 1
  },
  "error": null
}
```

## Error Handling

Common `error` values and likely guidance:

- `domain not found`: Ask the user to confirm the domain spelling and API key account.
- `domain MX not verified`: Ask the user to finish MX verification in the web console.
- `private domain access denied`: The private domain belongs to another account or the wrong API key is being used.
- `no available public domains; pass domain to use a private domain`: Use a domain from `data.private_domains` explicitly.
- `domain access denied`: The API key belongs to the wrong user or the domain belongs to another account.
- `email address already in use`: Generate a random prefix or choose a different prefix.
- `api key quota exceeded`: Ask the user to raise or reset their API key quota in the web console.
- Empty message list: Wait and poll again; if it persists, check whether the sender blocked the domain, the target address is correct, or private-domain MX is verified.
