# HLOOL Mail API Reference

Use `X-API-Key` for protected calls.

## Generate Mailbox

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

## List Available Domains

```bash
curl "$BASE_URL/api/domains/available" \
  -H "X-API-Key: $API_KEY"
```

Use this to get `public_domains` and the API key owner's ready `private_domains`. Public domains may be blocked by some websites.

## List Mailboxes

```bash
curl "$BASE_URL/api/mailboxes" \
  -H "X-API-Key: $API_KEY"
```

## List Messages

```bash
curl "$BASE_URL/api/emails?email=verify@example.com&limit=10" \
  -H "X-API-Key: $API_KEY"
```

Response:

```json
{
  "success": true,
  "data": [
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

The detail response includes `text_content`, `html_content`, and `headers_json`. Extract codes from subject, preview, or text content.

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

## Error Handling

Common `error` values and likely guidance:

- `domain not found or not verified`: Ask the user to finish private-domain setup and MX verification in the web console.
- `domain access denied`: The API key belongs to the wrong user or the domain belongs to another account.
- `email address already in use`: Generate a random prefix or choose a different prefix.
- `api key quota exceeded`: Ask the user to raise or reset their API key quota in the web console.
- Empty message list: Wait and poll again; if it persists, check whether the sender blocked the domain, the target address is correct, or private-domain MX is verified.
