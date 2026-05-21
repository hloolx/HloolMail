# HLOOL Mail 系统审计报告（增强版）

日期：2026-05-21
方式：只读审计，不改业务代码。
目标读者：非专业开发者也能看懂，并能据此安排修复顺序。

## 先说结论

这个系统整体结构是清楚的，后端、前端、Webhook、CLI、文档和部署脚本都有比较完整的雏形，已有测试也覆盖了不少接口权限和基础流程。

但现在最需要优先处理的不是“页面好不好看”，而是这几类风险：

1. **账号和密钥风险**：API Key 明文保存、浏览器也会保存完整 API Key，管理员 Token 能绕过登录。
2. **邮件归属风险**：有些邮件没有在入库时固定属于谁，而是读取时再判断；邮箱或域名被复用后，可能把旧邮件给后来的人看。
3. **敏感数据残留风险**：邮件删除或过期后，Webhook 投递表里还可能留着邮件正文。
4. **外部请求边界风险**：Webhook/DNS 检查会访问外部地址，需要更强的防 SSRF 和私网地址保护。
5. **部署稳定性风险**：SMTP 启动失败可能只写日志，网页仍显示正常；Docker Compose 的部分配置项没有真正传进容器。

一句普通话概括：**项目能跑，但还不适合放心暴露给陌生用户或高敏感邮箱场景，建议先修严重和高优先级问题。**

## 本次怎么审的

我把系统拆成多块，让多个子代理并行审查，再由我统一去重、降噪、合并：

- 后端 HTTP、认证、权限、用户、API Key、审计日志。
- SMTP 收信、邮件解析、附件、收件箱归属。
- Webhook、SSRF、后台 worker、SSE、定时任务。
- 数据库、配置、Docker、部署和运维。
- 前端 React/Vite、API 调试器、SSE、错误展示。
- OpenAPI、CLI、Skill、README 和接口契约。
- 安全专项和测试/并发专项。

子代理和本地复核只做审查，没有改业务代码。

已执行或子代理已执行的验证：

- `rtk go test ./internal/http ./internal/auth` 通过，70 个测试通过。
- `rtk go test ./internal/apispec ./internal/http ./internal/cli` 通过，71 个测试通过。
- 前端 `tsc --noEmit` 类型检查通过。
- 之前综合验证记录显示 `rtk go test ./...` 和前端构建通过；本报告后面仍建议在修复代码后重新跑全量测试。

## 优先级说明

- **严重**：可能泄露邮箱内容、密钥、管理员权限，或让服务器访问不该访问的内网地址。
- **高**：可能导致权限绕过、配置误导、重复投递、服务看起来正常但实际不可用。
- **中**：可能造成不稳定、排障困难、接口文档误导、用户体验混乱。
- **低**：短期风险较小，但建议整理，避免以后反复踩坑。

## 建议先修顺序

1. **先修邮件和密钥**：邮件归属固定、删除用户/域名时清理旧邮件、API Key 不再明文保存、Webhook payload 不再长期保存正文。
2. **再修账号安全**：注册邮箱验证、OAuth 不自动合并未验证账号、管理员 Token 降权或禁用、安装接口加保护。
3. **再修外部请求边界**：Webhook DNS rebinding、DNS 检查私网地址、可信代理配置。
4. **再修稳定性**：SMTP 启动失败要让服务知道、SSE 上限和重连、Webhook worker 队列、后台任务并发。
5. **最后修文档和体验**：OpenAPI 契约、CLI 示例、前端错误提示、Docker/SQLite 说明。

---

# 严重问题

## 1. 未验证邮箱注册 + OAuth 自动合并，可能出现账号预注册劫持

问题是什么：

普通注册只要填写邮箱和密码就能创建账号，没有邮箱验证。OAuth 登录时，如果第三方返回的邮箱和已有账号邮箱相同，系统可能把 OAuth 身份合并到这个已有账号。

普通用户会遇到什么：

别人可以先用你的邮箱注册一个密码账号。之后你用 GitHub 或 Linux.do 登录时，可能进入同一个账号，但别人仍然可以用他设置的密码登录。对用户来说，这很像“我的账号被提前占了”。

涉及文件：

- `internal/http/auth_handlers.go:249`
- `internal/http/auth_handlers.go:756`

建议怎么修：

注册必须做邮箱验证。OAuth 不要自动绑定到“未验证的本地邮箱账号”。如果发现同邮箱账号，应要求先登录原账号后手动绑定，或走安全的账号恢复流程。

## 2. 邮件归属没有在入库时固定，旧邮件可能被后来的人看到

问题是什么：

当前系统很多地方是按“邮箱地址字符串”判断邮件属于谁，而不是在邮件入库时就固定 `owner_id` 或 `mailbox_id`。这会带来两个风险：

- 公开域名会收下“还没创建的邮箱地址”的邮件，之后谁创建同名邮箱，谁可能看到之前的旧邮件。
- 删除用户或删除域名时，没有同步清理历史邮件；以后有人重新创建同名邮箱或重新接入同域名，也可能看到旧数据。

