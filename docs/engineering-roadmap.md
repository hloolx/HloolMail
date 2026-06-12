# HLOOL Mail 工程化路线图（Engineering Roadmap）

> 生成日期：2026-06-12
> 目标：在保持「单机自托管为主、Redis 可选」定位的前提下，将项目工程质量对齐大厂基线。
> 本文档基于对当前代码库的全量审查，所有问题均附带文件路径与行号证据。

---

## 1. 总览与评分卡

| 维度 | 当前水平 | 大厂基线差距 | 优先级 |
| --- | --- | --- | --- |
| 安全实践 | 7/10 | API Key 明文落库是唯一硬伤；其余（SSRF、HTML 清洗、同源写保护、bcrypt）已达标 | P0 |
| 数据库与持久化 | 6/10 | PostgreSQL 连接池未配置；AutoMigrate 无版本化、无回滚 | P0 / P1 |
| 资源与防滥用 | 6/10 | rate limiter 内存无上限；SMTP 无 per-IP 限速 | P0 |
| 部署与容器 | 7/10 | app 容器无 healthcheck、无 depends_on | P0 |
| CI/CD | 5/10 | 无 lint、无覆盖率、无安全扫描；前端 lint 未入 CI | P1 |
| 可观测性 | 4/10 | 无 metrics、无 request-id、残留非结构化日志 | P1 |
| API 设计 | 8/10 | envelope 统一、OpenAPI registry 完善；缺 spec 与路由一致性校验 | P1 |
| 后端架构 | 6/10 | handlers.go 2764 行 110 函数；无 service 层 | P2 |
| 测试 | 6/10 | 后端集成测试强（1.5 万行）；前端零测试；无全链路 E2E | P2 |
| 前端工程 | 7/10 | React 19 + TS strict + 代码分割已达标；API 类型手写易漂移 | P2 |

### 已达标的强项（不要重做）

以下部分质量已经不输大厂同类实现，后续迭代请保持现有模式，不要推翻：

- **Webhook 子系统**（`internal/webhook/`）：HMAC-SHA256 签名（`worker.go:319-327`）、8 级指数退避重试 + jitter、分布式锁字段、完整 SSRF 防护（`ssrf.go`：私网/链路本地/元数据地址全封禁 + 重定向重校验）。
- **HTML 邮件双层清洗**：服务端 bluemonday 白名单（`internal/mailhtml/sanitize.go`）+ 前端 iframe sandbox + CSP `default-src 'none'`（`web/src/lib/emailHtml.ts`）。
- **同源写保护**：`internal/http/middleware.go:353` `requireSameOriginSessionWrite()` 用 Origin/Referer/Sec-Fetch-Site 三重校验，session Cookie 已设 `SameSite=Lax`（`auth_handlers.go:794`），且有专门测试（`web_session_boundary_test.go`）。
- **API Key 设计**：前缀快查 + bcrypt 验证 + 配额原子扣减（`internal/auth/apikey.go`）——仅明文列是问题，见 P0-1。
- **OpenAPI registry**（`internal/apispec/`）：单一来源生成 JSON/YAML/Markdown/Skill 四种格式。
- **Release 自动化**：tag 触发五平台二进制 + GHCR 多架构镜像 + 强制 release notes。
- **优雅关闭**：`internal/serverapp/server.go` signal.NotifyContext + WaitGroup 双服务关闭，模式正确。

---

## 2. P0 — 安全与正确性（立即做）

### P0-1 移除 API Key 明文存储

**问题**：API Key 创建后明文持久化在数据库，泄库即泄全部 key，bcrypt hash 形同虚设。

**证据**：
- `internal/models/models.go:252`：`KeyValue string \`gorm:"column:key_value;index;size:128;not null"\``
- `internal/auth/apikey.go:98`：创建时写入 `KeyValue: plain`
- `internal/auth/apikey.go:119`：认证时先 `Where("key_value = ?", plain)` 精确匹配明文
- `internal/http/handlers.go:1817`、`internal/http/user_handlers.go:165`：reveal 接口直接返回 `key.KeyValue`

