package apispec

import "strings"

func Markdown(cfg Config) string {
	baseURL := normalizedBaseURL(cfg.BaseURL)
	expectedMX := strings.TrimRight(firstNonEmpty(cfg.ExpectedMX, "mail.example.com"), ".")

	lines := []string{
		"# HLOOL Mail API 助手指南",
		"",
		"本文档和 OpenAPI 文档来自同一份接口注册表。不要反向猜测服务、隐藏端点或未声明参数；只使用这里描述的公开 API 行为。",
		"",
		"API 基础 URL: `" + baseURL + "`",
		"Markdown 文档: `" + baseURL + "/api/docs.md`",
		"OpenAPI JSON: `" + baseURL + "/api/openapi.json`",
		"OpenAPI YAML: `" + baseURL + "/api/openapi.yaml`",
		"本文档中的所有 HTTP 端点都使用 `/api/` 前缀。",
		"",
		"## 认证",
		"",
		"API Key 自动化调用使用请求头：",
		"",
		"```http",
		"X-API-Key: YOUR_KEY",
		"```",
		"",
		"API 自动化只使用 `X-API-Key`。域名管理、MX 检查、登录、用户管理和 API Key 创建都属于 Web Console 任务。",
		"",
		"## 公开 API 边界",
		"",
		"API Key 自动化接口刻意保持小而稳定。OpenAPI、Markdown 文档、Skill 文档、健康检查和版本端点属于公开元数据。`POST /api/generate-email` 可以在同一次 API Key 调用中创建带 key 的邮箱分享。分享链接和 Webhook 管理端点标记为 `cookie/session`，它们是 Web Console 会话端点，不属于 API Key 自动化接口。",
		"",
		"## 私有域名流程",
		"",
		"如果用户要使用 `example.com` 这样的私有域名，引导他们完成以下流程：",
		"",
		"1. 让用户在 Web Console 中添加 `example.com` 作为私有域名。",
		"2. 让用户在 DNS 服务商中添加指向平台 MX 目标的 MX 记录。",
		"3. 如果只需要 `user@example.com` 这类地址，根域 MX 记录就够了。",
		"4. 如果需要 `user@abc.example.com` 这类地址，还需要添加通配 MX 记录。",
		"5. DNS 生效后，让用户在 Web Console 中完成 MX 验证。",
		"6. 使用 API Key 调用 `POST /api/generate-email` 并传入私有域名。响应返回该域名时，说明 API 访问已可用。",
		"7. 可以通过 `GET /api/domains/available` 的 `data.private_domains` 发现当前 API Key 可访问的私有域名。",
		"",
		"用户需要添加的 DNS 记录：",
		"",
		"```dns",
		"example.com.    MX  10 " + expectedMX + ".",
		"*.example.com.  MX  10 " + expectedMX + ".",
		"```",
		"",
		"通配记录只在需要 `user@abc.example.com` 这类子域邮箱时才需要。",
		"",
		"验证私有域名 API 访问：",
		"",
		"```bash",
		"curl -X POST \"" + baseURL + operationByID("generateEmail").Path + "\" \\",
		"  -H \"Content-Type: application/json\" \\",
		"  -H \"X-API-Key: YOUR_KEY\" \\",
		"  -d '{\"prefix\":\"verify\",\"domain\":\"example.com\"}'",
		"```",
		"",
		"如果该调用返回域名或权限错误，常见原因包括 DNS 尚未传播、Web Console 域名配置未完成、API Key 不正确，或该域名属于另一个账号。",
		"",
		"## 公共域名流程",
		"",
		"公共域名适合快速测试，但部分网站可能会屏蔽临时邮箱域名。如果网站拒绝该地址或验证码邮件没有到达，可以建议换一个公共域名、换一个邮箱前缀、稍等片刻，或绑定私有域名。",
		"",
		"列出可用公共域名和当前 API Key 可访问的私有域名：",
		"",
		"```bash",
		"curl \"" + baseURL + operationByID("availableDomains").Path + "\" \\",
		"  -H \"X-API-Key: YOUR_KEY\"",
		"```",
		"",
		"`data.domains` 是兼容旧客户端的字段，只包含公共域名字符串。新客户端应优先使用 `data.public_domains` 和 `data.private_domains`。",
		"",
		"生成随机公共域名邮箱：",
		"",
		"```bash",
		"curl -X POST \"" + baseURL + operationByID("generateEmail").Path + "\" \\",
		"  -H \"Content-Type: application/json\" \\",
		"  -H \"X-API-Key: YOUR_KEY\" \\",
		"  -d '{}'",
		"```",
		"",
		"创建新邮箱记录时返回 HTTP `201`。如果同一个 API Key 拥有者再次生成已有邮箱，API 返回 HTTP `200`，并带有 `data.reuse=true`。",
		"",
		"一次调用生成邮箱和分享 URL：",
		"",
		"```bash",
		"curl -X POST \"" + baseURL + operationByID("generateEmail").Path + "\" \\",
		"  -H \"Content-Type: application/json\" \\",
		"  -H \"X-API-Key: YOUR_KEY\" \\",
		"  -d '{\"prefix\":\"verify\",\"domain\":\"example.com\",\"share\":true}'",
		"```",
		"",
		"响应包含 `data.share.url` 和 `data.share.access_url`。`access_url` 会带上随机 `key` 查询参数，可直接打开邮箱；移除 `?key=...` 后会进入公开解锁页，需要手动输入 key。完整 token/key 只返回一次，后台只保存 hash，需要再次复制时要重新生成分享链接。",
		"",
		"## 管理已生成邮箱",
		"",
		"列出 API Key 拥有者创建的邮箱：",
		"",
		"```bash",
		"curl \"" + baseURL + "/api/mailboxes?page=1&per_page=20\" \\",
		"  -H \"X-API-Key: YOUR_KEY\"",
		"```",
		"",
		"传入 `page`、`per_page` 或 `q` 时，`GET /api/mailboxes` 返回带 `items`、`page`、`per_page`、`total`、`total_pages` 的分页元数据。",
		"",
		"删除一个邮箱记录及其已存储邮件：",
		"",
		"```bash",
		"curl -X DELETE \"" + baseURL + "/api/mailboxes/45\" \\",
		"  -H \"X-API-Key: YOUR_KEY\"",
		"```",
		"",
		"成功响应中的 data 包含 `deleted=true` 和 `messages_deleted`。",
		"",
		"## 读取邮件",
		"",
		"邮箱生成后，目标网站会向该地址发送邮件。验证码自动化建议使用简单轮询：每 3 秒调用一次 `GET /api/emails/next?email=MAILBOX`，最多等待 120 秒。没有邮件时返回 `has_email=false`；存在新未读邮件时返回邮件内容，并自动将该邮件标记为已读。拿到 `has_email=true` 后应停止轮询。",
		"",
		"```bash",
		"curl \"" + baseURL + "/api/emails/next?email=verify@example.com\" \\",
		"  -H \"X-API-Key: YOUR_KEY\"",
		"```",
		"",
		"列出邮件且不改变已读状态：",
		"",
		"```bash",
		"curl \"" + baseURL + "/api/emails?email=verify@example.com&page=1&per_page=20\" \\",
		"  -H \"X-API-Key: YOUR_KEY\"",
		"```",
		"",
		"读取一封邮件：",
		"",
		"```bash",
		"curl \"" + baseURL + "/api/email/msg-uuid\" \\",
		"  -H \"X-API-Key: YOUR_KEY\"",
		"```",
		"",
		"将一封邮件标记为已读：",
		"",
		"```bash",
		"curl -X PATCH \"" + baseURL + "/api/email/msg-uuid/read\" \\",
		"  -H \"X-API-Key: YOUR_KEY\"",
		"```",
		"",
		"清空某个邮箱的全部邮件：",
		"",
		"```bash",
		"curl -X DELETE \"" + baseURL + "/api/emails/clear?email=verify@example.com\" \\",
		"  -H \"X-API-Key: YOUR_KEY\"",
		"```",
		"",
		"验证码可从 `subject`、`preview`、`text_content` 或已清洗的 `html_content` 中提取。条件允许时，优先使用来自预期发件人的最新未读邮件。",
		"时间戳为 RFC3339 字符串，可能使用 `Z` 或 `+08:00` 这类明确时区偏移。",
		"",
		"## 读取分享邮箱",
		"",
		"邮箱分享 URL 是公开端点，由不可猜测 token 加不可猜测访问 key 保护。不要向公开分享端点发送 API Key，也不要使用未文档化的 POST 解锁路径。",
		"",
		"```bash",
		"curl \"" + baseURL + "/api/shared/SHARE_TOKEN?key=SHARE_KEY\"",
		"curl \"" + baseURL + "/api/shared/SHARE_TOKEN/messages?key=SHARE_KEY&page=1&per_page=20\"",
		"curl \"" + baseURL + "/api/shared/SHARE_TOKEN/messages/msg-uuid?key=SHARE_KEY\"",
		"```",
		"",
		"不带 `key` 时，`GET /api/shared/SHARE_TOKEN` 会返回邮箱分享的锁定元数据。key 错误返回 `401`；分享过期或已撤销返回 `410`。",
		"",
		"## API Key 自动化端点",
		"",
		endpointTable(AutomationOperations()),
		"",
		"## 公开元数据端点",
		"",
		endpointTable(PublicMetaOperations()),
		"",
		"## 公开分享端点",
		"",
		endpointTable(PublicShareOperations()),
		"",
		"## Web 会话 API 端点",
		"",
		"这些端点需要 Web Console 的 `gptmail_session` cookie/会话，不能通过 API Key 自动化调用。",
		"",
		endpointTable(WebSessionOperations()),
		"",
		"## 响应信封",
		"",
		"成功：",
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
		"失败：",
		"",
		"```json",
		"{",
		"  \"success\": false,",
		"  \"data\": null,",
		"  \"error\": \"message not found\"",
		"}",
		"```",
		"",
		"`error` 是给人看的文本，可能会本地化。不要用精确错误文本做分支；控制流程请使用 HTTP 状态码和 `success` 标志，再把 `error` 展示给用户。",
		"",
		"`usage` 只会出现在 API Key 请求中，包括认证成功后失败的 API Key 请求。用量数字以字符串返回，方便 JavaScript 客户端安全处理大整数。无限配额会在 remaining 字段中返回 `\"unlimited\"`，并配有对应的 `*_unlimited` 标志。",
		"",
	}
	return strings.Join(lines, "\n")
}

func endpointTable(ops []Operation) string {
	lines := []string{
		"| 方法 | 路径 | 认证 | 用途 |",
		"| --- | --- | --- | --- |",
	}
	for _, op := range ops {
		lines = append(lines, "| `"+op.Method+"` | `"+op.DisplayPath()+"` | "+markdownAuthLabel(op.Auth)+" | "+op.Description+" |")
	}
	return strings.Join(lines, "\n")
}

func markdownAuthLabel(auth AuthKind) string {
	switch auth {
	case AuthAPIKey:
		return "API Key"
	case AuthSession:
		return "cookie/会话"
	default:
		return "公开"
	}
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
