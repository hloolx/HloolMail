<p align="center">
  <img src="web/public/brand-logo.svg" width="96" height="96" alt="HLOOL Mail logo">
</p>

<h1 align="center">HLOOL Mail</h1>

<p align="center">
  自托管临时邮箱与私有域名收信平台，内置 SMTP catch-all、Web Console、API Key、Webhook、Share Link 和 CLI。
</p>

<p align="center">
  <a href="#hlool-mail-是什么--不是什么">是什么</a> ·
  <a href="#5-分钟-docker-compose">Docker Compose</a> ·
  <a href="#release-二进制">Release</a> ·
  <a href="#api-自动化">API</a> ·
  <a href="#cli">CLI</a>
</p>

<p align="center">
  <a href="https://linux.do">学 AI 上 L 站</a>
</p>

## HLOOL Mail 是什么 / 不是什么

HLOOL Mail 用来搭建自部署、支持多用户的匿名邮箱和私有域名收信服务。只需要把域名的 MX 指向你的 HLOOL Mail 收信主机，就可以让所有用户在你的域名下创建和使用自己的匿名邮箱；你也可以接入自有域名，为团队、脚本、测试平台、CI 或 AI 助手提供可控的收信能力。

它最初是为批量注册和自动化验证设计的：网上常见匿名邮箱经常被屏蔽；用 Cloudflare 或第三方服务临时接入流程又太繁琐；直接把 MX 指向第三方站点，还会担心滥用、权限和数据不可控。

现在，你可以用这个项目改变这些问题：域名由你提供，MX 由你控制，用户、额度、API Key 和访问边界也由你管理。

它不是什么：

- 不是传统 IMAP/POP3 邮箱客户端，也不提供 IMAP/POP3。
- 不负责外发邮件，核心目标是稳定收信、归属隔离、自动化读取和控制台管理。

## 5 分钟 Docker Compose

Docker Compose 是推荐部署方式，默认启动 `app` 和 `postgres`，应用通过 PostgreSQL 持久化数据。

```bash
cp .env.compose.example .env
nano .env
docker compose up -d --build
docker compose logs -f app
```

至少修改这些值：

```env
PUBLIC_BASE_URL=https://mail.example.com
MAIL_HOSTNAME=mail.example.com
EXPECTED_MX=mail.example.com
POSTGRES_PASSWORD=replace-with-a-strong-postgres-password
DEV_MODE=false
```

`SESSION_SECRET` 和 `INBOX_TOKEN_SECRET` 可以留空，让 Install Page 首次安装时自动生成并保存到 `/app/storage/.env`；也可以提前填入两个不同的强随机值。

本地测试可以保留 `SMTP_PORT=2525`。真实接收互联网邮件时，外部邮件服务器通常连接 TCP 25；如果服务器和云厂商允许，把 `.env` 里的 `SMTP_PORT` 改成 `25`，或在负载均衡/端口转发层把公网 25 转到容器的 2525。

使用已经发布的 GHCR 镜像：

```bash
docker compose pull
docker compose up -d
```

如果本地 Docker 构建访问 Go 或 npm 官方源较慢，可以在 `.env` 里调整：

```env
GOPROXY=https://goproxy.cn,direct
NPM_CONFIG_REGISTRY=https://registry.npmmirror.com/
```

使用外部托管 PostgreSQL 时，把 `.env` 的 `DATABASE_URL` 改成外部连接串：

```env
DATABASE_URL=postgres://user:password@db.example.com:5432/hloolmail?sslmode=require
```

## Release 二进制

Release 包会把前端静态资源内嵌进后端二进制。下载对应平台的包后，不需要单独携带 `web/dist`，程序会直接托管 Web Console。

常见资产：

| 文件 | 适用环境 |
| --- | --- |
| `hloolmail-linux-amd64.tar.gz` | 常见 x86_64/AMD64 Linux 服务器 |
| `hloolmail-linux-arm64.tar.gz` | ARM64 Linux 服务器、部分云主机、树莓派 64 位系统 |
| `hloolmail-linux-armv7.tar.gz` | ARMv7 Linux 设备、部分 32 位树莓派系统 |
| `hloolmail-darwin-arm64.tar.gz` | Apple Silicon macOS |
| `hloolmail-windows-amd64.zip` | Windows x64 |