普通用户会遇到什么：

例子：某个验证码邮件先发到了 `demo@example.com`，但当时这个邮箱还没人创建。后来用户 B 创建了 `demo@example.com`，就可能看到以前那封验证码。
再比如用户 A 删除后，旧邮件还在库里；用户 B 后来创建同名邮箱，也可能看到 A 的旧邮件。

涉及文件：

- `internal/smtp/backend.go:52`
- `internal/domain/resolver.go:63`
- `internal/messagekit/owner.go:48`
- `internal/http/user_handlers.go:245`
- `internal/http/handlers.go:1165`

建议怎么修：

邮件入库时就固定归属：保存 `owner_id`、`mailbox_id` 或明确的归属快照。公开域名建议只接收已存在 mailbox 的地址；如果要 catch-all，应只用于明确归属的私有域名。删除用户、域名、邮箱时，要同步删除或脱敏相关邮件、附件、分享链接、访问日志和 Webhook 投递记录。

## 3. API Key 明文保存在数据库，还能再次 reveal

问题是什么：

系统已经给 API Key 做了 hash，但同时又把完整明文保存在 `key_value` 字段。接口 `/api/api-keys/:id/reveal` 还能把完整 key 再次返回。

普通用户会遇到什么：

如果数据库备份、数据库账号、管理后台账号或 SQL 注入泄露，攻击者可以直接拿 API Key 去读邮件、创建邮箱、删数据。hash 的保护意义会大幅降低。

涉及文件：

- `internal/models/models.go:164`
- `internal/auth/apikey.go:69`
- `internal/auth/apikey.go:103`
- `internal/http/handlers.go:1333`

建议怎么修：

只保存 `key_prefix` 和不可逆 `key_hash`。创建时显示一次完整 key；之后忘记了就只能重新生成或轮换，不能 reveal 旧 key。已有明文 key 需要做迁移，并提醒管理员轮换。

## 4. API Key 还会被前端保存到浏览器，甚至可能发给外站

问题是什么：

API Docs 页面里的 API Explorer 会把完整 API Key 存进 `localStorage` 历史记录。它还允许用户编辑 API Base，只要接口需要 API Key，就会把 `X-API-Key` 发到用户填写的 URL。

普通用户会遇到什么：

同一台电脑上的其他人、恶意浏览器扩展、浏览器同步数据，都可能拿到 API Key。
如果用户被误导把 API Base 改成外站，密钥会直接发送给外站。

涉及文件：

- `web/src/pages/APIDocsPage.tsx:258`
- `web/src/pages/APIDocsPage.tsx:309`
- `web/src/pages/APIDocsPage.tsx:350`
- `web/src/hooks/useRequestHistory.ts:43`

建议怎么修：

历史记录不要保存完整 API Key，最多保存 key 前缀或“已填过密钥”。默认只允许向同源或可信 `PUBLIC_BASE_URL` 发送 API Key；跨域发送前弹强确认。

## 5. Webhook 防 SSRF 仍有 DNS rebinding 空档

问题是什么：

投递前代码会先解析 webhook 域名并检查 IP 是否公网，但真正发请求时，底层 HTTP 客户端会重新解析 DNS。攻击者可以第一次解析返回公网 IP，真正连接时返回内网 IP。

普通用户会遇到什么：

恶意 webhook 地址可能诱导服务器去请求内网服务、云 metadata 地址或管理面板。这类问题叫 SSRF，风险很高。

涉及文件：

- `internal/webhook/ssrf.go:29`
- `internal/webhook/worker.go:157`
- `internal/webhook/worker.go:185`
- `internal/webhook/worker.go:304`

建议怎么修：

自定义 `Transport.DialContext`，在真正拨号时解析并校验 IP。重定向后的地址也必须走同一套校验。补 DNS rebinding 和重定向到私网地址的测试。

## 6. 邮件删除或过期后，Webhook 投递表里仍可能保存正文

问题是什么：

邮件清理任务会删除过期邮件、附件和分享链接，但没有清理 `webhook_deliveries.payload_json`。这个 payload 里可能包含收件人、主题、正文、HTML 和 headers。

普通用户会遇到什么：

用户以为邮件 24 小时后已经删除，但正文可能仍然在 webhook 投递表里。更糟的是，如果某条投递还在重试，旧正文可能继续被发出去。

涉及文件：

- `internal/jobs/cleanup.go:38`
- `internal/webhook/service.go:99`
- `internal/models/models.go:300`
- `internal/webhook/worker.go:171`

建议怎么修：

删除、过期、清空邮箱、删除用户、删除域名时，都同步处理相关 webhook delivery。至少清空正文和 headers；对未完成投递可以直接取消或删除。投递前最好再确认原邮件仍存在且未过期。

---

# 高优先级问题

## 7. 静态 `X-Admin-Token` 可以绕过登录成为管理员

问题是什么：

