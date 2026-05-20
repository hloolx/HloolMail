package apispec

import (
	"encoding/json"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/goccy/go-yaml"
)

type OpenAPI struct {
	OpenAPI        string              `json:"openapi" yaml:"openapi"`
	Info           Info                `json:"info" yaml:"info"`
	Servers        []Server            `json:"servers,omitempty" yaml:"servers,omitempty"`
	Tags           []Tag               `json:"tags,omitempty" yaml:"tags,omitempty"`
	Paths          map[string]PathItem `json:"paths" yaml:"paths"`
	Components     Components          `json:"components" yaml:"components"`
	XHloolFrontend []FrontendOperation `json:"x-hlool-frontend,omitempty" yaml:"x-hlool-frontend,omitempty"`
}

type Info struct {
	Title       string `json:"title" yaml:"title"`
	Version     string `json:"version" yaml:"version"`
	Description string `json:"description,omitempty" yaml:"description,omitempty"`
}

type Server struct {
	URL         string `json:"url" yaml:"url"`
	Description string `json:"description,omitempty" yaml:"description,omitempty"`
}

type Tag struct {
	Name        string `json:"name" yaml:"name"`
	Description string `json:"description,omitempty" yaml:"description,omitempty"`
}

type Components struct {
	Schemas         map[string]Schema         `json:"schemas" yaml:"schemas"`
	SecuritySchemes map[string]SecurityScheme `json:"securitySchemes,omitempty" yaml:"securitySchemes,omitempty"`
}

type SecurityScheme struct {
	Type        string `json:"type" yaml:"type"`
	In          string `json:"in,omitempty" yaml:"in,omitempty"`
	Name        string `json:"name,omitempty" yaml:"name,omitempty"`
	Description string `json:"description,omitempty" yaml:"description,omitempty"`
}

type PathItem map[string]OpenAPIOperation

type OpenAPIOperation struct {
	Tags        []string                   `json:"tags,omitempty" yaml:"tags,omitempty"`
	Summary     string                     `json:"summary,omitempty" yaml:"summary,omitempty"`
	Description string                     `json:"description,omitempty" yaml:"description,omitempty"`
	OperationID string                     `json:"operationId" yaml:"operationId"`
	Security    []map[string][]string      `json:"security,omitempty" yaml:"security,omitempty"`
	Parameters  []OpenAPIParameter         `json:"parameters,omitempty" yaml:"parameters,omitempty"`
	RequestBody *OpenAPIRequestBody        `json:"requestBody,omitempty" yaml:"requestBody,omitempty"`
	Responses   map[string]OpenAPIResponse `json:"responses" yaml:"responses"`
	XHloolAuth  string                     `json:"x-hlool-auth,omitempty" yaml:"x-hlool-auth,omitempty"`
}

type OpenAPIParameter struct {
	Name        string `json:"name" yaml:"name"`
	In          string `json:"in" yaml:"in"`
	Required    bool   `json:"required,omitempty" yaml:"required,omitempty"`
	Description string `json:"description,omitempty" yaml:"description,omitempty"`
	Schema      Schema `json:"schema,omitempty" yaml:"schema,omitempty"`
	Example     any    `json:"example,omitempty" yaml:"example,omitempty"`
}

type OpenAPIRequestBody struct {
	Description string                  `json:"description,omitempty" yaml:"description,omitempty"`
	Required    bool                    `json:"required,omitempty" yaml:"required,omitempty"`
	Content     map[string]MediaContent `json:"content" yaml:"content"`
}

type OpenAPIResponse struct {
	Description string                  `json:"description" yaml:"description"`
	Content     map[string]MediaContent `json:"content,omitempty" yaml:"content,omitempty"`
}

type MediaContent struct {
	Schema  Schema `json:"schema,omitempty" yaml:"schema,omitempty"`
	Example any    `json:"example,omitempty" yaml:"example,omitempty"`
}