Linux 二进制包示例：

```bash
tar -xzf hloolmail-linux-amd64.tar.gz
cd hloolmail-linux-amd64
chmod +x hloolmail

export HTTP_ADDR=:3000
export SMTP_ADDR=:2525
export DATABASE_DRIVER=postgres
export DATABASE_URL='postgres://user:password@127.0.0.1:5432/hloolmail?sslmode=disable'
export PUBLIC_BASE_URL=https://mail.example.com
export MAIL_HOSTNAME=mail.example.com
export EXPECTED_MX=mail.example.com
export DEV_MODE=false

./hloolmail
```

`hloolmail` 同时也是 CLI。无参数或 `serve` 会启动服务；其他子命令用于 API 自动化。

systemd 示例：

```ini
[Unit]
Description=HLOOL Mail
After=network.target

[Service]
WorkingDirectory=/opt/hloolmail
ExecStart=/opt/hloolmail/hloolmail
Restart=always
Environment=HTTP_ADDR=:3000
Environment=SMTP_ADDR=:2525
Environment=DATABASE_DRIVER=postgres
Environment=DATABASE_URL=postgres://user:password@127.0.0.1:5432/hloolmail?sslmode=disable
Environment=PUBLIC_BASE_URL=https://mail.example.com
Environment=MAIL_HOSTNAME=mail.example.com
Environment=EXPECTED_MX=mail.example.com
Environment=DEV_MODE=false

[Install]
WantedBy=multi-user.target
```

自定义前端只适合高级场景。把 `FRONTEND_DIST` 指向一个包含 `index.html` 和 `assets/` 的构建目录即可；如果目录不存在或缺少 `index.html`，程序会回退到内置前端。

```bash
cd web
npm install
npm run build
cd ..

export FRONTEND_DIST=web/dist
./hloolmail
```

只把 `web/dist` 当成纯静态前端单独部署不是推荐模式，因为前端默认调用同源 `/api`。如果确实要分离部署，需要在前端域名上反向代理 `/api` 到 HLOOL Mail 后端，并处理 Cookie、CORS 和 HTTPS。

## Install Page

首次打开 `http://服务器IP:3000` 或你的域名后，如果还没有管理员账号，会自动进入 Install Page。

| 部署方式 | Install Page 行为 |
| --- | --- |
| Docker Compose | 生效，用于创建管理员账号，并可自动生成 `SESSION_SECRET` / `INBOX_TOKEN_SECRET`。数据库、端口、站点 URL、MX 主机等运行时配置会被锁定，必须通过 `.env` / Compose 修改后重启。 |
| Docker 单容器 | 同 Compose。容器环境会自动锁定运行时配置，避免页面里写入的配置和容器环境变量打架。 |
| Release 二进制 | 生效，可创建管理员，也可以把配置写入 `.env` 或 `CONFIG_ENV_PATH` 指定的文件。若在页面里切换数据库或数据库地址，可能需要重启程序。 |
| 本地开发 | 生效，适合快速体验 SQLite 或本地 PostgreSQL。 |

容器内默认 `HLOOLMAIL_CONFIG_LOCKED=true`。Install Page 会禁用数据库、端口、URL 等字段，后端提交安装时也会保留容器环境变量里的运行时配置。

如果你确实希望 Docker 内的 Install Page 也能改数据库/端口等配置，可以设置：

```env
HLOOLMAIL_CONFIG_LOCKED=false
```

生产环境不建议这样做。更稳的方式是：运行时配置放在 `.env` / Compose，Install Page 只负责首次管理员和密钥初始化。

## DNS/MX

`MAIL_HOSTNAME` / `EXPECTED_MX` 应该填写你自己的 HLOOL Mail 收信主机名，不是 QQ、Google 或 Outlook 的邮箱服务器。

如果你的站点是 `https://mail.example.com`，希望接收 `user@example.com`：

```env
PUBLIC_BASE_URL=https://mail.example.com
MAIL_HOSTNAME=mail.example.com
EXPECTED_MX=mail.example.com
```

DNS 示例：

```dns
mail.example.com.    A      your.server.ip
example.com.         MX 10  mail.example.com.
```

如果还要支持 `user@random.example.com` 这类子域名邮箱，需要 wildcard MX：

```dns
*.example.com.       MX 10  mail.example.com.
```

