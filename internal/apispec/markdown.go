package apispec

import "strings"

func Markdown(cfg Config) string {
	baseURL := normalizedBaseURL(cfg.BaseURL)
	expectedMX := strings.TrimRight(firstNonEmpty(cfg.ExpectedMX, "mail.example.com"), ".")

	lines := []string{
		"# HLOOL Mail API Guide for AI Assistants",
		"",
		"This document is rendered from the same operation registry as the OpenAPI document. Do not reverse engineer the service, guess hidden endpoints, or invent parameters. Use only the public API behavior described here.",
		"",
		"API base URL: `" + baseURL + "`",
		"Markdown docs: `" + baseURL + "/api/docs.md`",
		"OpenAPI JSON: `" + baseURL + "/api/openapi.json`",
		"OpenAPI YAML: `" + baseURL + "/api/openapi.yaml`",
		"All HTTP endpoints documented here use the `/api/` prefix.",
		"",
		"## Authentication",
		"",
		"Use the API key header for API-key automation calls:",
		"",
		"```http",
		"X-API-Key: YOUR_KEY",
		"```",
		"",
		"For API automation, use `X-API-Key` only. Domain management, MX checks, login, user management, and API key creation are web-console tasks.",
		"",
		"## Public API Boundary",
		"",
		"The API-key automation surface is intentionally small and stable. OpenAPI, Markdown docs, skill docs, health, and version endpoints are public metadata. Share-link and webhook management endpoints are web-console session endpoints marked `cookie/session`; they are not API-key automation endpoints.",
		"",
		"## Private Domain Flow",
		"",
		"If the user wants to use a private domain such as `example.com`, guide them through this flow:",
		"",
		"1. Ask the user to add `example.com` as a private domain in the web console.",
		"2. Ask the user to add an MX record in their DNS provider pointing to the platform MX target.",
		"3. If they only need addresses like `user@example.com`, the root MX record is enough.",
		"4. If they need addresses like `user@abc.example.com`, they also need a wildcard MX record.",
		"5. After DNS is ready, ask the user to complete MX verification in the web console.",
		"6. Use the API key to call `POST /api/generate-email` with the private domain. If the response returns that domain, API access is working.",
		"7. You can discover API-key-accessible private domains from `GET /api/domains/available` in `data.private_domains`.",
		"",
		"DNS records the user should add:",
		"",
		"```dns",
		"example.com.    MX  10 " + expectedMX + ".",
		"*.example.com.  MX  10 " + expectedMX + ".",
		"```",
		"",
		"The wildcard record is only needed for subdomain mailboxes such as `user@abc.example.com`.",
		"",
		"Verify private-domain API access:",
		"",
		"```bash",
		"curl -X POST \"" + baseURL + operationByID("generateEmail").Path + "\" \\",
		"  -H \"Content-Type: application/json\" \\",
		"  -H \"X-API-Key: YOUR_KEY\" \\",
		"  -d '{\"prefix\":\"verify\",\"domain\":\"example.com\"}'",
		"```",
		"",
		"If this call fails with a domain or permission error, common causes are DNS propagation, incomplete web-console domain setup, wrong API key, or a domain owned by another account.",
		"",
		"## Public Domain Flow",
		"",
		"Public domains are convenient for quick testing, but some websites may block temporary-mail domains. If a website rejects the address or no verification email arrives, suggest generating a new mailbox on another public domain, using a different local-part prefix, waiting briefly, or binding a private domain.",
		"",
		"List available public domains and API-key-accessible private domains:",
		"",
		"```bash",
		"curl \"" + baseURL + operationByID("availableDomains").Path + "\" \\",
		"  -H \"X-API-Key: YOUR_KEY\"",
		"```",
		"",
		"`data.domains` is a legacy compatibility field containing public domain names only. New clients should prefer `data.public_domains` and `data.private_domains`.",
		"",
		"Generate a random public-domain mailbox:",
		"",
		"```bash",
		"curl -X POST \"" + baseURL + operationByID("generateEmail").Path + "\" \\",
		"  -H \"Content-Type: application/json\" \\",
		"  -H \"X-API-Key: YOUR_KEY\" \\",
		"  -d '{}'",
		"```",
		"",
		"Mailbox creation returns HTTP `201` when a new mailbox record is created. If the same API-key owner generates an existing mailbox again, the API returns HTTP `200` with `data.reuse=true`.",
		"",
		"## Managing Generated Mailboxes",
		"",
		"List mailboxes created by the API-key owner:",
		"",
		"```bash",
		"curl \"" + baseURL + "/api/mailboxes?page=1&per_page=20\" \\",
		"  -H \"X-API-Key: YOUR_KEY\"",
		"```",
		"",
		"When `page`, `per_page`, or `q` is present, `GET /api/mailboxes` returns pagination metadata with `items`, `page`, `per_page`, `total`, and `total_pages`.",
		"",
		"Delete one mailbox record and its stored messages:",
		"",
		"```bash",
		"curl -X DELETE \"" + baseURL + "/api/mailboxes/45\" \\",
		"  -H \"X-API-Key: YOUR_KEY\"",
		"```",
		"",
		"Success data includes `deleted=true` and `messages_deleted`.",
		"",
		"## Reading Mail",
		"",
		"After a mailbox is generated, the target website sends email to that address. For verification-code automation, use simple polling: call `GET /api/emails/next?email=MAILBOX` every 3 seconds for up to 120 seconds. If no mail has arrived it returns `has_email=false`; if a new unread message exists it returns the message content and marks that message read automatically. Stop polling as soon as `has_email=true`.",
		"",
		"```bash",
		"curl \"" + baseURL + "/api/emails/next?email=verify@example.com\" \\",
		"  -H \"X-API-Key: YOUR_KEY\"",
		"```",
		"",
		"List messages without changing read state:",
		"",
		"```bash",
		"curl \"" + baseURL + "/api/emails?email=verify@example.com&page=1&per_page=20\" \\",
		"  -H \"X-API-Key: YOUR_KEY\"",
		"```",
		"",
		"Read one message:",
		"",
		"```bash",
		"curl \"" + baseURL + "/api/email/msg-uuid\" \\",
		"  -H \"X-API-Key: YOUR_KEY\"",
		"```",
		"",
		"Mark one message as read:",
		"",
		"```bash",
		"curl -X PATCH \"" + baseURL + "/api/email/msg-uuid/read\" \\",
		"  -H \"X-API-Key: YOUR_KEY\"",
		"```",
		"",
		"Clear all messages for a mailbox:",
		"",
		"```bash",
		"curl -X DELETE \"" + baseURL + "/api/emails/clear?email=verify@example.com\" \\",
		"  -H \"X-API-Key: YOUR_KEY\"",
		"```",
		"",
		"Extract verification codes from `subject`, `preview`, `text_content`, or sanitized `html_content`. Prefer the newest unread message from the expected sender when possible.",
		"Timestamps are RFC3339 strings and may use `Z` or an explicit timezone offset such as `+08:00`.",
		"",
		"## API Key Automation Endpoints",
		"",
		endpointTable(AutomationOperations()),
		"",
		"## Public Metadata Endpoints",
		"",
		endpointTable(PublicMetaOperations()),
		"",
		"## Web Session API Endpoints",
		"",
		"These endpoints require the web-console `gptmail_session` cookie/session and are not available through API-key automation.",
		"",
		endpointTable(WebSessionOperations()),
		"",
		"## Response Envelope",
		"",
		"Success:",
		"",
		"```json",
		"{",
		"  \"success\": true,",
		"  \"data\": {},",
		"  \"error\": null,",
		"  \"usage\": {",
		"    \"used_today\": \"12\",",
		"    \"daily_limit\": \"200000\",",
		"    \"remaining_today\": \"199988\",",
		"    \"daily_unlimited\": \"false\",",
		"    \"total_usage\": \"238\",",
		"    \"total_limit\": \"0\",",
		"    \"remaining_total\": \"unlimited\",",
		"    \"total_unlimited\": \"true\"",
		"  }",
		"}",
		"```",
		"",
		"Failure:",
		"",
		"```json",
		"{",
		"  \"success\": false,",
		"  \"data\": null,",
		"  \"error\": \"message not found\"",
		"}",
		"```",
		"",
		"`error` is human-readable and may be localized. Do not branch on exact error text; use the HTTP status and `success` flag for control flow, then show `error` to the user.",
		"",
		"`usage` appears only for API-key requests, including API-key requests that fail after authentication. Numeric usage values are strings so JavaScript clients can safely handle large integers. Unlimited quota is reported as `\"unlimited\"` in remaining fields with matching `*_unlimited` flags.",
		"",
	}
	return strings.Join(lines, "\n")
}

func endpointTable(ops []Operation) string {
	lines := []string{
		"| Method | Path | Auth | Purpose |",
		"| --- | --- | --- | --- |",
	}
	for _, op := range ops {
		lines = append(lines, "| `"+op.Method+"` | `"+op.DisplayPath()+"` | "+authLabel(op.Auth)+" | "+op.Description+" |")
	}
	return strings.Join(lines, "\n")
}

func operationByID(id string) Operation {
	for _, op := range Operations() {
		if op.ID == id {
			return op
		}
	}
	return Operation{}
}

func normalizedBaseURL(value string) string {
	baseURL := strings.TrimRight(strings.TrimSpace(value), "/")
	if baseURL == "" {
		return "http://localhost:3000"
	}
	return baseURL
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