var registry = []Operation{
	{
		ID:          "health",
		Method:      http.MethodGet,
		Path:        "/api/health",
		Tags:        []string{TagPublicMeta},
		Summary:     "Health check",
		Description: "Returns service health metadata.",
		Auth:        AuthPublic,
		Responses:   okResponses("EnvelopeHealth"),
		Frontend: &FrontendHints{
			Title:       "Health",
			Description: "Check whether the API service is reachable.",
			RequestPath: "/api/health",
		},
	},
	{
		ID:          "versionInfo",
		Method:      http.MethodGet,
		Path:        "/api/version",
		Tags:        []string{TagPublicMeta},
		Summary:     "Version",
		Description: "Returns the running service version, commit, and build time.",
		Auth:        AuthPublic,
		Responses:   okResponses("EnvelopeVersion"),
		Frontend: &FrontendHints{
			Title:       "Version",
			Description: "Read service version metadata.",
			RequestPath: "/api/version",
		},
	},
	{
		ID:          "apiDocsMarkdown",
		Method:      http.MethodGet,
		Path:        "/api/docs.md",
		Tags:        []string{TagPublicMeta},
		Summary:     "Markdown API guide",
		Description: "Returns the AI-readable Markdown guide rendered from this registry.",
		Auth:        AuthPublic,
		Responses: []OperationResponse{
			{Status: http.StatusOK, Description: "Markdown document", SchemaName: ""},
		},
		Frontend: &FrontendHints{
			Title:       "Markdown docs",
			Description: "Read the AI-readable Markdown API reference.",
			RequestPath: "/api/docs.md",
		},
	},
	{
		ID:          "apiSkillMarkdown",
		Method:      http.MethodGet,
		Path:        "/api/skill.md",
		Tags:        []string{TagPublicMeta},
		Summary:     "Skill guide",
		Description: "Returns the AI assistant skill guide rendered from this registry.",
		Auth:        AuthPublic,
		Responses: []OperationResponse{
			{Status: http.StatusOK, Description: "Markdown skill document", SchemaName: ""},
		},
		Frontend: &FrontendHints{
			Title:       "Skill guide",
			Description: "Read the AI assistant skill instructions.",
			RequestPath: "/api/skill.md",
		},
	},
	{
		ID:          "openAPIJSON",
		Method:      http.MethodGet,
		Path:        "/api/openapi.json",
		Tags:        []string{TagPublicMeta},
		Summary:     "OpenAPI JSON",
		Description: "Returns the OpenAPI document as JSON.",
		Auth:        AuthPublic,
		Responses: []OperationResponse{
			{Status: http.StatusOK, Description: "OpenAPI JSON document", SchemaName: ""},
		},
		Frontend: &FrontendHints{
			Title:       "OpenAPI JSON",
			Description: "Read the machine-readable OpenAPI document.",
			RequestPath: "/api/openapi.json",
		},
	},
	{
		ID:          "openAPIYAML",
		Method:      http.MethodGet,
		Path:        "/api/openapi.yaml",
		Tags:        []string{TagPublicMeta},
		Summary:     "OpenAPI YAML",
		Description: "Returns the OpenAPI document as YAML.",
		Auth:        AuthPublic,
		Responses: []OperationResponse{
			{Status: http.StatusOK, Description: "OpenAPI YAML document", SchemaName: ""},
		},
		Frontend: &FrontendHints{
			Title:       "OpenAPI YAML",
			Description: "Read the machine-readable OpenAPI document as YAML.",
			RequestPath: "/api/openapi.yaml",
		},
	},
	{
		ID:          "availableDomains",
		Method:      http.MethodGet,
		Path:        "/api/domains/available",
		Tags:        []string{TagAutomation},
		Summary:     "Available domains",
		Description: "Lists available public domains and private domains accessible to the API-key owner.",
		Auth:        AuthAPIKey,
		Responses:   okResponses("EnvelopeAvailableDomains"),
		Frontend: &FrontendHints{
			Title:       "Available domains",
			Description: "List public domains and API-key-accessible private domains.",
			RequestPath: "/api/domains/available",
		},
	},
	{
		ID:          "generateEmail",
		Method:      http.MethodPost,
		Path:        "/api/generate-email",
		Tags:        []string{TagAutomation},
		Summary:     "Generate mailbox",
		Description: "Creates or reuses a mailbox for the API-key actor. Pass domain for a verified domain, or omit it for a random public-domain mailbox.",
		Auth:        AuthAPIKey,
		RequestBody: &RequestBody{Description: "Optional mailbox generation preferences.", SchemaName: "GenerateEmailRequest", Example: "{\n  \"prefix\": \"verify\",\n  \"domain\": \"example.com\"\n}", Required: false},
		Responses: []OperationResponse{
			{Status: http.StatusCreated, Description: "Mailbox created", SchemaName: "EnvelopeGenerateEmail"},
			{Status: http.StatusOK, Description: "Existing mailbox reused", SchemaName: "EnvelopeGenerateEmail"},
		},
		Frontend: &FrontendHints{
			Title:        "Generate mailbox",
			Description:  "Create a mailbox on a chosen domain or a random public domain.",
			RequestPath:  "/api/generate-email",
			BodyTemplate: "{\n  \"prefix\": \"verify\",\n  \"domain\": \"\"\n}",
		},
	},
	{
		ID:          "listMailboxes",
		Method:      http.MethodGet,
		Path:        "/api/mailboxes",
		Tags:        []string{TagAutomation},
		Summary:     "List mailboxes",
		Description: "Lists mailboxes created by the API-key owner. Use page and per_page for paginated responses.",
		Auth:        AuthAPIKey,
		Parameters: []Parameter{
			queryParam("page", "Page number for pagination.", integerSchema("int32"), false, 1),
			queryParam("per_page", "Items per page.", integerSchema("int32"), false, 20),
			queryParam("q", "Optional search over email, local part, and host.", stringSchema(""), false, "verify"),
		},
		Responses: okResponses("EnvelopeMailboxPage"),
		Frontend: &FrontendHints{
			Title:         "List mailboxes",
			Description:   "List mailboxes created by the API-key owner.",
			RequestPath:   "/api/mailboxes",
			QueryTemplate: "page=1&per_page=20",
		},
	},
	{
		ID:          "deleteMailbox",
		Method:      http.MethodDelete,
		Path:        "/api/mailboxes/{id}",
		Tags:        []string{TagAutomation},
		Summary:     "Delete mailbox",
		Description: "Deletes one mailbox record and stored messages for that exact address.",
		Auth:        AuthAPIKey,
		Parameters:  []Parameter{pathParam("id", "Mailbox id.", integerSchema("uint64"), 45)},
		Responses:   okResponses("EnvelopeMailboxDelete"),
		Frontend: &FrontendHints{
			Title:       "Delete mailbox",
			Description: "Delete one mailbox record and its stored messages.",
			RequestPath: "/api/mailboxes/45",
			Dangerous:   true,
		},
	},
	{
		ID:          "listEmails",
		Method:      http.MethodGet,
		Path:        "/api/emails",
		Tags:        []string{TagAutomation},
		Summary:     "List messages",
		Description: "Lists messages for one mailbox without changing read state. Use page and per_page for pagination metadata.",
		Auth:        AuthAPIKey,
		Parameters: []Parameter{
			queryParam("email", "Mailbox email address.", stringSchema("email"), true, "verify@example.com"),
			queryParam("page", "Page number for pagination.", integerSchema("int32"), false, 1),
			queryParam("per_page", "Items per page.", integerSchema("int32"), false, 20),
			queryParam("limit", "Legacy array-response limit.", integerSchema("int32"), false, 50),
		},
		Responses: okResponses("EnvelopeMessagePage"),
		Frontend: &FrontendHints{
			Title:         "List messages",
			Description:   "List messages for a mailbox without auto-marking them read.",
			RequestPath:   "/api/emails",
			QueryTemplate: "email=verify@example.com&page=1&per_page=20",
		},
	},
	{
		ID:          "nextEmail",
		Method:      http.MethodGet,
		Path:        "/api/emails/next",
		Tags:        []string{TagAutomation},
		Summary:     "Next unread message",
		Description: "Returns the newest unread message for a mailbox and marks that message read automatically. If none exists, returns has_email=false.",
		Auth:        AuthAPIKey,
		Parameters:  []Parameter{queryParam("email", "Mailbox email address.", stringSchema("email"), true, "verify@example.com")},
		Responses:   okResponses("EnvelopeNextEmail"),
		Frontend: &FrontendHints{
			Title:         "Next unread email",
			Description:   "Poll for the newest unread message and mark it read automatically.",
			RequestPath:   "/api/emails/next",
			QueryTemplate: "email=verify@example.com",
		},
	},
	{
		ID:          "getEmail",
		Method:      http.MethodGet,
		Path:        "/api/email/{id}",
		Tags:        []string{TagAutomation},
		Summary:     "Read message",
		Description: "Reads one message by id with text body, sanitized HTML when available, headers, and attachment metadata.",
		Auth:        AuthAPIKey,
		Parameters:  []Parameter{pathParam("id", "Message id.", stringSchema(""), "msg-uuid")},
		Responses:   okResponses("EnvelopeMessageDetail"),
		Frontend: &FrontendHints{
			Title:       "Read message",
			Description: "Read text body, headers, read state, and attachment metadata for one message.",
			RequestPath: "/api/email/msg-uuid",
		},
	},
	{
		ID:          "markEmailRead",
		Method:      http.MethodPatch,
		Path:        "/api/email/{id}/read",
		Tags:        []string{TagAutomation},
		Summary:     "Mark message read",
		Description: "Marks one message as read.",
		Auth:        AuthAPIKey,
		Parameters:  []Parameter{pathParam("id", "Message id.", stringSchema(""), "msg-uuid")},
		Responses:   okResponses("EnvelopeMarkRead"),
		Frontend: &FrontendHints{
			Title:       "Mark as read",
			Description: "Mark one message as read.",
			RequestPath: "/api/email/msg-uuid/read",
		},
	},
	{
		ID:          "deleteEmail",
		Method:      http.MethodDelete,
		Path:        "/api/email/{id}",
		Tags:        []string{TagAutomation},
		Summary:     "Delete message",
		Description: "Deletes one message the API-key actor is allowed to access.",
		Auth:        AuthAPIKey,
		Parameters:  []Parameter{pathParam("id", "Message id.", stringSchema(""), "msg-uuid")},
		Responses:   okResponses("EnvelopeDeleteMessage"),
		Frontend: &FrontendHints{
			Title:       "Delete message",
			Description: "Delete one message the API-key actor can access.",
			RequestPath: "/api/email/msg-uuid",
			Dangerous:   true,
		},
	},
	{
		ID:          "clearEmails",
		Method:      http.MethodDelete,
		Path:        "/api/emails/clear",
		Tags:        []string{TagAutomation},
		Summary:     "Clear mailbox messages",
		Description: "Deletes all messages stored for one mailbox.",
		Auth:        AuthAPIKey,
		Parameters:  []Parameter{queryParam("email", "Mailbox email address.", stringSchema("email"), true, "verify@example.com")},
		Responses:   okResponses("EnvelopeClearEmails"),
		Frontend: &FrontendHints{
			Title:         "Clear inbox",
			Description:   "Delete all messages for one mailbox.",
			RequestPath:   "/api/emails/clear",
			QueryTemplate: "email=verify@example.com",
			Dangerous:     true,
		},
	},
	{
		ID:          "stats",
		Method:      http.MethodGet,
		Path:        "/api/stats",
		Tags:        []string{TagAutomation},
		Summary:     "Stats",
		Description: "Returns stats visible to the API-key owner.",
		Auth:        AuthAPIKey,
		Responses:   okResponses("EnvelopeStats"),
		Frontend: &FrontendHints{
			Title:       "Stats",
			Description: "Fetch stats visible to the API-key owner.",
			RequestPath: "/api/stats",
		},
	},
	{
		ID:          "createShareLink",
		Method:      http.MethodPost,
		Path:        "/api/share-links",
		Tags:        []string{TagWebSession},
		Summary:     "Create share link",
		Description: "Web-console session endpoint. Creates a message share link for the logged-in user.",
		Auth:        AuthSession,
		RequestBody: &RequestBody{Description: "Share link settings.", SchemaName: "CreateShareLinkRequest", Required: true},
		Responses:   createdResponses("EnvelopeShareLink"),
	},
	{
		ID:          "listShareLinks",
		Method:      http.MethodGet,
		Path:        "/api/share-links",
		Tags:        []string{TagWebSession},
		Summary:     "List share links",
		Description: "Web-console session endpoint. Lists message share links for the logged-in user.",
		Auth:        AuthSession,
		Parameters:  paginationParams(),
		Responses:   okResponses("EnvelopeShareLinkPage"),
	},
	{
		ID:          "getShareLink",
		Method:      http.MethodGet,
		Path:        "/api/share-links/{id}",
		Tags:        []string{TagWebSession},
		Summary:     "Get share link",
		Description: "Web-console session endpoint. Reads one managed share link.",
		Auth:        AuthSession,
		Parameters:  []Parameter{pathParam("id", "Share link id.", integerSchema("uint64"), 1)},
		Responses:   okResponses("EnvelopeShareLink"),
	},
	{
		ID:          "patchShareLink",
		Method:      http.MethodPatch,
		Path:        "/api/share-links/{id}",
		Tags:        []string{TagWebSession},
		Summary:     "Update share link",
		Description: "Web-console session endpoint. Updates password or expiration for one share link.",
		Auth:        AuthSession,
		Parameters:  []Parameter{pathParam("id", "Share link id.", integerSchema("uint64"), 1)},
		RequestBody: &RequestBody{Description: "Share link patch.", SchemaName: "PatchShareLinkRequest", Required: false},
		Responses:   okResponses("EnvelopeShareLink"),
	},
	{
		ID:          "revokeShareLink",
		Method:      http.MethodPost,
		Path:        "/api/share-links/{id}/revoke",
		Tags:        []string{TagWebSession},
		Summary:     "Revoke share link",
		Description: "Web-console session endpoint. Revokes one share link.",
		Auth:        AuthSession,
		Parameters:  []Parameter{pathParam("id", "Share link id.", integerSchema("uint64"), 1)},
		Responses:   okResponses("EnvelopeShareLink"),
	},
	{
		ID:          "rotateShareLinkToken",
		Method:      http.MethodPost,
		Path:        "/api/share-links/{id}/rotate-token",
		Tags:        []string{TagWebSession},
		Summary:     "Rotate share token",
		Description: "Web-console session endpoint. Rotates the public token for one share link.",
		Auth:        AuthSession,
		Parameters:  []Parameter{pathParam("id", "Share link id.", integerSchema("uint64"), 1)},
		Responses:   okResponses("EnvelopeShareLink"),
	},
	{
		ID:          "listShareLinkAccessLogs",
		Method:      http.MethodGet,
		Path:        "/api/share-links/{id}/access-logs",
		Tags:        []string{TagWebSession},
		Summary:     "Share link access logs",
		Description: "Web-console session endpoint. Lists access attempts for one share link.",
		Auth:        AuthSession,
		Parameters:  append([]Parameter{pathParam("id", "Share link id.", integerSchema("uint64"), 1)}, paginationParams()...),
		Responses:   okResponses("EnvelopeShareLinkAccessLogs"),
	},
	{
		ID:          "listWebhooks",
		Method:      http.MethodGet,
		Path:        "/api/webhooks",
		Tags:        []string{TagWebSession},
		Summary:     "List webhooks",
		Description: "Web-console session endpoint. Lists webhook endpoints for the logged-in user.",
		Auth:        AuthSession,
		Parameters:  paginationParams(),
		Responses:   okResponses("EnvelopeWebhookPage"),
	},
	{
		ID:          "createWebhook",
		Method:      http.MethodPost,
		Path:        "/api/webhooks",
		Tags:        []string{TagWebSession},
		Summary:     "Create webhook",
		Description: "Web-console session endpoint. Creates a webhook endpoint.",
		Auth:        AuthSession,
		RequestBody: &RequestBody{Description: "Webhook settings.", SchemaName: "WebhookRequest", Required: true},
		Responses:   createdResponses("EnvelopeWebhook"),
	},
	{
		ID:          "patchWebhook",
		Method:      http.MethodPatch,
		Path:        "/api/webhooks/{id}",
		Tags:        []string{TagWebSession},
		Summary:     "Update webhook",
		Description: "Web-console session endpoint. Updates a webhook endpoint.",
		Auth:        AuthSession,
		Parameters:  []Parameter{pathParam("id", "Webhook id.", integerSchema("uint64"), 1)},
		RequestBody: &RequestBody{Description: "Webhook patch.", SchemaName: "PatchWebhookRequest", Required: false},
		Responses:   okResponses("EnvelopeWebhook"),
	},
	{
		ID:          "deleteWebhook",
		Method:      http.MethodDelete,
		Path:        "/api/webhooks/{id}",
		Tags:        []string{TagWebSession},
		Summary:     "Delete webhook",
		Description: "Web-console session endpoint. Deletes a webhook endpoint.",
		Auth:        AuthSession,
		Parameters:  []Parameter{pathParam("id", "Webhook id.", integerSchema("uint64"), 1)},
		Responses:   okResponses("EnvelopeDeleted"),
	},
	{
		ID:          "rotateWebhookSecret",
		Method:      http.MethodPost,
		Path:        "/api/webhooks/{id}/rotate-secret",
		Tags:        []string{TagWebSession},
		Summary:     "Rotate webhook secret",
		Description: "Web-console session endpoint. Rotates the signing secret for a webhook endpoint.",
		Auth:        AuthSession,
		Parameters:  []Parameter{pathParam("id", "Webhook id.", integerSchema("uint64"), 1)},
		Responses:   okResponses("EnvelopeWebhook"),
	},
	{
		ID:          "testWebhook",
		Method:      http.MethodPost,
		Path:        "/api/webhooks/{id}/test",
		Tags:        []string{TagWebSession},
		Summary:     "Test webhook",
		Description: "Web-console session endpoint. Enqueues a test webhook delivery.",
		Auth:        AuthSession,
		Parameters:  []Parameter{pathParam("id", "Webhook id.", integerSchema("uint64"), 1)},
		Responses:   okResponses("EnvelopeWebhookDelivery"),
	},
	{
		ID:          "listWebhookDeliveries",
		Method:      http.MethodGet,
		Path:        "/api/webhooks/{id}/deliveries",
		Tags:        []string{TagWebSession},
		Summary:     "Webhook deliveries",
		Description: "Web-console session endpoint. Lists delivery attempts for one webhook endpoint.",
		Auth:        AuthSession,
		Parameters:  append([]Parameter{pathParam("id", "Webhook id.", integerSchema("uint64"), 1)}, paginationParams()...),
		Responses:   okResponses("EnvelopeWebhookDeliveries"),
	},
}

