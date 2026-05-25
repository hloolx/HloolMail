# HLOOL Mail 安全审计报告与后续方案 - 2026-05-21

> 审计目标：`https://email.hlool.cc/`
> 审计方式：低风险线上 API 检查 + 本地代码/构建产物静态审查 + 子代理复查。
> 敏感信息处理：报告不记录完整 API key、邮箱列表、邮件正文、cookie、分享链接、数据库密钥等敏感数据。

## 1. 一句话结论

这次结果不是“完全通过”，而是“主体防护有效，但有几个必须处理的安全卫生问题”。

用小白能理解的话说：

- 登录爆破：目前线上登录启用了 Turnstile，人机验证会挡在密码验证前面，直接撞密码不容易。
- API key 爆破：错误 key 会被拒绝，但现在低次数测试没有看到限速；结合代码审查，建议补一个更靠前、更便宜的限速。
- 后门/开发残留：生产前端包里还出现了开发安装快捷入口和默认密码相关字符串，这是本次最高优先级问题。
- 敏感信息：公开接口没有直接泄露数据库密码、session secret 这类核心秘密；但本地 `.env`、`.claude/settings.json`、本地数据库里存在真实密钥痕迹，要防止被同步或打包泄露。
- 一次性审计 key：这个 key 权限偏大，审计结束后请立即删除或撤销。

## 1.1 三问三答

| 问题 | 现在的判断 | 小白版解释 |
| --- | --- | --- |
| 是否容易被爆破？ | 登录侧暂时没有看到容易直接爆破的迹象；API key 侧建议补限速 | 线上已观察到没有 Turnstile token 的登录请求会被挡住，但没有做爆破/撞库测试，不能说已经“完整证明抗爆破”。错误 API key 会被拒绝，但建议加更早的限速。 |
| 有没有后门？ | 未证明存在可立即利用的后门，但发现高危开发残留 | 生产前端包里有隐藏开发安装入口/默认账号相关字符串。当前线上已安装，不等于马上能被接管，但这类东西不该出现在生产包里。 |
| 有没有遗留坏信息？ | 有，需要清理 | 公开文档没发现旧分享密码接口残留；但生产前端包有开发残留，本地配置和数据库有真实密钥痕迹，必须防止外传。 |

## 2. 已完成的检查范围

已经做了：

- 公开 API 检查：健康检查、版本、安装状态、登录配置、OAuth 配置、OpenAPI、公开文档。
- API key 只读检查：域名、统计、邮箱统计、邮箱列表边界、邮件查询缺参校验。
- API key 越权边界检查：API key 管理、分享链接管理、Webhook 管理、admin stats、公告、通知。
- 低次数负面检查：错误 API key、假登录、错误分享 token。
- 生产前端构建产物关键词检查：开发安装、默认密码、旧分享密码接口残留。
- 子代理复查：复查严重级别、测试边界、是否应该写成“部分通过”。

没有做：

- 没有删除、清空、轮换、安装、改密码、改用户、改 OAuth 等破坏性请求。
- 没有做爆破、撞库、压力测试、SMTP 滥发测试。
- 没有读取或记录真实邮件正文。
- 没有创建 Webhook 或触发外部请求。

## 3. 最高优先级问题

### 高危：生产前端包里有开发安装/默认账号残留

发现：

- 生产 JS 资源 `/assets/index-BbPg-FPW.js` 里出现默认开发密码相关字符串，报告中已打码。
- 同一个资源里出现隐藏安装跳过开关相关字符串，报告中已打码。
- 本地静态审查显示，这和隐藏安装快捷入口、默认开发管理员流程有关。

为什么危险：

- 这类字符串不应该出现在生产环境。
- 当前线上已经安装，后端大概率会拒绝重复安装，所以不等于现在马上能被接管。
- 但如果以后出现重置、误判未安装、部署到新环境、后端防线回退，就可能变成默认管理员创建入口。

建议：

1. 从生产构建中移除隐藏开发安装入口和默认账号逻辑。
2. 重新构建并部署前端。
3. 部署后再次检查生产 JS，确认不再包含默认开发密码和隐藏安装跳过开关相关字符串。
4. 加一个发布前检查：生产包只要出现这些字符串就失败。

## 4. 中优先级问题

