package httpapi

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

type apiDocsConfig struct {
	BaseURL    string
	ExpectedMX string
}

func (h *Handler) apiDocsMarkdown(c *gin.Context) {
	baseURL := strings.TrimRight(h.Config.PublicBaseURL, "/")
	if baseURL == "" {
		baseURL = requestBaseURL(c)
	}

	docs := apiDocsMarkdown(apiDocsConfig{
		BaseURL:    baseURL,
		ExpectedMX: h.Config.ExpectedMX,
	})

	c.Header("Content-Disposition", `inline; filename="hlool-mail-api-docs.md"`)
	c.Data(http.StatusOK, "text/markdown; charset=utf-8", []byte(docs))
}

func (h *Handler) apiSkillMarkdown(c *gin.Context) {
	baseURL := strings.TrimRight(h.Config.PublicBaseURL, "/")
	if baseURL == "" {
		baseURL = requestBaseURL(c)
	}

	skill := apiSkillMarkdown(apiDocsConfig{
		BaseURL:    baseURL,
		ExpectedMX: h.Config.ExpectedMX,
	})

	c.Header("Content-Disposition", `inline; filename="hlool-mail-api-skill.md"`)
	c.Data(http.StatusOK, "text/markdown; charset=utf-8", []byte(skill))
}

func requestBaseURL(c *gin.Context) string {
	scheme := "http"
	if c.Request.TLS != nil {
		scheme = "https"
	}
	if forwarded := strings.TrimSpace(c.GetHeader("X-Forwarded-Proto")); forwarded != "" {
		scheme = strings.TrimSpace(strings.Split(forwarded, ",")[0])
	}

	host := strings.TrimSpace(c.GetHeader("X-Forwarded-Host"))
	if host == "" {
		host = c.Request.Host
	}
	return scheme + "://" + host
}