**行业标准**：GitHub PAT、Stripe、AWS 均只在创建时返回一次明文，不提供 reveal。数据库只存 hash + 前缀。

**方案**（分三步渐进迁移，避免破坏存量用户）：

1. **停写**：`apikey.go` CreateFor 不再写 `KeyValue`；`Authenticate` 删除 `key_value` 精确匹配分支（`apikey.go:118-125`），只走前缀 + bcrypt 路径（该路径已存在且有测试覆盖）。
2. **改语义**：reveal 接口（`handlers.go:1817`、`user_handlers.go:165`）改为「重新生成」——生成新 key、更新 hash/prefix、返回一次新明文；前端文案从「查看」改为「重新生成（旧 key 立即失效）」。Web Console 已有「明文只显示一次」的文案基础（README 已如此宣传），改动成本低。
3. **清列**：发版后下一个版本执行数据迁移：`UPDATE api_keys SET key_value = ''`，再删列。GORM AutoMigrate 不会删列，需手写迁移（见 P1-2 迁移工具引入后执行）。

**验证**：`internal/auth/apikey_test.go:38`、`:200` 现有测试需同步调整；新增「reveal 后旧 key 认证失败」测试。

**工作量**：约 1 人日。

### P0-2 配置 PostgreSQL 连接池

**问题**：PostgreSQL 分支直接 `gorm.Open` 后没有任何连接池配置，Go `database/sql` 默认 `MaxOpenConns` 无上限——高并发时会无限开连接打爆数据库；`MaxIdleConns` 默认 2，造成频繁建连。

**证据**：`internal/db/db.go:28-29`：

```go
case "postgres", "postgresql":
    return gorm.Open(postgres.Open(cfg.DatabaseURL), gormConfig)  // 无任何池配置
```

对比 SQLite 分支有专门的 `configureSQLitePool`（`db.go:101-109`，MaxOpenConns=1，对 SQLite 这是正确的）。

**方案**：仿照 SQLite 增加 `configurePostgresPool`：

```go
func configurePostgresPool(db *gorm.DB, cfg config.Config) error {
    sqlDB, err := db.DB()
    if err != nil {
        return err
    }
    sqlDB.SetMaxOpenConns(cfg.DBMaxOpenConns)       // 默认 25
    sqlDB.SetMaxIdleConns(cfg.DBMaxIdleConns)       // 默认 5
    sqlDB.SetConnMaxLifetime(time.Hour)             // 防止云数据库 LB 静默断连
    sqlDB.SetConnMaxIdleTime(10 * time.Minute)
    return nil
}
```

新增环境变量 `DB_MAX_OPEN_CONNS` / `DB_MAX_IDLE_CONNS`（`internal/config/config.go` 已有 `getInt` 工具函数可复用），并同步到 `docker-compose.yml` 与 `.env.compose.example`。

**工作量**：约 0.5 人日。

### P0-3 rate limiter 内存上限

**问题**：`internal/http/ratelimit.go:10-13` 的 `map[string]*clientLimiter` 无容量上限，仅靠 10 分钟过期清理（`ratelimit.go:41-53`）。攻击者用海量伪造 IP 打公开端点（key 含 `ip:{ClientIP}`），10 分钟窗口内 map 可无限增长，OOM 风险。

**方案**（单机形态，不引入 Redis）：

- 加硬上限（如 100,000 条目）。超限时优先淘汰 `lastSeen` 最旧的条目（map 改为 map + 双向链表的简易 LRU，或直接随机驱逐——对限流场景随机驱逐已足够）。
- 当前 `cleanup` 每 5 分钟全量扫描持锁遍历，条目多时会阻塞所有请求；改为分批清理或在 `allow()` 中顺带惰性淘汰。

```go
const maxLimiterEntries = 100_000

func (rl *rateLimiter) allow(key string, r rate.Limit, burst int) bool {
    rl.mu.Lock()
    entry, exists := rl.limiters[key]
    if !exists {
        if len(rl.limiters) >= maxLimiterEntries {
            rl.evictOldestLocked() // 或随机驱逐若干条
        }
        entry = &clientLimiter{limiter: rate.NewLimiter(r, burst)}
        rl.limiters[key] = entry
    }
    ...
}
```