func Operations() []Operation {
	out := append([]Operation(nil), registry...)
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Path == out[j].Path {
			return methodOrder(out[i].Method) < methodOrder(out[j].Method)
		}
		return out[i].Path < out[j].Path
	})
	return out
}

func AutomationOperations() []Operation {
	return filterOperations(func(op Operation) bool { return op.IsAutomation() })
}

func PublicMetaOperations() []Operation {
	return filterOperations(func(op Operation) bool { return op.IsPublicMeta() })
}

func WebSessionOperations() []Operation {
	return filterOperations(func(op Operation) bool { return op.IsWebSession() })
}

func OpenAPIDocument(cfg Config) OpenAPI {
	baseURL := strings.TrimRight(cfg.BaseURL, "/")
	if baseURL == "" {
		baseURL = "http://localhost:3000"
	}
	version := strings.TrimSpace(cfg.Version)
	if version == "" {
		version = "dev"
	}
	doc := OpenAPI{
		OpenAPI: "3.0.3",
		Info: Info{
			Title:       "HLOOL Mail API",
			Version:     version,
			Description: "Machine-readable API metadata rendered from the internal apispec registry.",
		},
		Servers: []Server{{URL: baseURL, Description: "Configured public base URL"}},
		Tags: []Tag{
			{Name: TagAutomation, Description: "Stable API-key automation surface for agents and scripts."},
			{Name: TagPublicMeta, Description: "Public metadata and documentation endpoints. API-key headers are ignored for quota purposes."},
			{Name: TagWebSession, Description: "Web-console endpoints that require the gptmail_session cookie/session. They are not API-key automation endpoints."},
		},
		Paths: map[string]PathItem{},
		Components: Components{
			Schemas: AllSchemas(),
			SecuritySchemes: map[string]SecurityScheme{
				"apiKeyAuth": {
					Type:        "apiKey",
					In:          "header",
					Name:        "X-API-Key",
					Description: "API key used for automation endpoints.",
				},
				"sessionCookie": {
					Type:        "apiKey",
					In:          "cookie",
					Name:        "gptmail_session",
					Description: "Web console session cookie used for session-only management endpoints.",
				},
			},
		},
		XHloolFrontend: FrontendProjection(),
	}
	for _, op := range Operations() {
		item := doc.Paths[op.Path]
		if item == nil {
			item = PathItem{}
		}
		item[strings.ToLower(op.Method)] = openAPIOperation(op)
		doc.Paths[op.Path] = item
	}
	return doc
}