func apiDocsMarkdown(cfg apiDocsConfig) string {
	baseURL := strings.TrimRight(cfg.BaseURL, "/")
	if baseURL == "" {
		baseURL = "http://localhost:3000"
	}
	expectedMX := strings.TrimRight(firstNonEmpty(cfg.ExpectedMX, "mail.example.com"), ".")

	lines := []string{
		"# HLOOL Mail API Guide for AI Assistants",
		"",
		"This document is meant for a user's AI assistant. Do not reverse engineer the service, guess hidden endpoints, or invent parameters. Use only the public API behavior described here.",
		"",
		"API base URL: `" + baseURL + "`",
		"AI-readable docs: `" + baseURL + "/api/docs.md`",
		"All HTTP endpoints use the `/api/` prefix. There is no `/api/v1` or `/api/v2` version prefix.",
		"",
		"## Authentication",
		"",
		"Use the API key header for all protected API calls:",
		"",
		"```http",
		"X-API-Key: YOUR_KEY",
		"```",
		"",
		"For API automation, use `X-API-Key` only. Domain management, MX checks, and API key creation are web-console tasks the user must complete in the product UI.",
		"",
		"## What To Ask The User First",
		"",
		"1. Are they using their own private domain, or only a public domain provided by the platform?",
		"2. Do they already have an API key from the web console?",
		"3. Which mailbox do they want to receive mail at, for example `verify@example.com`, or do they want a random mailbox?",
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
		"",
		"DNS records the user should add:",
		"",
		"```dns",
		"example.com.    MX  10 " + expectedMX + ".",
		"*.example.com.  MX  10 " + expectedMX + ".",
		"```",
		"",
		"The wildcard record is only needed for subdomain mailboxes such as `user@abc.example.com`. It is not needed for ordinary `user@example.com` mailboxes.",
		"",
		"Verify private-domain API access:",
		"",
		"```bash",
		"curl -X POST \"" + baseURL + "/api/generate-email\" \\",
		"  -H \"Content-Type: application/json\" \\",
		"  -H \"X-API-Key: YOUR_KEY\" \\",
		"  -d '{\"prefix\":\"verify\",\"domain\":\"example.com\"}'",
		"```",
		"",
		"Success example:",
		"",
		"```json",
		"{",
		"  \"success\": true,",
		"  \"data\": {",
		"    \"email\": \"verify@example.com\",",
		"    \"domain_id\": 12,",
		"    \"domain\": {",
		"      \"id\": 12,",
		"      \"domain\": \"example.com\",",
		"      \"mode\": \"private\",",
		"      \"active\": true,",
		"      \"mx_verified\": true",
		"    }",
		"  },",
		"  \"error\": null",
		"}",
		"```",
		"",
		"If this call fails with a domain or permission error, common causes are: DNS has not propagated, the user has not added the domain in the console, the user is using the wrong API key, or the domain belongs to another account.",
		"",
		"## Public Domain Flow",
		"",
		"If the user does not want to use a private domain, they can generate a mailbox from the public domain pool. Public domains are convenient for quick testing, but some websites may block temporary-mail domains.",
		"",
		"If a website rejects the address or no verification email arrives, suggest these actions:",
		"",
		"- Generate a new mailbox on another public domain.",
		"- Try a different local-part prefix.",
		"- Wait briefly before requesting another verification email, in case the target website rate-limited the request.",
		"- For important or long-term automation, recommend binding the user's own private domain.",
		"",
		"List available domains grouped by public and private visibility:",
		"",
		"```bash",
		"curl \"" + baseURL + "/api/domains/available\" \\",
		"  -H \"X-API-Key: YOUR_KEY\"",
		"```",
		"",
		"Response example:",
		"",
		"```json",
		"{",
		"  \"success\": true,",
		"  \"data\": {",
		"    \"public_domains\": [",
		"      {",
		"        \"id\": 1,",
		"        \"domain\": \"public.example.com\",",
		"        \"mode\": \"public\",",
		"        \"active\": true,",
		"        \"mx_verified\": true,",
		"        \"message_count\": 42",
		"      }",
		"    ],",
		"    \"private_domains\": [",
		"      {",
		"        \"id\": 12,",
		"        \"domain\": \"example.com\",",
		"        \"mode\": \"private\",",
		"        \"active\": true,",
		"        \"mx_verified\": true,",
		"        \"message_count\": 7",
		"      }",
		"    ]",
		"  },",
		"  \"error\": null",
		"}",
		"```",
		"",
		"Generate a random public-domain mailbox:",
		"",
		"```bash",
		"curl -X POST \"" + baseURL + "/api/generate-email\" \\",
		"  -H \"Content-Type: application/json\" \\",
		"  -H \"X-API-Key: YOUR_KEY\" \\",
		"  -d '{}'",
		"```",
		"",
		"## Reading Mail",
		"",
		"After a mailbox is generated, the target website sends email to that address. For verification-code automation, use simple polling: call `GET /api/emails/next?email=MAILBOX` every 3 seconds for up to 120 seconds. If no mail has arrived it returns `has_email=false`; if a new unread message exists it returns the message content and marks that message read automatically. Stop polling as soon as `has_email=true`.",
		"",
		"Get the next unread message and mark it read automatically:",
		"",
		"```bash",
		"curl \"" + baseURL + "/api/emails/next?email=verify@example.com\" \\",
		"  -H \"X-API-Key: YOUR_KEY\"",
		"```",
		"",
		"Response example:",
		"",
		"```json",
		"{",
		"  \"success\": true,",
		"  \"data\": {",
		"    \"has_email\": true,",
		"    \"message\": {",
		"      \"id\": \"msg-uuid\",",
		"      \"recipient\": \"verify@example.com\",",
		"      \"from_address\": \"sender@example.com\",",
		"      \"subject\": \"Your code is 123456\",",
		"      \"seen\": true,",
		"      \"text_content\": \"Your verification code is 123456\",",
		"      \"html_content\": \"<p>Your verification code is 123456</p>\",",
		"      \"created_at\": \"2026-05-18T08:00:00Z\",",
		"      \"expires_at\": \"2026-05-19T08:00:00Z\"",
		"    }",
		"  },",
		"  \"error\": null",
		"}",
		"```",
		"",
		"If no unread mail has arrived yet, the same endpoint returns:",
		"",
		"```json",
		"{",
		"  \"success\": true,",
		"  \"data\": { \"has_email\": false, \"message\": null },",
		"  \"error\": null",
		"}",
		"```",
		"",
		"List messages without changing their read state:",
		"",
		"```bash",
		"curl \"" + baseURL + "/api/emails?email=verify@example.com&limit=10\" \\",
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
		"Response example:",
		"",
		"```json",
		"{",
		"  \"success\": true,",
		"  \"data\": {",
		"    \"id\": \"msg-uuid\",",
		"    \"recipient\": \"verify@example.com\",",
		"    \"from_address\": \"sender@example.com\",",
		"    \"subject\": \"Your code is 123456\",",
		"    \"seen\": false,",
		"    \"text_content\": \"Your verification code is 123456\",",
		"    \"html_content\": \"<p>Your verification code is 123456</p>\",",
		"    \"headers_json\": \"{...}\",",
		"    \"created_at\": \"2026-05-18T08:00:00Z\",",
		"    \"expires_at\": \"2026-05-19T08:00:00Z\"",
		"  },",
		"  \"error\": null",
		"}",
		"```",
		"",
		"Mark one message as read:",
		"",
		"```bash",
		"curl -X PATCH \"" + baseURL + "/api/email/msg-uuid/read\" \\",
		"  -H \"X-API-Key: YOUR_KEY\"",
		"```",
		"",
		"Response example:",
		"",
		"```json",
		"{",
		"  \"success\": true,",
		"  \"data\": { \"id\": \"msg-uuid\", \"seen\": true },",
		"  \"error\": null",
		"}",
		"```",
		"",
		"Extract verification codes from `subject`, `preview`, or `text_content`. Prefer the newest unread message from the expected sender when possible.",
		"",
		"## API Endpoints",
		"",
		"| Method | Path | Auth | Purpose |",
		"| --- | --- | --- | --- |",
		"| `GET` | `/api/domains/available` | API key | List available domains grouped into `public_domains` and `private_domains` |",
		"| `POST` | `/api/generate-email` | API key | Create a mailbox. Pass `domain` to use a verified private/public domain, or omit it for a random public-domain mailbox |",
		"| `GET` | `/api/mailboxes` | API key | List mailboxes created by the API key owner |",
		"| `DELETE` | `/api/mailboxes/:id` | API key | Delete a mailbox record; stored messages are preserved |",
		"| `GET` | `/api/emails?email=&limit=` | API key | List messages for a mailbox |",
		"| `GET` | `/api/emails/next?email=` | API key | Return the newest unread message with content, mark it read automatically, or return `has_email=false` |",
		"| `GET` | `/api/email/:id` | API key | Read one message with body, HTML, headers, and `seen` state |",
		"| `PATCH` | `/api/email/:id/read` | API key | Mark one message as read |",
		"| `DELETE` | `/api/email/:id` | API key | Delete one message |",
		"| `DELETE` | `/api/emails/clear?email=` | API key | Delete all messages for a mailbox |",
		"| `GET` | `/api/inbox-stream?email=` | API key | Subscribe to new-message events with SSE |",
		"| `GET` | `/api/stats` | API key | Read stats visible to the API key owner |",
		"| `GET` | `/api/docs.md` | None | Read this API guide |",
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
		"    \"total_used\": \"238\"",
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
		"  \"error\": \"domain not found or not verified\"",
		"}",
		"```",
		"",
		"`usage` appears only for API-key requests. Usage counters are strings so JavaScript clients can safely handle large integers.",
		"",
	}
	return strings.Join(lines, "\n")
}