- 若未来启用多实例，再以接口抽象切换 Redis 实现（`compose` 中 redis 服务已是 optional profile，保留即可）。

**工作量**：约 0.5 人日。

### P0-4 SMTP 入站防滥用

**问题**：`internal/smtp/server.go:22-36` 仅设置了 `MaxMessageBytes` 与 `MaxRecipients = 100`，无 per-IP 连接频率限制。公网 25 端口暴露后，单 IP 可无限刷连接/会话，耗尽 goroutine 与数据库写入。

**方案**：在 TCP 层包一个限速 listener（不依赖 go-smtp 内部 API，最稳）：

```go
// 自定义 Listener：Accept 后按 RemoteAddr 查 rate limiter，超限直接 Close
type throttledListener struct {
    net.Listener
    limiter *rateLimiter // 复用 internal/http 的实现（P0-3 加上限后）
}

func (l *throttledListener) Accept() (net.Conn, error) {
    for {
        conn, err := l.Listener.Accept()
        if err != nil {
            return nil, err
        }
        ip, _, _ := net.SplitHostPort(conn.RemoteAddr().String())
        if !l.limiter.allow("smtp:"+ip, rate.Limit(1), 5) { // 每 IP 1 conn/s, burst 5
            conn.Close()
            continue
        }
        return conn, nil
    }
}
```

`Start` 中改用 `server.Serve(throttledListener)` 代替 `ListenAndServe()`。建议同时把 rate limiter 从 `internal/http` 提升到独立包（如 `internal/ratelimit`）供两处复用。

配套：单 IP 并发会话计数上限（如 10），SMTP 错误返回 `421 too many connections`。

**工作量**：约 1 人日。

### P0-5 Docker healthcheck 与启动顺序

**问题**：
- `Dockerfile` 无 `HEALTHCHECK` 指令（全文 39 行均无）。
- `docker-compose.yml:4-51` app 服务无 healthcheck，也无 `depends_on`，而 `DATABASE_URL` 默认指向 `postgres:5432`（`docker-compose.yml:25`）——app 先于 postgres 就绪时启动会失败重启。postgres 自身的 healthcheck 已配好（`docker-compose.yml:62-66`）但没人消费它。

**方案**：项目已有 `/api/health` 端点（`internal/http/router.go:75`），直接接线即可。

Dockerfile（alpine 自带 busybox wget）：

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health || exit 1
```

docker-compose.yml app 服务追加：

```yaml
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-q", "-O", "/dev/null", "http://127.0.0.1:3000/api/health"]
      interval: 30s
      timeout: 5s
      start_period: 15s
      retries: 3
```

注意：healthcheck 请求会命中 `/api/health` 的 per-IP 限流（router.go:75 配置为 2 req/s burst 5），30s 间隔不会触发，无需调整。

**工作量**：约 0.5 人日。

### P0-6 小项清理

| 问题 | 证据 | 修复 |
| --- | --- | --- |
| 清 cookie 未带 SameSite | `internal/http/middleware.go:38`、`:46` 直接 `c.SetCookie(...)`，未像 `auth_handlers.go:794` 先 `c.SetSameSite(http.SameSiteLaxMode)` | 抽一个 `clearSessionCookie(c)` 工具函数统一行为 |
| 非结构化日志残留 | `internal/http/middleware.go:37` `log.Println("session verify failed:", err)` | 改 `slog.Warn("session verify failed", "error", err)`；全仓 `grep -rn "log\.Print"` 一次性清理 |
| compose 弱默认密码 | `docker-compose.yml:25`、`:59` `local-dev-only-change-me` | postgres entrypoint 已拦截（`:55`），但 app 的 `DATABASE_URL` 默认值仍嵌入该密码；将 app 启动时对 DATABASE_URL 含默认密码的情况打印醒目警告 |

**工作量**：合计约 0.5 人日。

---

## 3. P1 — 工程化基线（1-2 周节奏）

> 原则：先把 CI 护栏立起来，再做任何大改动。这是大厂做法的核心——重构的信心来自机器检查，不是人肉 review。

### P1-1 CI 强化

**现状**（`.github/workflows/ci.yml` 全文 61 行）：只有 `go test`、关键包 race 测试、前端 build、compose config 校验、Docker build。**没有任何 lint、覆盖率、安全扫描**；前端 `package.json` 里配好的 eslint/prettier 在 CI 中未调用。

**方案**：

1. **golangci-lint**。新增 `.golangci.yml`：

```yaml
run:
  timeout: 5m