只要请求头带正确的 `X-Admin-Token`，就能通过管理员校验，不需要登录。审计里很多时候还会记成 `system`，不容易追踪具体是谁。

普通用户会遇到什么：

这个 token 一旦泄露，就相当于拿到全站管理员。改用户密码、退出登录、禁用账号，都不能撤销这个 token。

涉及文件：

- `internal/http/middleware.go:237`
- `internal/http/user_handlers.go:276`
- `internal/config/config.go:26`

建议怎么修：

生产环境默认禁用。若保留，只作为紧急维护用途，限制来源 IP，用常量时间比较，hash 保存，可轮换，并在审计里明确记录为 `admin-token` 身份。

## 8. 未安装状态下 `/api/install` 是公开入口

问题是什么：

系统第一次安装前，`/api/install` 是公开接口。谁先调用，谁就可以创建第一个管理员。
前端安装页还有一个开发快捷方式：三击 logo 会自动提交固定开发管理员账号并开启 dev mode。如果这类入口在生产环境误用，会放大首次安装被抢占的风险。

普通用户会遇到什么：

新服务器刚部署好但还没来得及打开安装页，如果已经暴露到公网，外人可能抢先完成安装并接管系统。

涉及文件：

- `internal/http/router.go:71`
- `internal/http/auth_handlers.go:71`
- `web/src/pages/InstallPage.tsx:186`
- `web/src/pages/InstallPage.tsx:197`

建议怎么修：

安装接口加一次性 setup token，或限制 localhost/内网访问，或要求显式启用安装模式。安装完成后彻底关闭安装入口。开发快捷方式只在 dev 构建启用，服务端也要拒绝生产环境使用固定开发账号或 dev mode。

## 9. 共享邮箱访问 key 放在 URL query 里

问题是什么：

分享邮箱访问密钥通过 `?key=...` 放在 URL 里，后端还会生成带 key 的 `access_url`。

普通用户会遇到什么：

URL 容易进入浏览器历史、反向代理日志、服务器访问日志、截图和 Referer。别人拿到这个 URL，就能看共享邮箱内容。

涉及文件：

- `internal/http/share_handlers.go:546`
- `internal/http/share_handlers.go:589`
- `web/src/pages/SharedMessagePage.tsx:319`

建议怎么修：

不要把 key 放 query。可以改成前端输入 key 后 POST 校验，服务端发短期 HttpOnly cookie 或临时访问票据。至少不要在服务端生成带 key 的长期 URL。

## 10. SMTP 启动失败只写日志，网页仍可能显示正常

问题是什么：

SMTP 服务在 goroutine 里启动。如果端口被占用或没有权限，错误只会写日志，不会让主进程失败；HTTP 页面和 `/api/health` 仍可能显示正常。

普通用户会遇到什么：

你打开后台看起来一切正常，但实际收不到邮件。排查时会很困惑。

涉及文件：

- `internal/smtp/server.go:30`
- `internal/serverapp/server.go:62`

建议怎么修：

SMTP 启动失败应返回到主进程，至少让健康检查显示异常。`/api/health` 应覆盖 HTTP、数据库、SMTP 监听状态。Docker Compose 也应加 app healthcheck。

## 11. Docker Compose 里的部分配置没有传进容器

问题是什么：

`.env.compose.example` 里有 `DISABLE_PENDING_DOMAIN_DATA_PROTECTION`，README 也说可以用 `WEBHOOKS_ENABLED=false` 关闭 webhook，但 `docker-compose.yml` 没把这些变量传给 app 容器。

普通用户会遇到什么：

管理员以为自己在 `.env` 里关闭了 webhook，实际容器里仍然启用，邮件事件可能继续投递出去。

涉及文件：

- `docker-compose.yml:14`
- `.env.compose.example:39`
- `internal/config/config.go:82`
- `README.md:251`

建议怎么修：

在 `docker-compose.yml` 的 `app.environment` 补齐 `WEBHOOKS_ENABLED`、`DISABLE_PENDING_DOMAIN_DATA_PROTECTION` 等配置，并在 `.env.compose.example` 明确列出。

## 12. Gin 没显式配置可信代理，IP 限流和审计可能不准

问题是什么：

限流和审计依赖 `c.ClientIP()`，但 router 没有显式设置 `SetTrustedProxies`。

普通用户会遇到什么：

如果系统部署在反向代理后，攻击者可能伪造 `X-Forwarded-For`，绕过按 IP 的限流，审计日志里的 IP 也可能不可信。

涉及文件：

- `internal/http/router.go:64`
- `internal/http/middleware.go:201`
- `internal/http/middleware.go:305`

建议怎么修：

增加 `TRUSTED_PROXIES` 配置。没有反代时关闭代理信任；有反代时只信任真实代理 IP 或 CIDR。

## 12A. 无效 API Key 请求在限流前就会查库

问题是什么：

全局 `optionalAPIKey` 在路由限流前执行。无效 API Key 会直接认证失败并返回 `401`，不会进入后面的 API 限流逻辑。