### 问题 A：一次性审计 key 权限偏大

发现：

- 这个 key 可以看到域名统计、系统统计、邮箱统计。
- `GET /api/mailboxes` 会返回完整邮箱列表，原始列表没有写进报告。
- key 看起来像比较高权限的 owner key。

风险：

- 如果这个 key 泄露，别人可能看到邮箱地址和运营统计。
- 如果它不是专门为审计开的临时 key，那权限就偏大。

建议：

1. 审计结束后立即删除或撤销这个一次性 key。
2. 删除后用一个无害请求验证，例如 `GET /api/stats` 应该返回 `401` 或 `403`。
3. 以后审计 key 设置最小权限、短有效期、用完即删。

### 问题 B：通知接口曾接受 API key，现已改为 cookie/session 专用

发现：

- `GET /api/notifications` 使用 API key 返回 200。
- `GET /api/notifications/unread-count` 使用 API key 返回 200。

为什么要确认：

- 从产品理解上，通知通常是“Web 控制台登录后看的状态”。
- 如果本来只想让网页登录用户看，那 API key 能访问就是权限边界漂移。

已确认的产品决策：

1. 通知 REST 接口只允许网页登录 cookie/session。
2. API key-only 请求通知接口应返回 `401 login required`。
3. 这些请求不应消耗 API key quota，也不应写 APIUsageLog。
4. 本地代码已按这个方向修复，并补了回归测试；上线部署后需要再复查生产环境。

### 问题 C：统计时间线和域名管理曾接受 API key，现已改为 cookie/session 专用

发现：

- `GET /api/stats/timeseries?days=7` 使用 API key 返回 200。
- `GET /api/domains` 使用 API key 返回 200。

风险：

- 这属于接口边界漂移：趋势统计和完整域名列表是 Web 控制台信息。
- 普通自动化 key 不应该知道完整域名和趋势统计。

已处理：

1. `GET /api/stats/timeseries` 已改为只允许网页登录 cookie/session。
2. `/api/domains*` 域名管理路径已改为只允许网页登录 cookie/session。
3. API key-only 请求这些路径不会消耗 API key quota，也不会写 APIUsageLog。
4. `GET /api/domains/available` 明确例外，保持 API key 可访问，因为它是自动化生成邮箱需要的可用域名列表。
5. 已补回归测试，部署后需要复查生产环境。

### 问题 D：错误 API key 的限速已前移到认证之前

发现：

- 线上低次数测试中，3 次错误 API key 都返回 401。
- 没有在 3 次内看到 429 限速。
- 静态审查显示，API key 认证发生在部分路由限速之前，可能先查数据库或做较重校验。

风险：

- 这不是说现在已经被爆破成功。
- 但攻击者可以大量尝试错误 key，让服务器反复做无意义认证工作。

已处理：

1. 在 API key 认证之前增加了轻量 IP/全局限速。
2. 超过前置限速会返回 `429 rate limit exceeded`，避免继续打到数据库/API key 校验。
3. 错误 key 认证失败只记录摘要指纹、来源 IP、路径和原因，不记录完整 key。
4. 未触发限速的错误 key 仍保持泛化返回，例如 `api key invalid`。

## 5. 低优先级/清理项

### 公告接口曾可能先消费 API key 再拒绝，现已收口

发现：

- `GET /api/announcements` 带 API key 返回 `401 login required`。
- 静态审查提示它可能先走了 API key 认证，再被 handler 拒绝。

影响：

- 目前没有数据泄露。
- 但 session-only 接口最好不要消耗 API key 配额，也不要留下“看起来认证过”的日志。

已处理：

- 公告接口已加入 Web cookie/session-only 路径。
- API key-only 请求公告接口应返回 `401 login required`。
- 这些请求不会消耗 API key quota，也不会写 APIUsageLog。
- 已补回归测试，部署后需要复查生产环境。

### 本地秘密文件和数据库需要管理

发现：

- 本地 `.env`、`.claude/settings.json`、`storage/gptmail.db` 中存在真实密钥或会话/API key 数据。
- 这些不代表线上公开泄露，但如果被提交、打包、备份外流，会变成真实风险。

建议：