func JSON(cfg Config) ([]byte, error) {
	return json.MarshalIndent(OpenAPIDocument(cfg), "", "  ")
}

func YAML(cfg Config) ([]byte, error) {
	return yaml.Marshal(OpenAPIDocument(cfg))
}

func openAPIOperation(op Operation) OpenAPIOperation {
	out := OpenAPIOperation{
		Tags:        op.Tags,
		Summary:     op.Summary,
		Description: op.Description,
		OperationID: op.ID,
		Security:    operationSecurity(op.Auth),
		Parameters:  openAPIParameters(op.Parameters),
		Responses:   openAPIResponses(op),
		XHloolAuth:  authLabel(op.Auth),
	}
	if op.RequestBody != nil {
		content := MediaContent{Schema: schemaRef(op.RequestBody.SchemaName)}
		if strings.TrimSpace(op.RequestBody.Example) != "" {
			var example any
			if err := json.Unmarshal([]byte(op.RequestBody.Example), &example); err == nil {
				content.Example = example
			}
		}
		out.RequestBody = &OpenAPIRequestBody{
			Description: op.RequestBody.Description,
			Required:    op.RequestBody.Required,
			Content:     map[string]MediaContent{"application/json": content},
		}
	}
	return out
}

func openAPIParameters(params []Parameter) []OpenAPIParameter {
	if len(params) == 0 {
		return nil
	}
	out := make([]OpenAPIParameter, 0, len(params))
	for _, param := range params {
		out = append(out, OpenAPIParameter{
			Name:        param.Name,
			In:          param.In,
			Required:    param.Required,
			Description: param.Description,
			Schema:      param.Schema,
			Example:     param.Example,
		})
	}
	return out
}