linters:
  enable:
    - errcheck      # 未检查的 error
    - govet
    - staticcheck
    - gosec         # 安全扫描（弱随机、SQL 拼接、文件权限）
    - ineffassign
    - unconvert
    - misspell
    - bodyclose     # HTTP response body 泄漏
    - noctx         # 无 context 的网络调用
issues:
  exclude-rules:
    - path: _test\.go
      linters: [gosec, errcheck]
```

CI 中加：

```yaml
      - name: Lint Go
        uses: golangci/golangci-lint-action@v6
        with:
          version: latest
```

首次引入存量告警会很多：用 `--new-from-rev=origin/main` 只检查增量，存量按周清理。

2. **前端 lint + 类型检查入 CI**：

```yaml
      - name: Lint web console
        working-directory: web
        run: |
          npm run lint
          npx tsc --noEmit
```

3. **覆盖率**：`go test -coverprofile=coverage.out ./...` + 上传 artifact。先观测不设门槛，两周后按实际值设底线（建议从「不允许下降」开始而非绝对值）。

4. **镜像扫描**：build 后加 `aquasecurity/trivy-action`，`severity: CRITICAL,HIGH`，先 `exit-code: 0`（只报告）跑两周再转阻断。

**工作量**：约 2 人日（含存量 lint 告警首轮清理）。

### P1-2 版本化数据库迁移

**现状**：完全依赖 GORM AutoMigrate（`internal/db/db.go:125-160`，30 个 model）+ 一组手写回填函数（`db.go:161` 起 `EnsureShareLinkMailboxShareSchema` 等）。问题：

- 无法删列/改类型/删索引（AutoMigrate 只增不减）——P0-1 删 `key_value` 列就被卡住
- 无迁移历史表，无法知道某环境处于什么 schema 版本
- 无回滚能力，升级失败只能恢复备份
- 多实例并发启动同时跑 AutoMigrate 有竞态（虽然单机形态影响小）

**方案**：渐进引入 [golang-migrate](https://github.com/golang-migrate/migrate)（或 pressly/goose，二选一，golang-migrate 的 SQLite/Postgres 双驱动更成熟）：

1. **锁定基线**：当前 schema 导出为 `migrations/000001_baseline.up.sql`（对已有库标记为已应用，不执行）。
2. **双轨期**：AutoMigrate 保留兜底（防止漏写迁移导致启动失败），新 schema 变更必须写迁移文件。启动顺序：先跑 migrate，再跑 AutoMigrate（此时应为 no-op，若不是则打 warning 提醒开发者补迁移文件）。
3. **双方言**：目录按 `migrations/sqlite/` 与 `migrations/postgres/` 分开（两者 DDL 方言差异大，SQLite 改列要重建表，不要试图共用一份 SQL）。
4. **收口**：稳定两三个版本后移除 AutoMigrate，迁移文件成为唯一事实。

嵌入二进制：`//go:embed migrations` + `iofs` source driver，与现有「启动时自动迁移」的用户体验保持一致。

**工作量**：约 3 人日。

### P1-3 OpenAPI spec 与路由一致性测试

**现状**：`internal/apispec/spec.go`（890 行注册表）与 `internal/http/router.go` 的实际路由各自手工维护，无任何机器校验。新增 handler 忘记登记 spec、或改了路径忘记同步，文档静默漂移——而 README 明确承诺「完整契约以运行中服务导出的文档为准」，文档错误等于契约违约。

**方案**：写一个单元测试做双向 diff：