普通用户会遇到什么：

攻击者可以高频发送无效 key，持续打数据库。如果猜到某些 key 前缀，还可能触发慢 hash 校验，造成 CPU 压力。

涉及文件：

- `internal/http/router.go:65`
- `internal/http/middleware.go:66`
- `internal/http/middleware.go:72`

建议怎么修：

在 API Key 认证前加全局 IP/失败 key 限流。认证失败也计入限流桶。错误信息尽量统一，不要让攻击者轻易区分 invalid、disabled、expired。

## 13. 一封 SMTP 邮件多个收件人时，部分失败会造成重复邮件

问题是什么：

同一封邮件有多个收件人时，代码逐个收件人单独入库。前几个成功、后一个失败时，SMTP 返回临时失败。

普通用户会遇到什么：

发件服务器通常会重试整封邮件。已经成功入库的收件人会收到重复邮件，Webhook 也可能重复触发。

涉及文件：

- `internal/smtp/backend.go:88`
- `internal/smtp/backend.go:108`
- `internal/smtp/backend.go:116`

建议怎么修：

把同一封 SMTP DATA 的所有收件人写入放进一个总事务。或者按 `Message-ID + recipient` 做幂等去重。事务成功后再统一发 SSE 和 webhook。

## 14. 开放注册默认可用，且注册后无需邮箱验证即可使用额度

问题是什么：

注册入口默认开放，注册成功后账号立即启用并有额度。

普通用户会遇到什么：

机器人可以批量注册账号消耗公开域名邮箱额度，也可能抢注别人的邮箱地址。

涉及文件：

- `internal/http/auth_handlers.go:249`
- `web/src/pages/LandingPage.tsx`

建议怎么修：

增加“是否允许开放注册”的配置。注册后先验证邮箱，再启用关键功能。登录/注册失败过多时启用更强限流或 Turnstile。

## 15. 前端会把 API Key 拼进邮件 HTML 里的 `/api/...` 链接

问题是什么：

邮件 HTML 本身不可信。前端会把 API Key 加到邮件 HTML 中的 `/api/...` 链接上。

普通用户会遇到什么：

如果启用了 query 参数鉴权，用户点击链接时 API Key 可能进入 URL、日志或浏览器历史。即使 iframe 有 sandbox，也不应把密钥写进不可信 HTML。

涉及文件：

- `web/src/pages/MessageDrawer.tsx:10`
- `web/src/pages/MessageDrawer.tsx:58`
- `internal/http/middleware.go:56`

建议怎么修：

不要改写邮件 HTML 注入 API Key。邮件 iframe 里的链接保持普通链接或点击前确认；真正的 API 调用继续由应用层用请求头完成。

## 15A. `GET /api/emails/next` 会修改已读状态

问题是什么：

`GET /api/emails/next` 是 GET 接口，但它会把返回的邮件标记为已读。按常见约定，GET 应该只读取数据，不应该改变数据。

普通用户会遇到什么：

跨站跳转、浏览器预取、误点链接或某些自动化工具访问这个 URL 时，验证码邮件可能被标记为已读，用户以为没收到或漏看。

涉及文件：

- `internal/http/router.go:104`
- `internal/http/handlers.go:613`
- `internal/http/handlers.go:634`

建议怎么修：

把“读取下一封并标记已读”改成 `POST` 或 `PATCH`。GET 只提供只读查询。若 session 也能访问这类会改状态的接口，应增加 Origin/CSRF 校验。

---

# 中优先级问题

## 16. Inbox SSE 超过订阅上限后可能空转

问题是什么：

`Hub.Subscribe` 达到上限时返回一个已关闭 channel；`inboxStream` 读取时没有检查 `ok`。关闭 channel 会一直立即返回零值事件。

普通用户会遇到什么：

超过限制的连接不会被明确拒绝，反而可能持续刷空 SSE 消息，消耗 CPU 和带宽。

涉及文件：

- `internal/events/sse.go:47`
- `internal/events/sse.go:57`
- `internal/http/handlers.go:780`

建议怎么修：

让 `Subscribe` 返回明确错误或布尔值；handler 超限时返回 `429` 或 `503`。读取 channel 时使用 `event, ok := <-ch`，`!ok` 直接退出。

## 17. 通知/公告 SSE 没有连接上限，前端断线后也可能不重连

问题是什么：

邮箱 SSE 有连接上限，但通知/公告 SSE 没有同类限制。前端 `sseStream` 遇到服务端正常关闭连接时直接结束，外层可能不会重连。
另外 HTTP server 设置了 `WriteTimeout: 60 * time.Second`，而 SSE 是长连接；如果这个超时作用到 SSE 写入，实时连接可能运行一段时间后被服务端断开。

普通用户会遇到什么：

大量长连接可能占用内存和 goroutine。另一方面，连接断开后用户可能不再实时收到新邮件、通知或公告，只能刷新页面。