func openAPIResponses(op Operation) map[string]OpenAPIResponse {
	responses := map[string]OpenAPIResponse{}
	for _, response := range op.Responses {
		out := OpenAPIResponse{Description: response.Description}
		if response.SchemaName != "" {
			out.Content = map[string]MediaContent{
				"application/json": {Schema: schemaRef(response.SchemaName)},
			}
		} else if op.Path == "/api/docs.md" || op.Path == "/api/skill.md" {
			out.Content = map[string]MediaContent{
				"text/markdown": {Schema: stringSchema("")},
			}
		} else if strings.HasSuffix(op.Path, ".yaml") {
			out.Content = map[string]MediaContent{
				"application/yaml": {Schema: stringSchema("")},
			}
		} else {
			out.Content = map[string]MediaContent{
				"application/json": {Schema: Schema{"type": "object", "additionalProperties": true}},
			}
		}
		responses[strconv.Itoa(response.Status)] = out
	}
	for _, status := range []int{http.StatusBadRequest, http.StatusUnauthorized, http.StatusForbidden, http.StatusNotFound, http.StatusTooManyRequests, http.StatusInternalServerError} {
		if _, exists := responses[strconv.Itoa(status)]; exists {
			continue
		}
		responses[strconv.Itoa(status)] = OpenAPIResponse{
			Description: http.StatusText(status),
			Content: map[string]MediaContent{
				"application/json": {Schema: schemaRef("ErrorEnvelope")},
			},
		}
	}
	return responses
}