```go
func TestOpenAPISpecMatchesRoutes(t *testing.T) {
    router := buildTestRouter(t)         // 复用现有测试的 router 构造
    ginRoutes := normalizeGinRoutes(router.Routes()) // {method, path} 集合，:id → {id}
    specRoutes := apispec.RegisteredRoutes()         // 注册表导出 {method, path}

    // spec 中有但路由不存在 → 文档撒谎，必须 fail
    // 路由存在但 spec 缺失 → 维护白名单（内部端点、页面路由），白名单外 fail
}
```

需要在 `apispec` 包加一个导出注册表路由清单的小函数。白名单机制让内部端点（如 `/install/*`）可以显式豁免，新 API 端点则强制登记。

**工作量**：约 1 人日。

### P1-4 可观测性：metrics + request-id

**现状**：结构化日志（slog）已用上，但：无 Prometheus metrics、无 request-id 贯穿、GORM 无慢查询日志。单机自托管也需要这些——用户报「收不到信」时，没有 SMTP 接收计数和 webhook 成功率指标，排障只能翻日志。

**方案**（只用 `prometheus/client_golang`，不引入 OTel，符合单机定位）：

1. `/metrics` 端点（建议挂内部端口或加 admin 鉴权，避免公开暴露）：
   - `http_request_duration_seconds`（histogram，label: method/route/status）— Gin middleware 实现
   - `smtp_messages_received_total`、`smtp_messages_rejected_total`（label: reason）— 挂在 `internal/smtp/backend.go` 的 Data/Rcpt 路径
   - `webhook_deliveries_total`（label: outcome=success/retry/failed）+ `webhook_queue_depth`（gauge）— 挂在 `internal/webhook/worker.go`
   - `mailboxes_total`、`messages_stored_total` — 复用现有 stats 查询
2. **request-id middleware**：入站读 `X-Request-ID`（信任反代）或生成 UUID，写入 response header 与 `slog` 上下文（Go 1.21+ 可用 `slog.With`），handler 内日志统一带上。
3. **GORM 慢查询**：`gormConfig` 的 Logger 设 `SlowThreshold: 200ms`，输出走 slog 适配器。

**工作量**：约 2 人日。

### P1-5 配置启动校验（fail-fast）

**现状**：`internal/config/config.go` 只有 `ValidateSessionSecret`（secret 强度），其他配置错误（PublicBaseURL 不是合法 URL、端口格式错、retention 为负）静默吞掉——`getInt` 解析失败回退默认值，用户配错了毫无感知。

**方案**：加 `Config.Validate() []error`，启动时汇总输出全部错误再退出（不是遇到第一个就停，让用户一次改完）：

```go
func (c Config) Validate() []error {
    var errs []error
    if c.PublicBaseURL != "" {
        if u, err := url.Parse(c.PublicBaseURL); err != nil || u.Scheme == "" || u.Host == "" {
            errs = append(errs, fmt.Errorf("PUBLIC_BASE_URL invalid: %q", c.PublicBaseURL))
        }
    }
    if _, _, err := net.SplitHostPort(strings.TrimPrefix(c.HTTPAddr, ":")); ... 
    // MessageRetention > 0、MaxMessageBytes 合理区间、DATABASE_URL 与 driver 匹配 等
    return errs
}
```

同时让 `getInt`/`getInt64` 在解析失败时打 `slog.Warn`（带原始值与回退值），不再静默。

**工作量**：约 1 人日。

---

## 4. P2 — 架构演进（按需推进）

> 原则：P2 是「痛了再做」的清单，不是必须全做。单机自托管项目最大的风险是过度工程，下面每项都标了触发条件。

### P2-1 handlers.go 拆分

**现状**：`internal/http/handlers.go` 2764 行、110 个函数，混合了 handler、查询助手、DTO 组装。同目录其他文件已按域拆分（auth/admin/oauth/share/user/webhook handlers），唯独这个「兜底文件」持续膨胀。

**触发条件**：下次需要在该文件新增功能时顺手做，不单独立项。