涉及文件：

- `internal/serverapp/server.go:82`
- `internal/events/sse.go:94`
- `internal/http/notification_handlers.go:97`
- `internal/http/announcement_handlers.go:223`
- `web/src/lib/sse.ts:36`
- `web/src/pages/inbox/useActiveMailboxStream.ts:72`
- `web/src/components/layout/NotificationBell.tsx:81`

建议怎么修：

通知/公告订阅也加每用户、每 key、全局上限。SSE 路由要单独处理长连接写超时，或使用适合 SSE 的 server 设置。前端把“正常结束”也当成需要重连的事件，冷却只控制提示，不阻止重连。

## 18. Webhook worker 容易被慢端点拖慢

问题是什么：

worker 每批最多 10 条，但串行投递；每条默认可卡 10 秒。没有每用户 webhook 数量上限、测试投递冷却、失败自动熔断。

普通用户会遇到什么：

一个用户配置大量慢 webhook，可能让其他用户的 webhook 也延迟很久。

涉及文件：

- `internal/webhook/worker.go:50`
- `internal/webhook/worker.go:88`
- `internal/webhook/service.go:53`
- `internal/http/webhook_handlers.go:263`

建议怎么修：

加每用户端点数量和测试投递频率限制。worker 改成有界并发，按 endpoint 或 user 做速率限制；失败次数过高自动暂停端点并通知用户。

## 19. 域名健康检查启动不是原子操作，后台任务也没有 leader lock

问题是什么：

域名健康检查先查有没有 running，再创建新的 run，中间没有数据库锁或唯一约束。后台任务在每个 app 实例都会启动。

普通用户会遇到什么：

管理员连续点击，或定时任务与手动触发撞车时，可能启动多个 DNS 检查任务。横向扩容时，清理和健康检查也可能重复执行。

涉及文件：

- `internal/jobs/domain_health.go:144`
- `internal/jobs/domain_health.go:163`
- `internal/serverapp/server.go:58`

建议怎么修：

用事务锁、唯一约束或 PostgreSQL advisory lock 保证同一时间只有一个 running run。多实例部署时增加 leader lock 或独立 worker 角色。

## 20. DNS 健康检查的 resolver/权威 NS 没有限制公网地址

问题是什么：

管理员配置的 resolver 只做长度检查。代码还会把权威 NS 加入探测目标，但没有确认这些地址是不是公网 DNS。

普通用户会遇到什么：

误配置或恶意域名的 NS 可能让服务器向内网地址发 DNS 探测流量。风险比 webhook SSRF 低，但仍是外部请求边界问题。

涉及文件：

- `internal/http/admin_handlers.go:404`
- `internal/domain/dnsclient.go:43`
- `internal/domain/dnsclient.go:263`

建议怎么修：

resolver 只允许明确的公网 `IP:53`。权威 NS 解析后也要校验公网地址。必要时给权威探测加开关。

## 21. PostgreSQL 连接池没有上限配置

问题是什么：

PostgreSQL 打开后没有设置 `MaxOpenConns`、`MaxIdleConns`、连接生命周期等。

普通用户会遇到什么：

并发或后台任务变多时，可能打满 PostgreSQL `max_connections`，导致请求变慢或失败。

涉及文件：

- `internal/db/db.go:27`

建议怎么修：

增加 `DB_MAX_OPEN_CONNS`、`DB_MAX_IDLE_CONNS`、`DB_CONN_MAX_LIFETIME` 配置，并设置保守默认值。

## 22. SQLite 默认路径和权限容易误导

问题是什么：

代码/README/前端用 `storage/hlool-mail.db`，但 `.env.example` 和 Dockerfile 用 `gptmail.db`。SQLite 目录用 `0755` 创建，数据库文件权限依赖系统 umask。Docker 单容器默认写在容器内 `/app/storage/gptmail.db`，不强制挂载 volume。

普通用户会遇到什么：

换部署方式或漏配 env 时，程序可能新建空库，看起来像“数据丢了”。在多用户服务器上，数据库也可能被同机其他用户读取。直接 `docker run` 后重建容器可能丢数据。

涉及文件：

- `internal/config/config.go:67`
- `.env.example:9`
- `Dockerfile:33`
- `Dockerfile:37`
- `internal/db/db.go:38`

建议怎么修：

统一默认数据库文件名。SQLite 目录用 `0700`，数据库文件确保 `0600`。Dockerfile 声明 `VOLUME /app/storage`，文档明确单容器必须挂载 volume，生产优先 PostgreSQL。

## 23. 启动时自动 AutoMigrate，Compose 默认拉 latest

问题是什么：

服务启动时自动 `AutoMigrate`，同时 Compose 默认镜像是 `latest`。

普通用户会遇到什么：

升级不可复现，数据库结构可能自动变化，回滚困难。

涉及文件：

- `internal/serverapp/server.go:39`
- `internal/db/db.go:98`
- `docker-compose.yml:5`

建议怎么修：