1. 确认这些文件被 `.gitignore` 忽略。
2. 如果任何密钥曾被复制到聊天、工单、仓库、截图或日志，建议轮换。
3. 生产环境不要依赖本地测试密钥。

## 6. API 测试记录

### 6.1 公开接口

| ID | 接口 | 认证 | 状态 | 结果 |
| --- | --- | --- | ---: | --- |
| PUB-001 | `GET /api/health` | 无 | 200 | 正常，只返回健康状态 |
| PUB-002 | `GET /api/version` | 无 | 200 | 返回版本 `0.1.13` |
| PUB-003 | `GET /api/version/check` | 无 | 200 | 当前/最新均为 `0.1.13` |
| PUB-004 | `GET /api/auth/login-settings` | 无 | 200 | 已安装，Turnstile 开启，Passkey 开启，OAuth provider 数量为 1 |
| PUB-005 | `GET /api/install/status` | 无 | 200 | 已安装，只返回公开配置字段 |
| PUB-012 | `GET /api/oauth/providers` | 无 | 200 | 返回 1 个 provider |
| PUB-015 | `GET /api/docs.md` | 无 | 200 | 公开 Markdown 文档可访问 |
| PUB-016 | `GET /api/skill.md` | 无 | 200 | 公开 skill 文档可访问 |
| PUB-017 | `GET /api/openapi.json` | 无 | 200 | OpenAPI JSON 可访问 |
| PUB-018 | `GET /api/openapi.yaml` | 无 | 200 | OpenAPI YAML 可访问 |

结论：

- 这些公开接口没有观察到数据库 URL、session secret、inbox token secret 等核心秘密。
- 登录配置显示 Turnstile 已启用。

### 6.2 API key 只读接口

| ID | 接口 | 状态 | 结果 |
| --- | --- | ---: | --- |
| KEY-001 | `GET /api/domains/available` | 200 | 审计 key 可见 6 个公开域名和 1 个私有域名 |
| KEY-002 | `GET /api/stats` | 200 | 返回域名、邮箱、消息、API key 等统计数量 |
| KEY-003 | `GET /api/stats/timeseries?days=7` | 200 | 审计时返回 7 个数据点；本地代码已改为部署后 API key-only 应返回 401 |
| KEY-004 | `GET /api/mailboxes` | 200 | 审计 key 可拿到完整邮箱列表，原始内容已省略 |
| KEY-005 | `GET /api/mailboxes/stats` | 200 | 返回配额/统计字段 |
| KEY-006 | `GET /api/emails` 缺少 email 参数 | 400 | 正确拒绝，提示 `valid email required` |
| KEY-009 | `GET /api/domains` | 200 | 审计时可见 7 个域名；本地代码已改为部署后 API key-only 应返回 401，域名管理子路径也同样 Web-only |

结论：

- 这个审计 key 权限比较大。
- 如果它只是临时审计 key，可以接受，但用完要删。
- `stats/timeseries` 和域名管理路径已决定改为网页登录 cookie/session 专用；`domains/available` 保持 API key 可访问。

### 6.3 API key 边界接口

| ID | 接口 | 使用认证 | 状态 | 结果 |
| --- | --- | --- | ---: | --- |
| AKM-006 | `GET /api/api-keys` | API key only | 401 | 正确拒绝，要求登录 |
| SHM-010 | `GET /api/share-links` | API key only | 401 | 正确拒绝，要求登录 |
| WH-008 | `GET /api/webhooks` | API key only | 401 | 正确拒绝，要求登录 |
| ADM-001 | `GET /api/admin/stats` | API key only | 403 | 正确拒绝；当前边界要求管理员网页登录态 |
| ANN-004 | `GET /api/announcements` | API key only | 401 | 拒绝，要求登录 |
| NOT-001 | `GET /api/notifications` | API key | 200 | 审计时接受；本地代码已改为部署后应返回 401 |
| NOT-002 | `GET /api/notifications/unread-count` | API key | 200 | 审计时接受；本地代码已改为部署后应返回 401 |

结论：

- API key 管理、分享链接管理、Webhook 管理、admin stats 没有被普通 API key 打开。
- 通知接口已决定为网页登录 cookie/session 专用；本地代码已修复，线上需部署后复查。
- 公告接口、统计时间线、域名管理路径也已改为网页登录 cookie/session 专用；线上需部署后复查。

