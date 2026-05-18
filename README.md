<p align="center">
  <img src="web/public/brand-logo.svg" width="96" height="96" alt="HLOOL Mail logo">
</p>

<h1 align="center">HLOOL Mail</h1>

<p align="center">
  自托管临时邮箱与私有域名收信平台，内置 SMTP catch-all、Web 控制台、API Key 和自动化友好的收件接口。
</p>

<p align="center">
  <a href="#docker-compose--postgresql-推荐">Docker Compose</a> ·
  <a href="#二进制部署">二进制部署</a> ·
  <a href="#github-actions-自动发布">自动发布</a> ·
  <a href="#dns--mx">DNS / MX</a>
</p>

## 项目作用

HLOOL Mail 用来搭建一个属于自己的临时邮箱服务。它可以接收公网邮件，为用户生成随机邮箱地址，也可以绑定自己的域名，让脚本、测试平台或 AI 助手通过 API 创建邮箱、等待验证码邮件、读取收件箱内容。

它不是传统 IMAP/POP3 邮箱，也不负责外发邮件；它的核心目标是稳定接收、归属隔离、自动化读取和便捷管理。

## 功能亮点

- SMTP catch-all 收信服务，开发默认监听 `:2525`，生产可映射到公网 TCP 25。
- 公共域名池和私有域名管理，支持根域邮箱与 wildcard 子域邮箱。
- React + TypeScript Web 控制台，包含安装向导、邮箱、域名、用户、API Key、OAuth 和 API 文档页面。
- API Key 使用 hash 存储，支持每日额度、总额度、启停、过期时间和使用统计。
- 邮件 MIME 解析、HTML 安全清洗、收件箱 SSE 推送、过期清理、MX 健康检查。
- 支持 SQLite 快速体验，也支持 PostgreSQL 生产部署；Docker Compose 默认使用 PostgreSQL。

## 架构

```mermaid
flowchart LR
  Internet["Internet mail sender"] --> MX["DNS MX"]
  MX --> SMTP["HLOOL Mail SMTP"]
  SMTP --> DB[("PostgreSQL / SQLite")]
  Web["Web console"] --> API["HTTP API"]
  Agent["Scripts / AI agents"] --> API
  API --> DB
  API --> SSE["Inbox stream"]
```

## Docker Compose + PostgreSQL 推荐

Docker 编排默认启动两个核心服务：`app` 和 `postgres`。应用通过 `DATABASE_DRIVER=postgres` 直接使用 PostgreSQL，不走 SQLite。

```powershell
Copy-Item .env.compose.example .env
notepad .env
docker compose up -d --build
```

至少修改这些值：

```env
PUBLIC_BASE_URL=https://mail.example.com
MAIL_HOSTNAME=mail.example.com
EXPECTED_MX=mail.example.com
POSTGRES_PASSWORD=replace-with-a-strong-postgres-password
SESSION_SECRET=replace-with-a-long-random-session-secret
INBOX_TOKEN_SECRET=replace-with-a-different-long-random-inbox-secret
DEV_MODE=false
```

本地测试可以保留 `SMTP_PORT=2525`。真实接收互联网邮件时，外部邮件服务器通常连接 TCP 25；如果服务器和云厂商允许，把 `.env` 里的 `SMTP_PORT` 改成 `25`，或在负载均衡/端口转发层把公网 25 转到容器的 2525。

使用已经发布的 GHCR 镜像时：

```powershell
docker compose pull
docker compose up -d
```

如果本地 Docker 构建时访问 Go 或 npm 官方源较慢，可以在 `.env` 里调整：

```env
GOPROXY=https://goproxy.cn,direct
NPM_CONFIG_REGISTRY=https://registry.npmmirror.com/
```

使用外部托管 PostgreSQL 时，把 `.env` 的 `DATABASE_URL` 改成外部连接串：

