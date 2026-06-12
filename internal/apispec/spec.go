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

// This registry is the OpenAPI/docs source of truth. Keep it on the stable
// /api/... surface: no /api/v1, no SSE streams, and no admin/auth/API-key
// management endpoints in the API-key automation group.
var registry = []Operation{
	{
		ID:          "health",
		Method:      http.MethodGet,
		Path:        "/api/health",
		Tags:        []string{TagPublicMeta},
		Summary:     "健康检查",
		Description: "返回服务健康状态元数据。",
		Auth:        AuthPublic,
		Responses:   okResponses("EnvelopeHealth"),
		Frontend: &FrontendHints{
			Title:       "健康状态",
			Description: "检查 API 服务是否可访问。",
			RequestPath: "/api/health",
		},
	},
	{
		ID:          "versionInfo",
		Method:      http.MethodGet,
		Path:        "/api/version",
		Tags:        []string{TagPublicMeta},
		Summary:     "版本信息",
		Description: "返回当前服务版本、commit 和构建时间。",
		Auth:        AuthPublic,
		Responses:   okResponses("EnvelopeVersion"),
		Frontend: &FrontendHints{
			Title:       "版本信息",
			Description: "读取服务版本元数据。",
			RequestPath: "/api/version",
		},
	},
	{
		ID:          "apiDocsMarkdown",
		Method:      http.MethodGet,
		Path:        "/api/docs.md",
		Tags:        []string{TagPublicMeta},
		Summary:     "Markdown API 指南",
		Description: "返回由 API 注册表生成、适合 AI 阅读的 Markdown 指南。",
		Auth:        AuthPublic,
		Responses: []OperationResponse{
			{Status: http.StatusOK, Description: "Markdown 文档", SchemaName: ""},
		},
		Frontend: &FrontendHints{
			Title:       "Markdown 文档",
			Description: "读取适合 AI 阅读的 Markdown API 参考。",
			RequestPath: "/api/docs.md",
		},
	},
	{
		ID:          "apiSkillMarkdown",
		Method:      http.MethodGet,
		Path:        "/api/skill.md",
		Tags:        []string{TagPublicMeta},
		Summary:     "Skill 指南",
		Description: "返回由 API 注册表生成的 AI 助手 Skill 指南。",
		Auth:        AuthPublic,
		Responses: []OperationResponse{
			{Status: http.StatusOK, Description: "Markdown Skill 文档", SchemaName: ""},
		},
		Frontend: &FrontendHints{
			Title:       "Skill 指南",
			Description: "读取 AI 助手 Skill 使用说明。",
			RequestPath: "/api/skill.md",
		},
	},
	{
		ID:          "openAPIJSON",
		Method:      http.MethodGet,
		Path:        "/api/openapi.json",
		Tags:        []string{TagPublicMeta},
		Summary:     "OpenAPI JSON",
		Description: "返回 JSON 格式的 OpenAPI 文档。",
		Auth:        AuthPublic,
		Responses: []OperationResponse{
			{Status: http.StatusOK, Description: "OpenAPI JSON 文档", SchemaName: ""},
		},
		Frontend: &FrontendHints{
			Title:       "OpenAPI JSON",
			Description: "读取机器可读的 OpenAPI 文档。",
			RequestPath: "/api/openapi.json",
		},
	},
	{
		ID:          "openAPIYAML",
		Method:      http.MethodGet,
		Path:        "/api/openapi.yaml",
		Tags:        []string{TagPublicMeta},
		Summary:     "OpenAPI YAML",
		Description: "返回 YAML 格式的 OpenAPI 文档。",
		Auth:        AuthPublic,
		Responses: []OperationResponse{
			{Status: http.StatusOK, Description: "OpenAPI YAML 文档", SchemaName: ""},
		},
		Frontend: &FrontendHints{
			Title:       "OpenAPI YAML",
			Description: "读取 YAML 格式的机器可读 OpenAPI 文档。",
			RequestPath: "/api/openapi.yaml",
		},
	},
	{
		ID:          "availableDomains",
		Method:      http.MethodGet,
		Path:        "/api/domains/available",
		Tags:        []string{TagAutomation},
		Summary:     "可用域名",
		Description: "列出可选择的公共域名以及 API Key 拥有者可访问的私有域名。客户端和 AI 助手应把该端点作为生成邮箱前的域名选择入口，优先使用 data.public_domains 与 data.private_domains；data.domains 仅为旧客户端公共域名兼容字段。",
		Auth:        AuthAPIKey,
		Responses:   okResponses("EnvelopeAvailableDomains"),
		Frontend: &FrontendHints{
			Title:       "可用域名",
			Description: "生成邮箱前先用它发现公共域名和当前 API Key 可访问的私有域名。",
			RequestPath: "/api/domains/available",
		},
	},
	{
		ID:          "generateEmail",
		Method:      http.MethodPost,
		Path:        "/api/generate-email",
		Tags:        []string{TagAutomation},
		Summary:     "生成邮箱",
		Description: "为 API Key 调用方创建或复用邮箱。默认生成普通邮箱 prefix@domain；设置 address_type=subdomain 可生成泛子域名邮箱 prefix@subdomain.domain，subdomain 留空时自动生成。传入 domain=*.example.com 会按父域 example.com 的泛子域名邮箱处理。设置 share=true 或 share.enabled=true 可在同一响应中创建邮箱分享；返回的 data.share.url 是分享页 URL，data.share.access_url 会在 URL fragment 中带上 #key=。",
		Auth:        AuthAPIKey,
		RequestBody: &RequestBody{Description: "可选的邮箱生成参数。", SchemaName: "GenerateEmailRequest", Example: "{\n  \"prefix\": \"verify\",\n  \"domain\": \"example.com\",\n  \"address_type\": \"root\",\n  \"share\": true\n}", Required: false},
		Responses: []OperationResponse{
			{Status: http.StatusCreated, Description: "邮箱已创建", SchemaName: "EnvelopeGenerateEmail"},
			{Status: http.StatusOK, Description: "复用已有邮箱", SchemaName: "EnvelopeGenerateEmail"},
		},
		Frontend: &FrontendHints{
			Title:        "生成邮箱",
			Description:  "创建邮箱，可同时生成带访问 key 的分享 URL。",
			RequestPath:  "/api/generate-email",
			BodyTemplate: "{\n  \"prefix\": \"verify\",\n  \"domain\": \"\",\n  \"address_type\": \"root\",\n  \"subdomain\": \"\",\n  \"share\": false\n}",
		},
	},
	{
		ID:          "listMailboxes",
		Method:      http.MethodGet,
		Path:        "/api/mailboxes",
		Tags:        []string{TagAutomation},
		Summary:     "邮箱列表",
		Description: "列出 API Key 拥有者创建的邮箱。使用 page 和 per_page 获取分页响应。",
		Auth:        AuthAPIKey,
		Parameters: []Parameter{
			queryParam("page", "分页页码。", integerSchema("int32"), false, 1),
			queryParam("per_page", "每页数量。", integerSchema("int32"), false, 20),
			queryParam("q", "可按邮箱地址、本地部分或主机名搜索。", stringSchema(""), false, "verify"),
		},
		Responses: okResponses("EnvelopeMailboxPage"),
		Frontend: &FrontendHints{
			Title:         "邮箱列表",
			Description:   "列出 API Key 拥有者创建的邮箱。",
			RequestPath:   "/api/mailboxes",
			QueryTemplate: "page=1&per_page=20",
		},
	},
	{
		ID:          "deleteMailbox",
		Method:      http.MethodDelete,
		Path:        "/api/mailboxes/{id}",
		Tags:        []string{TagAutomation},
		Summary:     "删除邮箱",
		Description: "删除指定邮箱记录以及该地址下已存储的邮件。",
		Auth:        AuthAPIKey,
		Parameters:  []Parameter{pathParam("id", "邮箱 ID。", integerSchema("uint64"), 45)},
		Responses:   okResponses("EnvelopeMailboxDelete"),
		Frontend: &FrontendHints{
			Title:       "删除邮箱",
			Description: "删除一个邮箱记录及其已存储邮件。",
			RequestPath: "/api/mailboxes/45",
			Dangerous:   true,
		},
	},
	{
		ID:          "listEmails",
		Method:      http.MethodGet,
		Path:        "/api/emails",
		Tags:        []string{TagAutomation},
		Summary:     "邮件列表",
		Description: "列出某个邮箱的邮件，不改变已读状态。使用 page 和 per_page 获取分页元数据。",
		Auth:        AuthAPIKey,
		Parameters: []Parameter{
			queryParam("email", "邮箱地址。", stringSchema("email"), true, "verify@example.com"),
			queryParam("page", "分页页码。", integerSchema("int32"), false, 1),
			queryParam("per_page", "每页数量。", integerSchema("int32"), false, 20),
			queryParam("limit", "兼容旧数组响应的数量限制。", integerSchema("int32"), false, 50),
		},
		Responses: okResponses("EnvelopeMessagePage"),
		Frontend: &FrontendHints{
			Title:         "邮件列表",
			Description:   "列出邮箱邮件，不会自动标记已读。",
			RequestPath:   "/api/emails",
			QueryTemplate: "email=verify@example.com&page=1&per_page=20",
		},
	},
	{
		ID:          "nextEmail",
		Method:      http.MethodGet,
		Path:        "/api/emails/next",
		Tags:        []string{TagAutomation},
		Summary:     "下一封未读邮件",
		Description: "返回邮箱中最新的未读邮件，并自动将该邮件标记为已读。没有未读邮件时返回 has_email=false。",
		Auth:        AuthAPIKey,
		Parameters:  []Parameter{queryParam("email", "邮箱地址。", stringSchema("email"), true, "verify@example.com")},
		Responses:   okResponses("EnvelopeNextEmail"),
		Frontend: &FrontendHints{
			Title:         "下一封未读邮件",
			Description:   "轮询最新未读邮件，并自动标记为已读。",
			RequestPath:   "/api/emails/next",
			QueryTemplate: "email=verify@example.com",
		},
	},
	{
		ID:          "getEmail",
		Method:      http.MethodGet,
		Path:        "/api/email/{id}",
		Tags:        []string{TagAutomation},
		Summary:     "读取邮件",
		Description: "按 ID 读取一封邮件，包含文本正文、可用时的安全 HTML、邮件头和附件元数据。",
		Auth:        AuthAPIKey,
		Parameters:  []Parameter{pathParam("id", "邮件 ID。", stringSchema(""), "msg-uuid")},
		Responses:   okResponses("EnvelopeMessageDetail"),
		Frontend: &FrontendHints{
			Title:       "读取邮件",
			Description: "读取一封邮件的正文、邮件头、已读状态和附件元数据。",
			RequestPath: "/api/email/msg-uuid",
		},
	},
	{
		ID:          "markEmailRead",
		Method:      http.MethodPatch,
		Path:        "/api/email/{id}/read",
		Tags:        []string{TagAutomation},
		Summary:     "标记邮件已读",
		Description: "将一封邮件标记为已读。",
		Auth:        AuthAPIKey,
		Parameters:  []Parameter{pathParam("id", "邮件 ID。", stringSchema(""), "msg-uuid")},
		Responses:   okResponses("EnvelopeMarkRead"),
		Frontend: &FrontendHints{
			Title:       "标记已读",
			Description: "将一封邮件标记为已读。",
			RequestPath: "/api/email/msg-uuid/read",
		},
	},
	{
		ID:          "deleteEmail",
		Method:      http.MethodDelete,
		Path:        "/api/email/{id}",
		Tags:        []string{TagAutomation},
		Summary:     "删除邮件",
		Description: "删除 API Key 调用方有权限访问的一封邮件。",
		Auth:        AuthAPIKey,
		Parameters:  []Parameter{pathParam("id", "邮件 ID。", stringSchema(""), "msg-uuid")},
		Responses:   okResponses("EnvelopeDeleteMessage"),
		Frontend: &FrontendHints{
			Title:       "删除邮件",
			Description: "删除当前 API Key 可访问的一封邮件。",
			RequestPath: "/api/email/msg-uuid",
			Dangerous:   true,
		},
	},
	{
		ID:          "clearEmails",
		Method:      http.MethodDelete,
		Path:        "/api/emails/clear",
		Tags:        []string{TagAutomation},
		Summary:     "清空邮箱邮件",
		Description: "删除某个邮箱中已存储的全部邮件。",
		Auth:        AuthAPIKey,
		Parameters:  []Parameter{queryParam("email", "邮箱地址。", stringSchema("email"), true, "verify@example.com")},
		Responses:   okResponses("EnvelopeClearEmails"),
		Frontend: &FrontendHints{
			Title:         "清空收件箱",
			Description:   "删除一个邮箱中的全部邮件。",
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
		Summary:     "统计信息",
		Description: "返回 API Key 拥有者可见的统计数据。",
		Auth:        AuthAPIKey,
		Responses:   okResponses("EnvelopeStats"),
		Frontend: &FrontendHints{
			Title:       "统计信息",
			Description: "获取 API Key 拥有者可见的统计数据。",
			RequestPath: "/api/stats",
		},
	},
	{
		ID:          "getSharedLink",
		Method:      http.MethodGet,
		Path:        "/api/shared/{token}",
		Tags:        []string{TagPublicShare},
		Summary:     "读取分享邮箱",
		Description: "邮箱分享 token 的公开端点。没有 key 时返回锁定元数据，带 key 时返回邮箱元数据。",
		Auth:        AuthPublic,
		Parameters: []Parameter{
			pathParam("token", "创建分享时一次性返回的分享 token。", stringSchema(""), "share-hloolmail_xxx"),
			queryParam("key", "邮箱分享访问 key，传入后可解锁邮箱分享。", stringSchema(""), false, "sharekey-hloolmail_xxx"),
		},
		Responses: okResponses("EnvelopePublicShared"),
		Frontend: &FrontendHints{
			Title:         "读取分享邮箱",
			Description:   "打开分享 token；邮箱分享可用 key 解锁。",
			RequestPath:   "/api/shared/share-hloolmail_xxx",
			QueryTemplate: "key=sharekey-hloolmail_xxx",
		},
	},
	{
		ID:          "listSharedMailboxMessages",
		Method:      http.MethodGet,
		Path:        "/api/shared/{token}/messages",
		Tags:        []string{TagPublicShare},
		Summary:     "分享邮箱邮件列表",
		Description: "列出邮箱分享中的邮件。必须在 key 查询参数中提供分享访问 key。",
		Auth:        AuthPublic,
		Parameters: []Parameter{
			pathParam("token", "邮箱分享 token。", stringSchema(""), "share-hloolmail_xxx"),
			queryParam("key", "邮箱分享访问 key。", stringSchema(""), true, "sharekey-hloolmail_xxx"),
			queryParam("page", "分页页码。", integerSchema("int32"), false, 1),
			queryParam("per_page", "每页数量。", integerSchema("int32"), false, 20),
		},
		Responses: okResponses("EnvelopePublicSharedMailboxMessages"),
		Frontend: &FrontendHints{
			Title:         "分享邮箱邮件列表",
			Description:   "列出带 key 的邮箱分享中的邮件。",
			RequestPath:   "/api/shared/share-hloolmail_xxx/messages",
			QueryTemplate: "key=sharekey-hloolmail_xxx&page=1&per_page=20",
		},
	},
	{
		ID:          "getSharedMailboxMessage",
		Method:      http.MethodGet,
		Path:        "/api/shared/{token}/messages/{message_id}",
		Tags:        []string{TagPublicShare},
		Summary:     "读取分享邮箱邮件",
		Description: "从邮箱分享中读取一封邮件。必须提供分享访问 key，且只返回属于该分享邮箱的邮件。",
		Auth:        AuthPublic,
		Parameters: []Parameter{
			pathParam("token", "邮箱分享 token。", stringSchema(""), "share-hloolmail_xxx"),
			pathParam("message_id", "分享邮箱内的邮件 ID。", stringSchema(""), "msg-uuid"),
			queryParam("key", "邮箱分享访问 key。", stringSchema(""), true, "sharekey-hloolmail_xxx"),
		},
		Responses: okResponses("EnvelopePublicSharedMailboxMessage"),
		Frontend: &FrontendHints{
			Title:         "读取分享邮箱邮件",
			Description:   "从带 key 的邮箱分享中读取一封邮件。",
			RequestPath:   "/api/shared/share-hloolmail_xxx/messages/msg-uuid",
			QueryTemplate: "key=sharekey-hloolmail_xxx",
		},
	},
	{
		ID:          "createShareLink",
		Method:      http.MethodPost,
		Path:        "/api/share-links",
		Tags:        []string{TagWebSession},
		Summary:     "创建分享链接",
		Description: "网页登录会话端点。为当前登录用户创建邮箱分享链接。",
		Auth:        AuthSession,
		RequestBody: &RequestBody{Description: "邮箱分享链接设置。", SchemaName: "CreateShareLinkRequest", Example: "{\n  \"resource_type\": \"mailbox\",\n  \"mailbox_id\": 45\n}", Required: true},
		Responses:   createdResponses("EnvelopeShareLink"),
	},
	{
		ID:          "listShareLinks",
		Method:      http.MethodGet,
		Path:        "/api/share-links",
		Tags:        []string{TagWebSession},
		Summary:     "分享链接列表",
		Description: "网页登录会话端点。列出当前登录用户的分享链接。",
		Auth:        AuthSession,
		Parameters:  paginationParams(),
		Responses:   okResponses("EnvelopeShareLinkPage"),
	},
	{
		ID:          "getShareLink",
		Method:      http.MethodGet,
		Path:        "/api/share-links/{id}",
		Tags:        []string{TagWebSession},
		Summary:     "读取分享链接",
		Description: "网页登录会话端点。读取一个已管理的分享链接。",
		Auth:        AuthSession,
		Parameters:  []Parameter{pathParam("id", "分享链接 ID。", integerSchema("uint64"), 1)},
		Responses:   okResponses("EnvelopeShareLink"),
	},
	{
		ID:          "patchShareLink",
		Method:      http.MethodPatch,
		Path:        "/api/share-links/{id}",
		Tags:        []string{TagWebSession},
		Summary:     "更新分享链接",
		Description: "网页登录会话端点。更新一个邮箱分享链接的过期时间。",
		Auth:        AuthSession,
		Parameters:  []Parameter{pathParam("id", "分享链接 ID。", integerSchema("uint64"), 1)},
		RequestBody: &RequestBody{Description: "邮箱分享链接更新内容。", SchemaName: "PatchShareLinkRequest", Example: "{\n  \"expires_at\": \"2026-06-01T00:00:00Z\"\n}", Required: false},
		Responses:   okResponses("EnvelopeShareLink"),
	},
	{
		ID:          "revokeShareLink",
		Method:      http.MethodPost,
		Path:        "/api/share-links/{id}/revoke",
		Tags:        []string{TagWebSession},
		Summary:     "撤销分享链接",
		Description: "网页登录会话端点。撤销一个分享链接。",
		Auth:        AuthSession,
		Parameters:  []Parameter{pathParam("id", "分享链接 ID。", integerSchema("uint64"), 1)},
		Responses:   okResponses("EnvelopeShareLink"),
	},
	{
		ID:          "deleteShareLink",
		Method:      http.MethodDelete,
		Path:        "/api/share-links/{id}",
		Tags:        []string{TagWebSession},
		Summary:     "Delete share link",
		Description: "Session-only endpoint. Deletes one managed share link and its access logs.",
		Auth:        AuthSession,
		Parameters:  []Parameter{pathParam("id", "Share link ID.", integerSchema("uint64"), 1)},
		Responses:   okResponses("EnvelopeDeleted"),
	},
	{
		ID:          "rotateShareLinkToken",
		Method:      http.MethodPost,
		Path:        "/api/share-links/{id}/rotate-token",
		Tags:        []string{TagWebSession},
		Summary:     "重新生成完整分享链接",
		Description: "网页登录会话端点。重新生成邮箱分享的公开 token；邮箱分享会同时轮换访问 key，并只在本次响应返回完整 access_url。",
		Auth:        AuthSession,
		Parameters:  []Parameter{pathParam("id", "分享链接 ID。", integerSchema("uint64"), 1)},
		Responses:   okResponses("EnvelopeShareLink"),
	},
	{
		ID:          "rotateShareLinkKey",
		Method:      http.MethodPost,
		Path:        "/api/share-links/{id}/rotate-key",
		Tags:        []string{TagWebSession},
		Summary:     "轮换邮箱分享 key",
		Description: "网页登录会话端点。轮换一个邮箱分享的访问 key，并只返回一次新 key。",
		Auth:        AuthSession,
		Parameters:  []Parameter{pathParam("id", "分享链接 ID。", integerSchema("uint64"), 1)},
		Responses:   okResponses("EnvelopeShareLink"),
	},
	{
		ID:          "listShareLinkAccessLogs",
		Method:      http.MethodGet,
		Path:        "/api/share-links/{id}/access-logs",
		Tags:        []string{TagWebSession},
		Summary:     "分享链接访问日志",
		Description: "网页登录会话端点。列出一个分享链接的访问尝试记录。",
		Auth:        AuthSession,
		Parameters:  append([]Parameter{pathParam("id", "分享链接 ID。", integerSchema("uint64"), 1)}, paginationParams()...),
		Responses:   okResponses("EnvelopeShareLinkAccessLogs"),
	},
	{
		ID:          "listWebhooks",
		Method:      http.MethodGet,
		Path:        "/api/webhooks",
		Tags:        []string{TagWebSession},
		Summary:     "Webhook 列表",
		Description: "网页登录会话端点。列出当前登录用户的 Webhook 端点。",
		Auth:        AuthSession,
		Parameters:  paginationParams(),
		Responses:   okResponses("EnvelopeWebhookPage"),
	},
	{
		ID:          "createWebhook",
		Method:      http.MethodPost,
		Path:        "/api/webhooks",
		Tags:        []string{TagWebSession},
		Summary:     "创建 Webhook",
		Description: "网页登录会话端点。创建一个 Webhook 端点。",
		Auth:        AuthSession,
		RequestBody: &RequestBody{Description: "Webhook 设置。", SchemaName: "WebhookRequest", Required: true},
		Responses:   createdResponses("EnvelopeWebhook"),
	},
	{
		ID:          "patchWebhook",
		Method:      http.MethodPatch,
		Path:        "/api/webhooks/{id}",
		Tags:        []string{TagWebSession},
		Summary:     "更新 Webhook",
		Description: "网页登录会话端点。更新一个 Webhook 端点。",
		Auth:        AuthSession,
		Parameters:  []Parameter{pathParam("id", "Webhook ID。", integerSchema("uint64"), 1)},
		RequestBody: &RequestBody{Description: "Webhook 更新内容。", SchemaName: "PatchWebhookRequest", Required: false},
		Responses:   okResponses("EnvelopeWebhook"),
	},
	{
		ID:          "deleteWebhook",
		Method:      http.MethodDelete,
		Path:        "/api/webhooks/{id}",
		Tags:        []string{TagWebSession},
		Summary:     "删除 Webhook",
		Description: "网页登录会话端点。删除一个 Webhook 端点。",
		Auth:        AuthSession,
		Parameters:  []Parameter{pathParam("id", "Webhook ID。", integerSchema("uint64"), 1)},
		Responses:   okResponses("EnvelopeDeleted"),
	},
	{
		ID:          "rotateWebhookSecret",
		Method:      http.MethodPost,
		Path:        "/api/webhooks/{id}/rotate-secret",
		Tags:        []string{TagWebSession},
		Summary:     "轮换 Webhook secret",
		Description: "网页登录会话端点。轮换一个 Webhook 端点的签名 secret。",
		Auth:        AuthSession,
		Parameters:  []Parameter{pathParam("id", "Webhook ID。", integerSchema("uint64"), 1)},
		Responses:   okResponses("EnvelopeWebhook"),
	},
	{
		ID:          "testWebhook",
		Method:      http.MethodPost,
		Path:        "/api/webhooks/{id}/test",
		Tags:        []string{TagWebSession},
		Summary:     "测试 Webhook",
		Description: "网页登录会话端点。将一次测试 Webhook 投递加入队列。",
		Auth:        AuthSession,
		Parameters:  []Parameter{pathParam("id", "Webhook ID。", integerSchema("uint64"), 1)},
		Responses:   okResponses("EnvelopeWebhookDelivery"),
	},
	{
		ID:          "listWebhookDeliveries",
		Method:      http.MethodGet,
		Path:        "/api/webhooks/{id}/deliveries",
		Tags:        []string{TagWebSession},
		Summary:     "Webhook 投递记录",
		Description: "网页登录会话端点。列出一个 Webhook 端点的投递尝试记录。",
		Auth:        AuthSession,
		Parameters:  append([]Parameter{pathParam("id", "Webhook ID。", integerSchema("uint64"), 1)}, paginationParams()...),
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

func RegisteredRoutes() []RegisteredRoute {
	ops := Operations()
	out := make([]RegisteredRoute, 0, len(ops))
	for _, op := range ops {
		out = append(out, RegisteredRoute{
			ID:     op.ID,
			Method: op.Method,
			Path:   op.Path,
		})
	}
	return out
}

func AutomationOperations() []Operation {
	return filterOperations(func(op Operation) bool { return op.IsAutomation() })
}

func PublicMetaOperations() []Operation {
	return filterOperations(func(op Operation) bool { return op.IsPublicMeta() })
}

func PublicShareOperations() []Operation {
	return filterOperations(func(op Operation) bool { return op.IsPublicShare() })
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
			Description: "由内部 apispec 注册表生成的机器可读 API 元数据。",
		},
		Servers: []Server{{URL: baseURL, Description: "已配置的公开基础 URL"}},
		Tags: []Tag{
			{Name: TagAutomation, Description: "供 Agent 和脚本使用的稳定 API Key 自动化接口。"},
			{Name: TagPublicMeta, Description: "公开元数据和文档端点；API Key 请求头不会计入配额。"},
			{Name: TagPublicShare, Description: "使用不可猜测分享 token 和可选邮箱访问 key 的公开分享端点。"},
			{Name: TagWebSession, Description: "需要 gptmail_session Cookie/会话的 Web Console 端点，不属于 API Key 自动化接口。"},
		},
		Paths: map[string]PathItem{},
		Components: Components{
			Schemas: AllSchemas(),
			SecuritySchemes: map[string]SecurityScheme{
				"apiKeyAuth": {
					Type:        "apiKey",
					In:          "header",
					Name:        "X-API-Key",
					Description: "自动化端点使用的 API Key。",
				},
				"sessionCookie": {
					Type:        "apiKey",
					In:          "cookie",
					Name:        "gptmail_session",
					Description: "Web Console 会话专用管理端点使用的会话 Cookie。",
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
	for _, status := range []int{http.StatusBadRequest, http.StatusUnauthorized, http.StatusForbidden, http.StatusNotFound, http.StatusGone, http.StatusTooManyRequests, http.StatusInternalServerError} {
		if _, exists := responses[strconv.Itoa(status)]; exists {
			continue
		}
		responses[strconv.Itoa(status)] = OpenAPIResponse{
			Description: statusTextCN(status),
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
	return []OperationResponse{{Status: http.StatusOK, Description: "成功", SchemaName: schemaName}}
}

func createdResponses(schemaName string) []OperationResponse {
	return []OperationResponse{{Status: http.StatusCreated, Description: "已创建", SchemaName: schemaName}}
}

func pathParam(name, description string, schema Schema, example any) Parameter {
	return Parameter{Name: name, In: "path", Required: true, Description: description, Schema: schema, Example: example}
}

func queryParam(name, description string, schema Schema, required bool, example any) Parameter {
	return Parameter{Name: name, In: "query", Required: required, Description: description, Schema: schema, Example: example}
}

func paginationParams() []Parameter {
	return []Parameter{
		queryParam("page", "分页页码。", integerSchema("int32"), false, 1),
		queryParam("per_page", "每页数量。", integerSchema("int32"), false, 20),
	}
}

func statusTextCN(status int) string {
	switch status {
	case http.StatusBadRequest:
		return "请求参数错误"
	case http.StatusUnauthorized:
		return "未认证"
	case http.StatusForbidden:
		return "无权限"
	case http.StatusNotFound:
		return "未找到"
	case http.StatusGone:
		return "资源已失效"
	case http.StatusTooManyRequests:
		return "请求过于频繁"
	case http.StatusInternalServerError:
		return "服务器内部错误"
	default:
		return http.StatusText(status)
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