### 6.4 负面检查

| ID | 检查 | 次数 | 状态 | 结果 |
| --- | --- | ---: | --- | --- |
| AUTH-invalid-api-key | 错误 API key 请求 `GET /api/stats` | 3 | 401, 401, 401 | 都被拒绝，低次数内未观察到 429 |
| AUTH-fake-login | 假登录且不带 Turnstile token | 3 | 400, 400, 400 | 都被 Turnstile 拦截在密码验证前 |
| SHR-invalid-token | 错误分享 token | 1 | 404 | 返回泛化错误 `share link not found` |

结论：

- 已观察到无 Turnstile token 的登录请求会被拦截在密码验证前；未做爆破/撞库证明。
- 分享 token 错误返回不泄露过多信息。
- API key 错误请求前置限速已在本地代码中补上；线上需部署后复查。

## 7. 公共文档和旧接口残留检查

检查了生产环境的 `openapi.json`、`docs.md`、`skill.md`，没有发现以下旧接口/危险关键词：

- `/api/v1`
- `/api/shared/{token}/access`
- `/api/shared/:token/access`
- `password_required`
- `clear_password`
- `message share`
- 旧的“邮件分享”相关乱码/中文关键词

结论：

- 公开文档没有暴露旧的 message-share/password unlock 合约。
- 这部分表现良好。

## 8. 子代理复查结论

子代理复查后给出的关键意见：

- 不要写成“完全通过”，应该写成“部分通过，有明确修复项”。
- 生产前端出现默认开发密码和隐藏安装跳过开关相关字符串，应归为高优先级。
- 通知接口、公告接口、`stats/timeseries`、域名管理路径已确定为 Web 登录专用并已在本地代码修复。
- 一次性审计 key 权限偏大，报告里必须提醒删除/撤销。
- 低风险线上测试没有做爆破和压力测试，所以不能用“已证明抗爆破”这种过强表述，只能说“登录侧已观察到 Turnstile 拦截，API key 侧建议加强限速”。

## 9. 修复顺序建议

### 立刻做

1. 删除或撤销本次一次性审计 key。
   完成标准：用这个 key 请求 `GET /api/stats`，应返回 `401` 或 `403`。
2. 移除生产前端里的开发安装快捷入口和默认账号字符串。
   完成标准：源码和生产构建产物中不再包含隐藏安装跳过开关、默认开发账号/密码相关字符串。
3. 重新构建部署，并复查前端 JS 不再包含相关开发残留字符串。
   完成标准：线上 JS 资源关键词复查无命中。

### 接着做

1. 部署通知接口 cookie-only 修复，并复查生产环境。
   完成标准：API key-only 请求 `/api/notifications*` 返回 `401 login required`，cookie session 请求正常，且 API key 不消耗 quota。
2. 部署公告、统计时间线、域名管理路径的 cookie-only 修复，并复查生产环境。
   完成标准：API key-only 请求 `/api/announcements*`、`/api/stats/timeseries`、`/api/domains*` 返回 `401 login required` 或其它非成功拒绝，cookie session 请求正常，且 API key 不消耗 quota；`/api/domains/available` 仍允许 API key。
3. 部署错误 API key 前置限速。
   完成标准：连续错误 API key 请求会触发 `429`，日志只出现摘要指纹和来源，不记录完整错误 key。
4. 清理本地秘密文件风险，确认不会被提交、上传或打包。
   完成标准：`.env`、本地数据库、工具配置不会被 git 跟踪，也不会进入发布包或截图报告。

### 后续可选深挖

1. 使用管理员 session 做 Web 控制台浏览器审计。
2. 在本地或测试环境做 Webhook SSRF、DNS rebinding、SMTP 滥用、SSE 连接上限测试。
3. 做一次发布前安全检查清单，把危险字符串、密钥、旧接口关键词加入自动扫描。

## 10. 当前结论

当前线上不是“裸奔”状态：登录侧有人机验证，公开安装/版本/文档接口没有直接泄露核心秘密，多个管理接口也挡住了 API key-only 访问。

但也不能算完全安全：生产前端开发残留必须优先处理；审计 key 必须撤销；API key 权限边界和错误 key 限速需要明确修复。完成这些后，再做一轮复查会比较稳。