生产部署固定版本 tag。引入版本化迁移。升级文档加入“备份、迁移、验证、回滚”步骤。

## 24. OpenAPI/README/Skill 容易误导 SDK 或 AI 接入

问题是什么：

README 会让用户以为 `/api/openapi.json` 是当前接口完整来源，但真实 router 有大量接口不在 OpenAPI registry 中。部分文档还说域名/通知是 Web Console 任务，但后端又允许 API Key 访问部分只读接口。

普通用户会遇到什么：

用户或 AI 按 OpenAPI 生成 SDK 时，会漏掉真实接口；或者以为某些接口不能用 API Key，实际却能访问。

涉及文件：

- `README.md:212`
- `README.md:363`
- `internal/http/router.go`
- `internal/apispec/spec.go`
- `web/src/lib/apiDocs.ts`
- `docs/api-boundary.md`
- `skills/hlool-mail-api/SKILL.md`

建议怎么修：

先明确 OpenAPI 是“完整接口”还是“自动化 API 子集”。如果是子集，README 要说清楚；如果要做 SDK 来源，就补齐 operation/schema。把过期文档标为历史快照或移到 archive。

## 25. 列表接口和邮件详情 schema 与实际响应不一致

问题是什么：

部分列表接口未传分页参数时会返回 legacy array，但 OpenAPI 只写分页对象。API Key 邮件详情实际不返回 `html_content`，但 schema 承诺了这个字段。

普通用户会遇到什么：

自动生成的客户端可能按错误结构解析响应，出现运行时报错。

涉及文件：

- `internal/http/handlers.go:560`
- `internal/http/handlers.go:676`
- `internal/http/handlers.go:1868`
- `internal/http/share_handlers.go:393`
- `internal/apispec/spec.go`
- `internal/apispec/schemas.go`

建议怎么修：

OpenAPI 使用 `oneOf` 描述兼容响应，或逐步废弃数组响应。拆分 `MessageAutomationDetail` 和 `MessageWebDetail` schema。

## 25A. `/api/mailboxes` 未分页时会全量拉取且有 N+1 查询

问题是什么：

`/api/mailboxes` 如果不传分页参数，会全量拉取邮箱。随后还会对每个邮箱额外查询邮件数量和最后邮件时间。

普通用户会遇到什么：

邮箱数量一多，列表接口会明显变慢，数据库查询数会随着邮箱数线性增长。页面可能卡，API 也可能超时。

涉及文件：

- `internal/http/handlers.go:1868`
- `internal/http/handlers.go:1894`

建议怎么修：

默认强制分页。邮件数量和最后邮件时间用一次聚合查询解决，比如 `GROUP BY recipient`，不要每个邮箱再查两次。补大数据量基准测试。

## 26. CLI 本地生成文档会使用错误 MX 示例值

问题是什么：

`hloolmail openapi markdown|skill|json|yaml` 离线生成时固定使用 `mail.example.com`，不会读取运行中服务的真实 `EXPECTED_MX`。

普通用户会遇到什么：

用户把 CLI 生成的文档发给 AI 或脚本，里面的 DNS/MX 指引可能是错的。

涉及文件：

- `internal/cli/cli.go:220`

建议怎么修：

CLI 优先拉取运行中服务的 `/api/docs.md` 或 `/api/openapi.json`。离线模式支持 `--expected-mx`，或从配置/env 读取。

## 27. 前端收件箱错误会显示成“空”

问题是什么：

邮箱列表、邮件列表、详情查询的 `isError/error` 没有传给 UI。失败时会显示空列表或“请选择邮件”。

普通用户会遇到什么：

网络断开、登录过期、后端报错时，用户会误以为没有邮箱或没有邮件。

涉及文件：

- `web/src/pages/inbox/useInboxQueries.ts:33`
- `web/src/pages/inbox/MailboxList.tsx:41`
- `web/src/pages/inbox/MessageList.tsx:60`
- `web/src/pages/MessageDrawer.tsx:26`

建议怎么修：

把各 query 的 `isError/error` 传给组件。列表失败时显示“加载失败 + 重试”。详情页 loading/error/empty 都保留移动端返回按钮。

## 28. 前端非 JSON 错误提示不友好

问题是什么：

后端返回 HTML、代理错误页或空响应时，前端 `JSON.parse` 失败会直接抛 `SyntaxError`。

普通用户会遇到什么：

用户看到 `Unexpected token <` 这类看不懂的信息，不知道是后端挂了、登录过期，还是代理返回了错误页。

涉及文件：

- `web/src/api.ts:457`
- `web/src/api.ts:459`

建议怎么修：

解析失败时统一包装成 `ApiError`，带 HTTP 状态、请求路径和短摘要。

## 29. 公告 Markdown 渲染存在属性注入风险

问题是什么：

Markdown 会转义 `< > &`，但链接和图片 URL 里的双引号没有严格转义，然后用 `dangerouslySetInnerHTML` 插入页面。

普通用户会遇到什么：