MX 不写端口。端口转发只发生在服务器、面板、云防火墙或负载均衡层。

## Web Console

Web Console 面向人工管理，使用 `gptmail_session` Cookie/session。它包含安装、登录、收件箱、域名管理、API Key、API Docs、Webhooks、Share Links、通知公告、用户和管理页。

收件箱、通知和公告会在控制台中实时刷新，适合日常管理和排查。

Web Console 中创建 API Key 后，明文只会显示一次；后续只能看到前缀或重新 reveal。

## API 自动化

API 自动化使用 `X-API-Key` 请求头。当前稳定面向脚本和 AI 的接口主要是：可用域名、生成邮箱、邮箱列表、邮件读取、邮件删除、统计。完整契约以运行中服务导出的文档为准。

完整接口不要复制到 README，请直接查看运行中服务：

- [Markdown API Guide](https://mail.example.com/api/docs.md): `/api/docs.md`
- [OpenAPI JSON](https://mail.example.com/api/openapi.json): `/api/openapi.json`
- [OpenAPI YAML](https://mail.example.com/api/openapi.yaml): `/api/openapi.yaml`

可跑的 curl 示例：

```bash
BASE_URL=https://mail.example.com
API_KEY=key-hloolmail_xxx

curl "$BASE_URL/api/domains/available" \
  -H "X-API-Key: $API_KEY"

curl -X POST "$BASE_URL/api/generate-email" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{"prefix":"demo","domain":"example.com"}'

curl "$BASE_URL/api/emails/next?email=demo@example.com" \
  -H "X-API-Key: $API_KEY"

curl "$BASE_URL/api/emails?email=demo@example.com&page=1&per_page=20" \
  -H "X-API-Key: $API_KEY"
```

`GET /api/emails/next` 会返回下一封未读邮件并自动标记已读，适合验证码轮询。需要不改变已读状态时，使用 `GET /api/emails?email=...&page=1&per_page=20`。

## Webhook

Webhook 用于在新邮件到达后把事件投递到你的系统、队列或自动化流程。创建、启停、测试和查看投递记录推荐在 Web Console 中完成。

当前事件是 `message.received`，范围支持 `all`、`domain`、`mailbox`。投递端点必须是 `https://`，不能指向 localhost、私网地址或云元数据地址。后台 worker 异步投递，失败会按退避策略重试；设置 `WEBHOOKS_ENABLED=false` 可以禁用投递。

已经登录 Web Console 并拿到 session Cookie 时，也可以直接调用管理接口：

```bash
BASE_URL=https://mail.example.com
SESSION_COOKIE=your-gptmail-session-cookie

curl -X POST "$BASE_URL/api/webhooks" \
  -H "Content-Type: application/json" \
  -H "Cookie: gptmail_session=$SESSION_COOKIE" \
  -d '{"name":"automation","url":"https://example.com/hlool/webhook","events":["message.received"],"scope":"all","enabled":true}'
```

Webhook 请求会带上 `X-Hlool-Event`、`X-Hlool-Delivery`、`X-Hlool-Timestamp`、`X-Hlool-Signature`、`X-Hlool-Attempt`，正文包含事件名和经过清洗的邮件 payload。

## Share Link

Share Link 用于把邮箱收件箱安全分享给外部访问者。分享对象是 mailbox，公开读取使用不可猜测 token 和访问 key。

API Key 自动化可以在生成邮箱时同步创建邮箱分享：

```bash
BASE_URL=https://mail.example.com
API_KEY=key-hloolmail_xxx

curl -X POST "$BASE_URL/api/generate-email" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{"prefix":"demo","domain":"example.com","share":true}'
```

响应中的 `data.share.url` 是不带 key 的分享页 URL；`data.share.access_url` 会带上 `?key=...`，可直接访问分享邮箱。完整 token 和 key 只在创建或重新生成时返回一次；后台只保存 hash，不能再次查看旧完整链接，需要再次复制时请重新生成分享链接。

管理接口是 Web Console session-only；公开读取走匿名 token 和 key：

- `GET /api/shared/:token`
- `GET /api/shared/:token/messages`
- `GET /api/shared/:token/messages/:message_id`

公开分享不提供 `POST /api/shared/:token/access` 解锁接口；带 `key` 的只读 GET 路径就是唯一公开读取面。

已经登录 Web Console 并拿到 session Cookie 时，可以创建邮箱分享：

```bash
BASE_URL=https://mail.example.com
SESSION_COOKIE=your-gptmail-session-cookie

curl -X POST "$BASE_URL/api/share-links" \
  -H "Content-Type: application/json" \
  -H "Cookie: gptmail_session=$SESSION_COOKIE" \
  -d '{"resource_type":"mailbox","mailbox_id":45}'
```

公开读取分享邮箱邮件：

```bash
BASE_URL=https://mail.example.com
TOKEN=share-token
KEY=sharekey-hloolmail_xxx

curl "$BASE_URL/api/shared/$TOKEN?key=$KEY"
curl "$BASE_URL/api/shared/$TOKEN/messages?key=$KEY&page=1&per_page=20"
curl "$BASE_URL/api/shared/$TOKEN/messages/msg-uuid?key=$KEY"
```

## 附件策略

附件默认只保存 metadata，不保存附件原始字节。metadata 包含文件名、MIME 类型、Content-ID、Disposition、传输编码、大小、SHA-256、inline 标记和顺序号。

这样做的目标是让邮件内容、Webhook payload、Share Link 页面可以知道“有附件”和附件属性，但避免把大文件或不可信二进制长期落库。附件正文不会混进 `text_content` / `html_content`，HTML 内容仍会经过服务端清洗。

`MAX_ATTACHMENT_BYTES` 控制单个附件的解析上限，默认跟 `MAX_MESSAGE_BYTES` 一致。超限附件会让 SMTP DATA 返回 `552 attachment exceeds size limit`。

## CLI

Release 二进制内置 CLI。默认配置文件在系统用户配置目录的 `hloolmail/config.json`，也可以用环境变量或全局参数覆盖：`HLOOLMAIL_BASE_URL`、`HLOOLMAIL_API_KEY`、`HLOOLMAIL_PROFILE`、`HLOOLMAIL_OUTPUT`、`HLOOLMAIL_TIMEOUT`。

```bash
./hloolmail --help
./hloolmail config set base_url https://mail.example.com
./hloolmail config set api_key key-hloolmail_xxx
./hloolmail domains list
./hloolmail mailbox create --prefix demo --domain example.com
./hloolmail mail next demo@example.com --wait 120s --interval 3s --code-regex "\d{6}" --quiet
./hloolmail mail list demo@example.com --page 1 --per-page 20
./hloolmail openapi json --raw > openapi.json
```

也可以不写入配置，直接用全局参数：

```bash
./hloolmail --base-url https://mail.example.com --api-key key-hloolmail_xxx mailbox create --prefix demo --domain example.com
```

主要命令：

```text
hloolmail                 Start server
hloolmail serve           Start server
hloolmail version
hloolmail config path|get|set|use
hloolmail health
hloolmail openapi json|yaml|markdown|skill
hloolmail domains list
hloolmail mailbox create|list|delete
hloolmail mail next|list|read|mark-read|delete|clear
hloolmail stats
```

## OpenAPI/SDK 状态

`/api/docs.md`、`/api/openapi.json`、`/api/openapi.yaml` 都由同一份 OpenAPI registry 生成，是当前接口的来源。README 只放入口和少量示例，不复制完整 API 文档。

SDK 暂缓。现阶段不承诺官方 SDK 的稳定发布节奏；需要强类型客户端时，请用 `/api/openapi.json` 或 `/api/openapi.yaml` 在自己的项目里生成。后续如果发布官方 SDK，会以 OpenAPI registry 为准，而不是手写一套新接口。

## 生产安全

- 生产环境设置 `DEV_MODE=false`。
- `SESSION_SECRET` 和 `INBOX_TOKEN_SECRET` 必须是两个不同的强随机值；Docker 部署可由 Install Page 自动生成。
- API Key 明文只在创建或 reveal 时返回一次，不要放进 URL、日志或前端代码。
- 默认只从 `X-API-Key` 请求头读取 API Key；不建议生产长期启用 `ALLOW_API_KEY_QUERY_PARAM=true`。
- Web Console、Webhook 目标和公开 Share Link 建议全程 HTTPS。
- Webhook secret 只显示一次，轮换后旧 secret 立刻失效。
- 反向代理需要保留 `Host`、`X-Forwarded-Proto`，否则 Share Link URL 和登录回调可能生成错误地址。
- HTML 邮件详情会经过服务端清洗，并在前端 sandbox iframe 中展示。
- 定期备份 PostgreSQL 或 SQLite 数据；升级前尤其要备份。

## 升级

Docker Compose：

```bash
docker compose pull
docker compose up -d
docker compose logs -f app
```

如果使用本地源码构建镜像：

```bash
docker compose up -d --build
```

PostgreSQL 备份示例，默认库名和账号都是 `hloolmail`：

```bash
docker compose exec postgres pg_dump -U hloolmail hloolmail > hloolmail.sql
```

Release 二进制升级时，先停服务、替换二进制，再启动。程序启动时会执行数据库迁移。

```bash
systemctl stop hloolmail
tar -xzf hloolmail-linux-amd64.tar.gz
install -m 0755 hloolmail-linux-amd64/hloolmail /opt/hloolmail/hloolmail
systemctl start hloolmail
systemctl status hloolmail
```

跨大版本升级前先阅读 Release Note，并确认 `.env` / systemd 环境变量仍然符合当前版本要求。

## 本地开发

后端和完整构建：

```bash
go test ./...
cd web
npm install
npm run build
cd ..
go run ./cmd/server
```

前端开发模式：

```bash
cd web
npm install
npm run dev
```

Vite 会代理 `/api` 到 `http://localhost:3000`。

Install Page 开发者快捷键：在 Install Page 快速点击页面左上角 Logo 图标 3 次（2 秒内），系统会自动以开发模式完成安装：

- 管理员账号：`dev@localhost` / `devdevdev`
- 数据库：SQLite (`storage/hlool-mail.db`)
- `DEV_MODE=true`，`.test` 域名跳过 DNS 验证
- 其他配置使用默认值

安装完成后会自动登录到管理控制台。此功能仅用于本地开发，请勿在生产环境使用。

## Troubleshooting

### PostgreSQL `permission denied for schema public`

如果 Install Page 报错：

```text
数据库迁移失败：当前数据库账号没有 PostgreSQL public schema 的建表/改表权限
```

或原始错误包含：

```text
permission denied for schema public (SQLSTATE 42501)
```

说明数据库连接已经成功，但当前业务账号没有在 `public` schema 里创建数据表的权限。用 PostgreSQL 管理员密码执行一次授权即可。宝塔 PostgreSQL 常见 `psql` 路径是 `/www/server/pgsql/bin/psql`：

```bash
/www/server/pgsql/bin/psql -U postgres -d hlooltest -c 'ALTER DATABASE "hlooltest" OWNER TO "hlooltest"; ALTER SCHEMA public OWNER TO "hlooltest"; GRANT USAGE, CREATE ON SCHEMA public TO "hlooltest";'
```

把命令里的 `hlooltest` 换成你在安装页填写的数据库名和数据库账号。执行成功会看到：

```text
ALTER DATABASE
ALTER SCHEMA
GRANT
```

如果提示 `psql: command not found`，先查找实际路径：

```bash
find / -name psql -type f 2>/dev/null | head
```

### 宝塔 / 25 -> 2525

宝塔面板里直接运行二进制时，程序监听 `:25` 可能会因为系统权限、面板防火墙或端口占用导致无法收信。推荐让程序继续监听 `:2525`：

```bash
export SMTP_ADDR=:2525
```

然后在宝塔面板的防火墙 / 端口转发里，把公网 TCP `25` 转发到本机 `2525`。DNS 的 MX 仍然指向你的收信主机名，例如 `hlool.00a.chat`，不要把 MX 写成端口。

### API 401 或收不到邮件

- API 自动化必须带 `X-API-Key`，不要用 Web Console Cookie 代替。
- Webhook 和 Share Link 管理必须是 Web Console session；API Key 只能在 `generate-email` 时创建邮箱分享，不能管理分享链接。
- 私有域名要先在 Web Console 添加并完成 MX 验证，再用 API 生成该域名邮箱。
- 如果目标网站拦截临时邮箱域名，换公共域名或使用自己的私有域名。
- 公网收不到邮件时，先检查 DNS MX、云厂商入站 TCP 25、服务器防火墙、Compose `SMTP_PORT` 或 25 -> 2525 转发。