**拆分顺序**（先机械移动，不改逻辑，保证 diff 可读）：

1. `stats_handlers.go` — 统计类（低耦合，先动）
2. `domain_handlers.go` — 域名查询类
3. `mailbox_handlers.go` — 邮箱 CRUD
4. `message_handlers.go` — 邮件读取/删除/next
5. 查询助手函数下沉到 `internal/db` 或新建 `internal/query` 包

每步独立提交，跑全量测试（现有 `access_test.go` 4654 行集成测试是安全网，这是项目的宝贵资产）。

**service 层引入原则**：只对**有复杂业务规则**的域抽 service——配额扣减（现散落在 `consumeUserQuota` 与 `apikey.Consume`）、分享链接生命周期、域名验证状态机。纯 CRUD 的薄 handler 直接调 GORM 不是问题，不要为了「分层好看」给每个资源都套 service/repository 三件套。

**工作量**：机械拆分约 2 人日；service 抽取按域各 1-2 人日。

### P2-2 前端测试从零到一

**现状**：`web/` 零测试文件（已确认无 *.test.* / *.spec.* / vitest/playwright 配置）。但 lint + prettier + `tsc --noEmit` 已齐。

**策略**（性价比排序，不求覆盖率，求关键路径）：

1. **Vitest + Testing Library**，第一批只测三个安全/逻辑关键的纯模块：
   - `web/src/lib/emailHtml.ts`（182 行）——HTML 清洗黑名单、CSP 构造。这是 XSS 防线，回归代价最高
   - `web/src/lib/markdown.ts`（336 行）——白名单标签/属性/URL 校验
   - `web/src/api.ts` 的重试/去重/超时逻辑（695 行中的核心部分，mock fetch 即测）
2. CI 加 `npm run test`。
3. **Playwright 烟囱测试**（可选，触发条件：出现两次以上「发版后控制台白屏/登录坏了」类事故）：仅一条主链路——安装→登录→生成邮箱→（SMTP 注入一封信）→收件箱可见。

**工作量**：第一批单测约 2 人日；Playwright 约 2 人日。

### P2-3 前端 API 类型生成

**现状**：所有 API 响应类型手写（`web/src/api.ts` 约 200 行类型 + `web/src/types/index.ts` 331 行），与后端 `internal/apispec/schemas.go` 的 Schema 定义重复维护，字段改名时两边漂移无人发现。