当前公告通常由管理员发布，所以风险比公开评论低。但如果管理员账号被盗，或未来开放给普通用户发布公告，就可能变成 XSS 风险。

涉及文件：

- `web/src/lib/markdown.ts:54`
- `web/src/lib/markdown.ts:58`
- `web/src/components/layout/NotificationBell.tsx:280`
- `web/src/pages/AnnouncementsPage.tsx:157`

建议怎么修：

使用成熟 Markdown 渲染器和 sanitizer，或至少严格转义属性值，并限制链接协议为 `http/https/mailto`。

## 30. 邮件解析和字段长度有边界问题

问题是什么：

邮件主题、发件人名、附件名等没有入库前长度保护，但数据库字段有限长。`multipart/*` 邮件缺少 boundary 时，解析器可能直接成功但不读取正文。

普通用户会遇到什么：

超长主题或文件名可能导致 PostgreSQL 入库失败，发件方反复重试。一些不规范邮件可能被保存成空内容。

涉及文件：

- `internal/models/models.go:202`
- `internal/models/models.go:219`
- `internal/smtp/backend.go:117`
- `internal/mail/parser.go:91`

建议怎么修：

入库前截断或改用 `text`。不可恢复的格式/长度问题返回永久失败码，避免重试风暴。缺 boundary 时按纯文本兜底，或明确拒收。

## 31. 审计日志和 API 使用日志可能丢

问题是什么：

审计日志异步批量写入；批量写失败会整批丢失。队列满时普通活动日志会被丢弃。API 使用日志写入错误也被忽略。

普通用户会遇到什么：

高峰或数据库短暂异常时，管理员可能查不到部分关键操作。用户额度已经扣了，但历史记录里没有对应调用。

涉及文件：

- `internal/http/audit.go:56`
- `internal/http/audit.go:95`
- `internal/http/middleware.go:100`
- `internal/http/middleware.go:299`

建议怎么修：

失败批次重试或降级逐条写。增加丢弃计数和告警。关键安全操作考虑同步确认写入。

## 31A. API 使用日志 goroutine 里继续使用 Gin Context

问题是什么：

`consumeUserQuota` 里启动 goroutine 后，还继续读取 Gin `Context`。Gin Context 会被框架复用，高并发下可能出现数据竞争或日志串请求。

普通用户会遇到什么：

API 使用日志里的路径、IP、User-Agent 可能错写到别的请求上。开启 race 检测时也可能报数据竞争。

涉及文件：

- `internal/http/middleware.go:299`

建议怎么修：

启动 goroutine 前先把 `path`、`method`、`ip`、`userAgent`、`userID` 拷贝成普通变量，再传给 goroutine。也可以改成可靠队列或同步写入。CI 里建议补 `go test -race`。

## 32. 登录、注册、登出、登录失败缺少审计

问题是什么：

密码登录、注册、登出、登录失败没有进入审计日志。

普通用户会遇到什么：

管理员看不到谁在爆破密码、谁成功登录、谁新注册了账号。出事后追查困难。

涉及文件：

- `internal/http/auth_handlers.go:213`
- `internal/http/auth_handlers.go:249`
- `internal/http/audit.go`

建议怎么修：

为成功/失败登录、注册、登出、管理员 Token 使用增加审计事件，记录时间、邮箱、IP、User-Agent，但不要记录密码或完整 token。

---

# 低优先级或产品确认项

## 33. 附件只保存元数据，没有下载能力

问题是什么：

当前只保存附件文件名、大小、hash 等元数据，不保存附件正文，也没有下载路由。

普通用户会遇到什么：

用户看到“附件”列表后，可能以为可以下载，但实际不能。内嵌图片 `cid:` 也无法真正显示。

涉及文件：

- `internal/mail/parser.go:121`
- `internal/mail/parser.go:162`
- `internal/smtp/backend.go:143`
- `internal/models/models.go:214`
- `internal/http/message_attachments.go:47`

建议怎么修：

如果这是产品设计，UI 和 API 文档要明确“仅显示附件信息”。如果要支持下载，需要新增附件内容存储和权限校验下载接口。

## 34. 邮件预览按字节截断，中文或 emoji 可能被切坏

问题是什么：

收件箱预览用字节截断，而不是按 Unicode 字符截断。

普通用户会遇到什么：

中文或 emoji 可能显示成乱码或替换字符。

涉及文件：

- `internal/http/message_dto.go:140`

建议怎么修：

按 rune/Unicode 字符截断。

## 35. CSP 会拦截 Google Fonts

问题是什么：

HTML 加载 Google Fonts，但后端 CSP 只允许 `style-src 'self'`。

普通用户会遇到什么：

生产环境浏览器可能报 CSP 错误，字体加载失败，界面和设计预期不一致。

涉及文件：

- `web/index.html:8`
- `web/index.html:10`
- `internal/http/middleware.go:161`

建议怎么修：

更推荐自托管字体，继续保持 CSP self-only。或者明确放开 Google Fonts 的 style/font 源。