```env
DATABASE_URL=postgres://user:password@db.example.com:5432/hloolmail?sslmode=require
```

## 二进制部署

GitHub Release 会自动打包可执行文件和 `web/dist` 静态资源。下载对应系统的压缩包后，进入解压目录运行：

```powershell
$env:HTTP_ADDR=":3000"
$env:SMTP_ADDR=":2525"
$env:FRONTEND_DIST="web/dist"
$env:DATABASE_DRIVER="postgres"
$env:DATABASE_URL="postgres://user:password@127.0.0.1:5432/hloolmail?sslmode=disable"
$env:PUBLIC_BASE_URL="https://mail.example.com"
$env:MAIL_HOSTNAME="mail.example.com"
$env:EXPECTED_MX="mail.example.com"
$env:DEV_MODE="false"
$env:SESSION_SECRET="replace-with-a-long-random-session-secret"
$env:INBOX_TOKEN_SECRET="replace-with-a-different-long-random-inbox-secret"
.\hloolmail.exe
```

从源码本地打包：

```powershell
Set-Location web
npm install
npm run build
Set-Location ..
go build -trimpath -ldflags="-s -w" -o build/hloolmail.exe ./cmd/server
```

Linux/macOS 只需要把输出文件名改成 `build/hloolmail`。

## 本地开发

```powershell
go test ./...
Set-Location web
npm install
npm run build
Set-Location ..
go run ./cmd/server
```

打开 [http://localhost:3000](http://localhost:3000)。首次启动如果还没有管理员用户，Web 会进入安装向导。

前端开发模式：

```powershell
Set-Location web
npm run dev
```

Vite 会代理 `/api` 到 `http://localhost:3000`。

## DNS / MX

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

## API 示例

自动化调用使用 `X-API-Key`：

```bash
curl http://localhost:3000/api/domains/available \
  -H 'X-API-Key: YOUR_KEY'

curl -X POST http://localhost:3000/api/generate-email \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: YOUR_KEY' \
  -d '{"prefix":"demo","domain":"example.com"}'

curl 'http://localhost:3000/api/emails?email=demo@example.com' \
  -H 'X-API-Key: YOUR_KEY'
```

完整接口文档可通过运行中的服务查看：

```text
https://mail.example.com/api/docs.md
```

## GitHub Actions 自动发布

仓库内置两条自动化流水线：

- `Publish Docker image`：推送到 `main` 或打 `v*` 标签时，自动构建多架构镜像并推送到 `ghcr.io/hloolx/hloolmail`。
- `Release binaries`：推送 `v*` 标签时，自动构建 Linux、macOS、Windows 二进制包，并发布到 GitHub Releases。

发布版本示例：

```powershell
git tag v0.1.0
git push origin v0.1.0
```

## 上传前检查

仓库默认忽略以下内容，避免把本机数据和敏感内容上传到 GitHub：

- `.env`、`.env.*` 本地配置和密钥文件。
- `storage/`、`*.db`、`*.sqlite` 数据库文件。
- `web/node_modules/`、`web/dist/`、`build/`、`release/` 构建产物。
- `test-results/`、`.playwright-cli/`、日志和本地二进制。
- 内部实现 prompt、审计草稿和临时规划文档。

`.env.example` 和 `.env.compose.example` 会保留在仓库中，作为部署模板。

## 安全提示

- 生产环境必须设置 `DEV_MODE=false`，并使用强随机 `SESSION_SECRET` 和 `INBOX_TOKEN_SECRET`。
- `SESSION_SECRET` 和 `INBOX_TOKEN_SECRET` 必须不同。
- API Key 明文只在创建或重新展示时返回一次，不要放进 URL、日志或前端代码。
- 默认只从 `X-API-Key` 请求头读取 API Key；不建议在生产长期启用 `ALLOW_API_KEY_QUERY_PARAM=true`。
- HTML 邮件详情会经过服务端清洗，并在前端 sandbox iframe 中展示。