func operationSecurity(auth AuthKind) []map[string][]string {
	switch auth {
	case AuthAPIKey:
		return []map[string][]string{{"apiKeyAuth": []string{}}}
	case AuthSession:
		return []map[string][]string{{"sessionCookie": []string{}}}
	default:
		return nil
	}
}

func authLabel(auth AuthKind) string {
	switch auth {
	case AuthAPIKey:
		return "X-API-Key"
	case AuthSession:
		return "cookie/session"
	default:
		return "public"
	}
}

func okResponses(schemaName string) []OperationResponse {
	return []OperationResponse{{Status: http.StatusOK, Description: "Success", SchemaName: schemaName}}
}

func createdResponses(schemaName string) []OperationResponse {
	return []OperationResponse{{Status: http.StatusCreated, Description: "Created", SchemaName: schemaName}}
}

func pathParam(name, description string, schema Schema, example any) Parameter {
	return Parameter{Name: name, In: "path", Required: true, Description: description, Schema: schema, Example: example}
}

func queryParam(name, description string, schema Schema, required bool, example any) Parameter {
	return Parameter{Name: name, In: "query", Required: required, Description: description, Schema: schema, Example: example}
}

func paginationParams() []Parameter {
	return []Parameter{
		queryParam("page", "Page number for pagination.", integerSchema("int32"), false, 1),
		queryParam("per_page", "Items per page.", integerSchema("int32"), false, 20),
	}
}

func filterOperations(keep func(Operation) bool) []Operation {
	var out []Operation
	for _, op := range Operations() {
		if keep(op) {
			out = append(out, op)
		}
	}
	return out
}

func methodOrder(method string) int {
	switch method {
	case http.MethodGet:
		return 0
	case http.MethodPost:
		return 1
	case http.MethodPatch:
		return 2
	case http.MethodDelete:
		return 3
	default:
		return 10
	}
}