func apiSkillMarkdown(cfg apiDocsConfig) string {
	baseURL := strings.TrimRight(cfg.BaseURL, "/")
	if baseURL == "" {
		baseURL = "http://localhost:3000"
	}
	expectedMX := strings.TrimRight(firstNonEmpty(cfg.ExpectedMX, "mail.example.com"), ".")
	docsURL := baseURL + "/api/docs.md"

	lines := []string{
		"---",
		"name: hlool-mail-api",
		"description: Use HLOOL Mail to create temporary mailboxes, verify private domains, receive email through API calls, read verification messages, and mark messages as read. Use when a user asks an AI assistant to automate temporary email, custom-domain email receiving, verification-code collection, or HLOOL Mail API workflows.",
		"---",
		"",
		"# HLOOL Mail API Skill",
		"",
		"Use this skill to operate HLOOL Mail through its documented public API. The API reference is available at `" + docsURL + "`.",
		"",
		"## Ground Rules",
		"",
		"- Use `X-API-Key` for protected API calls.",
		"- Do not reverse engineer the website, guess hidden endpoints, scrape the console, or invent parameters.",
		"- Ask the user for an API key before calling protected endpoints.",
		"- Ask the user whether they want a private domain or a platform public domain.",
		"- Domain creation, MX verification, and API key creation are completed by the user in the web console.",
		"- If exact response fields or examples are needed, read `" + docsURL + "` first.",
		"",
		"## Private Domain Workflow",
		"",
		"1. Ask the user to add their domain in the web console.",
		"2. Ask the user to point the domain MX record to `" + expectedMX + "`.",
		"3. For root-domain mailboxes such as `user@example.com`, the root MX record is enough.",
		"4. For subdomain mailboxes such as `user@abc.example.com`, ask the user to add a wildcard MX record too.",
		"5. After the user verifies MX in the web console, call `POST /api/generate-email` with the requested domain.",
		"6. Treat the private-domain setup as successful only when the response returns an address on that same domain.",
		"",
		"## Public Domain Workflow",
		"",
		"1. Call `GET /api/domains/available` with `X-API-Key` to list usable domains grouped into `public_domains` and `private_domains`.",
		"2. Call `POST /api/generate-email` without a domain for a random public-domain mailbox, or pass a listed domain explicitly.",
		"3. If a target website rejects the address or no email arrives, suggest another public domain, another local-part prefix, waiting briefly, or using the user's private domain.",
		"",
		"## Reading Verification Email",
		"",
		"1. Call `GET /api/emails/next?email=MAILBOX` every 3 seconds for up to 120 seconds.",
		"2. If `has_email=false`, no unread message has arrived yet; wait and poll again.",
		"3. If `has_email=true`, extract the code from `message.subject`, `message.text_content`, or sanitized `message.html_content`.",
		"4. Stop polling after a match. The endpoint marks the returned message read automatically.",
		"5. For manual inspection only, use `GET /api/emails?email=MAILBOX&limit=10`, `GET /api/email/:id`, and `PATCH /api/email/:id/read`.",
		"",
		"## Core Endpoints",
		"",
		"- `GET /api/domains/available` lists usable public/private domains and requires an API key.",
		"- `POST /api/generate-email` creates a mailbox.",
		"- `GET /api/mailboxes` lists owned mailboxes.",
		"- `GET /api/emails/next?email=` returns the newest unread message with content and marks it read automatically.",
		"- `GET /api/emails?email=&limit=` lists messages for a mailbox.",
		"- `GET /api/email/:id` reads one message.",
		"- `PATCH /api/email/:id/read` marks one message as read.",
		"- `DELETE /api/email/:id` deletes one message.",
		"- `DELETE /api/emails/clear?email=` clears one mailbox.",
		"- `GET /api/stats` reads API-key-visible stats.",
		"",
		"## Minimal Request Pattern",
		"",
		"```bash",
		"curl -X POST \"" + baseURL + "/api/generate-email\" \\",
		"  -H \"Content-Type: application/json\" \\",
		"  -H \"X-API-Key: YOUR_KEY\" \\",
		"  -d '{\"prefix\":\"verify\",\"domain\":\"example.com\"}'",
		"```",
		"",
		"```bash",
		"curl \"" + baseURL + "/api/emails?email=verify@example.com&limit=50\" \\",
		"  -H \"X-API-Key: YOUR_KEY\"",
		"```",
		"",
		"```bash",
		"curl \"" + baseURL + "/api/emails/next?email=verify@example.com\" \\",
		"  -H \"X-API-Key: YOUR_KEY\"",
		"```",
		"",
		"## Response Handling",
		"",
		"Expect a JSON envelope with `success`, `data`, and `error`. API-key calls may also include `usage`. If `success` is false, report `error` to the user and suggest the most likely next action.",
		"",
	}
	return strings.Join(lines, "\n")
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
