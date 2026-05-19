<p align="center">
  <img src="web/public/brand-logo.svg" width="96" height="96" alt="HLOOL Mail logo">
</p>

<h1 align="center">HLOOL Mail</h1>

<p align="center">
  自托管临时邮箱与私有域名收信平台，内置 SMTP catch-all、Web 控制台、API Key 和自动化友好的收件接口。
</p>

<p align="center">
  <a href="#release-下载包">Release 下载包</a> ·
  <a href="#docker-compose--postgresql-推荐">Docker Compose</a> ·
  <a href="#安装向导-install-page">Install 页面</a> ·
  <a href="#dns--mx">DNS / MX</a>
</p>

<p align="center">
  <a href="https://linux.do">学 AI 上 L 站</a>
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

## Release 下载包

GitHub Release 会把前端静态资源内嵌进后端二进制。下载后不需要再单独构建或携带 `web/dist`，程序会直接托管 Web 控制台。

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

### 自定义前端

高级用户可以用外部目录覆盖内置前端。把 `FRONTEND_DIST` 指向一个包含 `index.html` 和 `assets/` 的前端构建目录即可，例如：

```bash
cd web
npm install
npm run build
cd ..

export FRONTEND_DIST=web/dist
./hloolmail
```

如果 `FRONTEND_DIST` 不存在或目录里没有 `index.html`，程序会自动回退到内置前端。Docker 部署也可以挂载自定义前端目录，并把 `FRONTEND_DIST` 设置为容器内路径。

### 宝塔二进制部署注意

宝塔面板里直接运行二进制时，程序监听 `:25` 可能会因为系统权限、面板防火墙或端口占用导致无法收信。推荐做法是让程序继续监听 `:2525`：

```bash
export SMTP_ADDR=:2525
```

然后在宝塔面板的防火墙 / 端口转发里，把公网 TCP `25` 转发到本机 `2525`。DNS 的 MX 仍然指向你的收信主机名，例如 `hlool.00a.chat`，不要把 MX 写成端口。

首次打开 `http://服务器IP:3000` 或你的域名后，如果还没有管理员账号，会自动进入 Install 页面。

只把 `web/dist` 当成纯静态前端单独部署不是推荐模式，因为前端默认调用同源 `/api`。如果确实要分离部署，需要在前端域名上反向代理 `/api` 到 HLOOL Mail 后端，并处理 Cookie、CORS 和 HTTPS。

## Docker Compose + PostgreSQL 推荐

Docker 编排默认启动两个核心服务：`app` 和 `postgres`。应用通过 `DATABASE_DRIVER=postgres` 直接使用 PostgreSQL，不走 SQLite。

```bash
cp .env.compose.example .env
nano .env
docker compose up -d --build
```

至少修改这些值：

```env
PUBLIC_BASE_URL=https://mail.example.com
MAIL_HOSTNAME=mail.example.com
EXPECTED_MX=mail.example.com
POSTGRES_PASSWORD=replace-with-a-strong-postgres-password
DEV_MODE=false
```

`SESSION_SECRET` 和 `INBOX_TOKEN_SECRET` 可以留空，让 Install 页面自动生成并保存到 `/app/storage/.env`；也可以提前填入两个不同的强随机值。

本地测试可以保留 `SMTP_PORT=2525`。真实接收互联网邮件时，外部邮件服务器通常连接 TCP 25；如果服务器和云厂商允许，把 `.env` 里的 `SMTP_PORT` 改成 `25`，或在负载均衡/端口转发层把公网 25 转到容器的 2525。

使用已经发布的 GHCR 镜像：

```bash
docker compose pull
docker compose up -d
```

镜像标签：

```text
ghcr.io/hloolx/hloolmail:latest
ghcr.io/hloolx/hloolmail:v0.1.1
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

## 常见安装问题

### PostgreSQL `permission denied for schema public`

如果 Install 页面报错：

```text
数据库迁移失败：当前数据库账号没有 PostgreSQL public schema 的建表/改表权限
```

或原始错误包含：

```text
permission denied for schema public (SQLSTATE 42501)
```

这说明数据库连接已经成功，但当前业务账号没有在 `public` schema 里创建数据表的权限。用 PostgreSQL 管理员密码执行一次授权即可。宝塔 PostgreSQL 常见 `psql` 路径是 `/www/server/pgsql/bin/psql`：

```bash
/www/server/pgsql/bin/psql -U postgres -d hlooltest -c 'ALTER DATABASE "hlooltest" OWNER TO "hlooltest"; ALTER SCHEMA public OWNER TO "hlooltest"; GRANT USAGE, CREATE ON SCHEMA public TO "hlooltest";'
```

把命令里的 `hlooltest` 换成你在安装页填写的数据库名和数据库账号。如果库名和账号相同，只改一处名字即可。执行成功会看到：

```text
ALTER DATABASE
ALTER SCHEMA
GRANT
```

如果提示 `psql: command not found`，先查找实际路径：

```bash
find / -name psql -type f 2>/dev/null | head
```

## 安装向导 Install Page

Install 页面是否生效，取决于部署方式：

| 部署方式 | Install 页面行为 |
| --- | --- |
| Docker Compose | 生效，用于创建管理员账号，并可自动生成 `SESSION_SECRET` / `INBOX_TOKEN_SECRET`。数据库、端口、站点 URL、MX 主机等运行时配置会被锁定，必须通过 `.env` / Compose 修改后重启。 |
| Docker 单容器 | 同 Compose。容器环境会自动锁定运行时配置，避免页面里写入的配置和容器环境变量打架。 |
| Release 二进制包 | 生效，可创建管理员，也可以把配置写入 `.env` 或 `CONFIG_ENV_PATH` 指定的文件。若在页面里切换数据库或数据库地址，可能需要重启程序。 |
| 本地开发 | 生效，适合快速体验 SQLite 或本地 PostgreSQL。 |

代码里已经有容器检测和配置锁定逻辑：容器内默认 `config_locked=true`，Install 页面会禁用数据库、端口、URL 等字段；后端也会在提交安装时保留容器环境变量里的运行时配置。

如果你确实希望 Docker 内的 Install 页面也能改数据库/端口等配置，可以设置：

```env
HLOOLMAIL_CONFIG_LOCKED=false
```

不建议生产环境这样做。生产环境更稳的方式是：运行时配置放在 `.env` / Compose，Install 页面只负责首次管理员和密钥初始化。

## systemd 示例

Release 二进制包可以用 systemd 管理：

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

## 本地开发

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

## 安全提示

- 生产环境必须设置 `DEV_MODE=false`。
- `SESSION_SECRET` 和 `INBOX_TOKEN_SECRET` 必须是两个不同的强随机值；Docker 部署也可以在 Install 页面自动生成。
- API Key 明文只在创建或重新展示时返回一次，不要放进 URL、日志或前端代码。
- 默认只从 `X-API-Key` 请求头读取 API Key；不建议在生产长期启用 `ALLOW_API_KEY_QUERY_PARAM=true`。
- HTML 邮件详情会经过服务端清洗，并在前端 sandbox iframe 中展示。