**方案**：用 [openapi-typescript](https://github.com/openapi-ts/openapi-typescript) 从 `/api/openapi.json` 生成类型：

```bash
# web/package.json scripts
"gen:api": "openapi-typescript ../openapi-snapshot.json -o src/types/generated.ts"
```

落地路径：后端加一个 `go run ./cmd/server dump-openapi > openapi-snapshot.json` 子命令（CLI 框架已有 `openapi json` 命令，`internal/cli/cli.go`，可能直接复用）→ 生成的类型先与手写类型并存、新代码用生成类型 → CI 校验 snapshot 与生成文件无 diff（防止后端改了 schema 前端忘记重新生成）。

**前置依赖**：P1-3（spec 与路由一致性）先做，否则生成的类型本身可能就是错的。

**工作量**：约 2 人日。

### P2-4 全链路 E2E 集成测试（Go）

**现状**：`access_test.go` 覆盖 HTTP API 层很全，但「SMTP 收信 → 解析 → 落库 → API 读取 → webhook 投递」全链路无一条贯穿测试；`internal/mail/parser_test.go` 仅 27 行，MIME 边界情况（嵌套 multipart、编码异常、超大头部）未覆盖。

**方案**：

1. 一条全链路测试：testcontainer 或内存 SQLite 起完整 serverapp → 真实 TCP 连 SMTP 端口发一封 multipart 邮件 → 轮询 API 读到邮件 → 本地 httptest.Server 收到 webhook 且签名可验证。
2. parser 表驱动测试扩充：用真实邮件样本（HTML+附件、base64、quoted-printable、错误 boundary、超限附件触发 552）。

**工作量**：约 3 人日。

### P2-5 前端性能微调

**触发条件**：用户反馈卡顿或邮箱列表超过千级时再做。

- **zustand selector 化**：`useAppStore()` 整对象订阅会让任何 state 变化触发全组件重渲染，改 `useAppStore(s => s.page)` 粒度订阅（`web/src/store.ts` 254 行，改动集中）。
- 共享组件（`web/src/components/shared/`，2453 行）memo 审计：只对列表行级组件（DataTable 行）加 `React.memo`，容器组件不加。

**工作量**：约 1 人日。

---

## 5. P3 — 锦上添花（可选）

| 项 | 说明 | 触发条件 |
| --- | --- | --- |
| SPF 校验标注 | 入站邮件查 SPF（如 `blitiri.com.ar/go/spf`），结果存 metadata 并在 UI 标记，**不拒收**（收信测试平台拒收会误伤合法测试） | 用户反馈钓鱼/伪造邮件困扰 |
| 审计日志导出 | `internal/http/audit.go` 异步队列已就绪，加一个可选的 file/syslog sink | 有合规需求 |
| OpenTelemetry tracing | 单进程内价值有限，P1-4 的 request-id + 慢查询日志已覆盖 80% 排障场景 | 出现跨服务部署 |
| Sentry / 前端错误上报 | 自托管场景需用户自配 DSN，做成可选配置 | 前端报障频繁且无法复现 |
| Web Vitals | 控制台是内部工具，性能预算优先级低 | — |
| i18n 数字/日期 Intl 化 | `web/src/locales/` 手工方案对双语言够用；复数规则和 RTL 暂无需求 | 增加第三语言时 |
| CHANGELOG.md 聚合 | `docs/releases/*.md` 已按版本归档，聚合文件价值不大；可在 README 加索引链接 | — |

---

## 6. 明确「不建议做」清单

这些是常见的「大厂化」误区，对本项目的定位（单机自托管、单仓单二进制）是负资产：

1. **不要拆微服务**。SMTP/HTTP/worker 同进程共享 DB 是本项目的部署简单性卖点，拆开只会增加自托管用户的运维负担。
2. **不要强上 Redis**。P0-3 的内存 LRU 上限对单机够用；compose 中 redis 保持 optional profile，等真有多实例需求再以接口切换。
3. **不要全量重写 handlers**。机械拆文件 + 局部抽 service 即可，现有 1.5 万行测试是按当前行为写的，大重写等于丢弃安全网。
4. **不要引入 API 版本前缀（/api/v1）**。`apispec/spec.go:90-92` 注释的「向后兼容维护稳定性」策略对此规模合理；真要破坏性变更时用字段级弃用周期（响应中保留旧字段 + 文档标 deprecated），而不是整版本分叉。
5. **不要追求覆盖率数字**。先把 P2-2 的三个安全关键模块测了，比给 UI 组件刷 80% 覆盖率有价值得多。

---

## 7. 落地节奏建议

```
第 1 周   P0 全部（约 4 人日）：
          P0-2 连接池 → P0-5 healthcheck → P0-6 小项 → P0-3 limiter 上限
          → P0-4 SMTP 限速 → P0-1 API Key 明文（停写 + 改 reveal 语义）

第 2-3 周 P1 护栏（约 9 人日）：
          P1-1 CI 强化（最先，让后续改动有机器把关）
          → P1-5 配置校验 → P1-3 spec 一致性测试
          → P1-2 迁移工具（完成后回头执行 P0-1 第三步删列）
          → P1-4 metrics

第 4 周起 P2 按触发条件推进，优先级：
          P2-2 前端安全模块测试 > P2-1 handlers 拆分（搭车进行）
          > P2-3 类型生成（依赖 P1-3）> P2-4 E2E > P2-5 性能
```

依赖关系：`P1-2 迁移工具 ← P0-1 删列`；`P1-3 spec 校验 ← P2-3 类型生成`；其余各项相互独立，可并行。

总计 P0+P1 约 13 人日。完成后，本项目在安全、CI、可观测性三个维度即达到大厂中型服务的基线；P2 完成后测试与架构维度也对齐。