## 36. 构建使用 `npm install`，可重复性弱于 `npm ci`

问题是什么：

项目已有 `package-lock.json`，但 Docker 和 release workflow 使用 `npm install`。

普通用户会遇到什么：

不同环境解析依赖时更容易出现差异，导致本地、CI、镜像构建结果不一致。

涉及文件：

- `Dockerfile:7`
- `.github/workflows/release-binaries.yml`
- `web/package-lock.json`

建议怎么修：

生产构建改为 `npm ci`，保留后续 native optional 依赖修复脚本。

## 37. 官方 Docker 镜像版本信息可能是 dev/unknown

问题是什么：

Dockerfile 支持 `VERSION/COMMIT/BUILD_TIME`，但发布 workflow 可能没有传这些 build args。

普通用户会遇到什么：

控制台和 `/api/version` 显示的版本不可信，升级判断可能不准。

涉及文件：

- `Dockerfile:22`
- `Dockerfile:25`
- `.github/workflows/docker-publish.yml`
- `internal/http/handlers.go:120`

建议怎么修：

发布镜像时传入 `VERSION`、`COMMIT`、`BUILD_TIME`。

## 38. 离开页面期间的公告计数没有真正接上

问题是什么：

状态里有 `awayAnnouncementCount`，但公告 SSE 只刷新 query，没有增加离开期间公告数。

普通用户会遇到什么：

浏览器标题或“你离开期间有...”提示可能只统计新邮件，不统计新公告。

涉及文件：

- `web/src/components/layout/NotificationBell.tsx:81`
- `web/src/store.ts:175`
- `web/src/components/layout/Topbar.tsx:33`

建议怎么修：

公告 SSE 收到事件时，如果 `document.hidden`，调用专门的公告计数更新；不用的状态字段可以删除，避免误导维护者。

## 39. 前端缺少自动化测试脚本

问题是什么：

前端当前主要依靠 TypeScript 类型检查，没有看到 Vitest/MSW 或 Playwright 这类自动化测试脚本来覆盖核心交互。

普通用户会遇到什么：

SSE 断线重连、API 超时、分页状态、收件箱错误展示这类问题，很容易改着改着又坏掉。

涉及文件：

- `web/package.json:5`
- `web/src/lib/sse.ts`
- `web/src/api.ts`
- `web/src/pages/inbox`

建议怎么修：

先加 Vitest 和 MSW，覆盖 `api()`、`sseStream()`、Inbox 查询 hooks。再补少量 Playwright 冒烟测试，验证登录、收件箱、实时流和移动端基本可用。

---

# 建议补的测试

1. 注册邮箱未验证时，OAuth 同邮箱不能自动合并。
2. 公开域名收到未创建邮箱地址的邮件后，后来创建同名邮箱不能看到旧邮件。
3. 删除用户或域名后，旧邮件、附件、分享链接、Webhook 投递记录不可被新 owner 看到。
4. API Key 数据库不保存明文，旧 reveal 接口不可返回历史密钥。
5. API Explorer 不把完整 API Key 存入 localStorage，也不会无确认发到外站。
6. Webhook 目标 DNS rebinding 或重定向到私网时被拦截。
7. 删除/过期邮件后，相关 webhook delivery 不保存正文，也不会继续投递。
8. 伪造 `X-Forwarded-For` 不影响登录、分享和 API 限流。
9. SMTP 端口被占用时，服务启动或健康检查能明确失败。
10. 一封邮件多个收件人时，部分失败不会造成重复邮件。
11. SSE 超过连接上限时不会空转；断开后前端能重连。
12. 并发触发域名健康检查时只会创建一个 running run。
13. 后端返回非 JSON 错误页时，前端显示友好错误。
14. 超长主题、附件名、不规范 multipart 邮件不会导致无限重试或空内容误收。
15. 无效 API Key 高频请求会被认证前限流挡住，不会持续压数据库或慢 hash。
16. `GET /api/emails/next` 不再改变已读状态，改状态的行为走 `POST` 或 `PATCH`。
17. API 使用日志异步写入前会先拷贝请求信息，`go test -race` 不报 Gin Context 数据竞争。
18. `/api/mailboxes` 默认分页，大量邮箱时不会出现明显 N+1 查询放大。
19. 前端补 `api()`、`sseStream()`、Inbox hooks 的基础自动化测试。

# 给非开发者的最后提醒

这份审计里最重要的不是“现在测试没过”，因为已有测试和类型检查大体是通过的。真正要重视的是：很多风险只在特殊场景出现，例如账号被抢先注册、域名或邮箱被复用、数据库泄露、Webhook 指向恶意地址、SMTP 端口被占用。这些场景平时不一定碰到，但一旦发生，影响就是隐私、密钥和可用性问题。

建议近期先安排修复 **严重问题 1 到 6**，然后处理 **高优先级 7 到 15**。这些修完后，再做中低优先级的稳定性、文档和体验整理。
