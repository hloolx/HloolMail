# 搜索引擎与 Safe Browsing 风险控制

HLOOL Mail 是邮件收信、测试和自动化处理平台，公网部署后会暴露登录页、公开 API 文档、分享链接和由用户生成的收信地址。新域名、刚迁移的旧域名、曾被滥用的公共域名，都不建议一上线就让搜索引擎完整抓取。部署策略应该先保护控制台、分享页和带密钥 URL，再在域名信誉稳定后只开放公开首页和文档。

## 推荐默认值

生产环境的保守默认值：

```env
PUBLIC_INDEXING=landing
DEV_MODE=false
ALLOW_API_KEY_QUERY_PARAM=false
PUBLIC_BASE_URL=https://mail.example.com
```

`PUBLIC_INDEXING=landing` 表示只让公开首页参与抓取，API 文档、控制台、分享页和 API 路径继续保持 `noindex` 或禁止抓取。这是普通生产部署的推荐默认值。

如果处于高风险或恢复期，改成：

```env
PUBLIC_INDEXING=none
```

`PUBLIC_INDEXING=none` 适合以下场景：

- 新部署、新域名、刚切换 DNS 或刚开放公网访问。
- 域名曾被 Chrome、Google Search、Safe Browsing 或广告平台标记。
- 公开域名池、分享链接、API 文档仍在调整访问边界。
- 还没有在 Google Search Console 中完成站点验证和安全监控。

只有在域名信誉恢复、Search Console 没有安全问题、Safe Browsing Site Status 显示正常，并且你明确希望公开文档可被搜索时，才把它改成：

```env
PUBLIC_INDEXING=docs
```

即使使用 `PUBLIC_INDEXING=docs`，也只应该开放公开首页和公开文档；登录、安装、后台、分享页、带 `key` 或 `api_key` 的 URL、用户数据 API 仍必须保持 `noindex` 或禁止抓取。

## 三层控制

### `PUBLIC_INDEXING`

`PUBLIC_INDEXING` 是部署侧总开关。推荐语义是：

| 值 | 用途 | 预期行为 |
| --- | --- | --- |
| `none` | 新域名强保护、被标记后的恢复期 | sitemap 为空；除 `/robots.txt`、`/sitemap.xml`、静态资源外，公开首页、文档和敏感路径都会发送 `X-Robots-Tag: noindex, nofollow, noarchive`。 |
| `landing` | 推荐默认值 | sitemap 只包含首页；首页不带 `noindex`，API 文档和控制台/分享/API 路径继续 `noindex`。 |
| `docs` | 信誉恢复后开放文档 | sitemap 包含首页、`/api/docs.md`、`/api/skill.md`、OpenAPI JSON/YAML、`/api/version` 和 `/api/health`；敏感路径继续 `noindex`。 |

当前实现会把未知值归一化为 `landing`，因此不要写 `PUBLIC_INDEXING=false` 或 `PUBLIC_INDEXING=true`。部署时请显式使用 `none`、`landing` 或 `docs`。

当前 `docker-compose.yml` 已在 `app.environment` 中透传该变量。部署时不要只改示例文件，应该从 `.env.compose.example` 复制到实际 `.env`，或在容器运行环境中显式设置 `PUBLIC_INDEXING`。

### `robots.txt`

`robots.txt` 用来告诉爬虫哪些路径不要抓取，主要是控制抓取流量和避免无意义路径被访问。它不是访问控制，也不是彻底移除搜索结果的机制。Google 官方说明中也强调，若页面仅被 `robots.txt` 阻止，URL 仍可能因为外链而出现在搜索结果里。

HLOOL Mail 会根据 `PUBLIC_INDEXING` 动态生成 `robots.txt`：

- `none`：默认阻止全站抓取，只放行 `/robots.txt`、`/sitemap.xml` 和静态资源入口。
- `landing`：阻止 `/api/`、分享页、登录/注册/安装/控制台等 SPA 路径，以及带 `key` 或 `api_key` 的 query；sitemap 只提交首页。
- `docs`：仍阻止 `/api/` 的默认抓取，但显式放行 `/api/health`、`/api/version`、`/api/docs.md`、`/api/skill.md`、`/api/openapi.json` 和 `/api/openapi.yaml`；敏感 SPA 路径继续阻止。

`robots.txt` 要能从站点根路径访问，例如 `https://mail.example.com/robots.txt`。它只对同一协议、主机和端口生效；如果你同时暴露 `mail.example.com` 和 `www.mail.example.com`，需要分别确认。

### `X-Robots-Tag`

`X-Robots-Tag` 是 HTTP 响应头，用来在具体 URL 上声明索引规则。HLOOL Mail 对敏感路径推荐使用：

```http
X-Robots-Tag: noindex, nofollow, noarchive
```

含义：

- `noindex`：不要把该 URL 展示在搜索结果里。
- `nofollow`：不要跟随页面里的链接继续发现内容。
- `noarchive`：不要展示缓存副本。

需要注意：搜索引擎必须能访问到页面，才看得到 `X-Robots-Tag`。如果某个已经被索引的 URL 只靠 `robots.txt` 阻止抓取，爬虫可能看不到新的 `noindex` 头。恢复期如果要从搜索结果移除某批 URL，应优先让这些 URL 返回 `404`、`410`、登录保护，或可访问但带 `X-Robots-Tag: noindex` 的响应，再用 Search Console 检查实时抓取结果。

## 部署步骤

### Docker Compose

1. 从示例复制配置：

```bash
cp .env.compose.example .env
```

2. 新部署保持：

```env
PUBLIC_INDEXING=landing
DEV_MODE=false
ALLOW_API_KEY_QUERY_PARAM=false
```

3. 确认 Compose 会把变量传给 `app` 服务。当前项目约定应在 `docker-compose.yml` 的 `app.environment` 中包含：

```yaml
PUBLIC_INDEXING: "${PUBLIC_INDEXING:-landing}"
```

4. 重启应用：

```bash
docker compose up -d app
```

### Release 二进制或 systemd

在 shell、`.env` 或 systemd unit 中设置：

```ini
Environment=PUBLIC_INDEXING=landing
Environment=DEV_MODE=false
Environment=ALLOW_API_KEY_QUERY_PARAM=false
Environment=PUBLIC_BASE_URL=https://mail.example.com
```

然后重启服务：

```bash
systemctl restart hloolmail
```

### 反向代理

反向代理不要覆盖应用返回的 `X-Robots-Tag`，也不要长期缓存 `/robots.txt` 和 `/sitemap.xml`。切换 `PUBLIC_INDEXING` 后，建议清理 CDN 或代理缓存，并确认代理保留：

```text
Host
X-Forwarded-Proto
```

否则 sitemap、分享链接和登录回调可能生成错误域名或协议。

## 验证命令

设置 `BASE_URL`：

```bash
BASE_URL=https://mail.example.com
```

检查 `robots.txt`：

```bash
curl -fsS "$BASE_URL/robots.txt"
```

检查敏感路径必须有 `X-Robots-Tag`：

```bash
curl -fsSI "$BASE_URL/login" | grep -i '^X-Robots-Tag:'
curl -fsSI "$BASE_URL/share/example-token" | grep -i '^X-Robots-Tag:'
curl -fsSI "$BASE_URL/api/shared/example-token?key=example" | grep -i '^X-Robots-Tag:'
```

在 `PUBLIC_INDEXING=none` 时，公开首页和文档都不应主动进入索引。确认 sitemap 不提交 URL，并且公开文档带 `noindex`：

```bash
curl -fsS "$BASE_URL/sitemap.xml"
curl -fsSI "$BASE_URL/api/docs.md" | grep -i '^X-Robots-Tag:'
```

在 `PUBLIC_INDEXING=landing` 时，确认 sitemap 只包含首页，`/api/docs.md` 仍带 `noindex`。

在 `PUBLIC_INDEXING=docs` 且信誉恢复后，确认公开文档可被抓取：

```bash
curl -fsSI "$BASE_URL/api/docs.md"
curl -fsS "$BASE_URL/sitemap.xml"
```

预期结果：

- `/api/docs.md` 不再带 `noindex`。
- `/sitemap.xml` 包含站点首页、`/api/docs.md` 和机器可读 API 文档入口。
- `/login`、`/dashboard`、`/share/...`、`/api/shared/...` 仍带 `X-Robots-Tag: noindex, nofollow, noarchive`。

## 被 Chrome 或 Safe Browsing 标记后的处理

1. 先止血：把 `PUBLIC_INDEXING=none`，重启服务，清理 CDN 缓存，暂停新增公开域名、公开分享链接和可疑用户的 API Key。
2. 在 Google Search Console 验证站点所有权，查看 Security Issues report 的样例 URL。Chrome 的 Safe Browsing 告警可能受上下文影响，不一定每次都能在本地复现，处理时以 Search Console 的安全问题报告为准。
3. 用 Safe Browsing Site Status 检查根域、业务子域和样例 URL，记录当前状态。
4. 排查根因：
   - 是否有公开分享链接泄露了验证码、登录链接或第三方品牌页面。
   - 是否有用户生成内容、邮件 HTML、附件链接或跳转被识别为恶意、钓鱼或社工内容。
   - 是否有 `?key=`、`?api_key=` URL 被外链、日志页面、监控面板或文档暴露。
   - 是否有开放下载、混合内容、错误 HTTPS、异常重定向或仿冒品牌文案。
   - 是否有公共域名被滥用，需要停用、转私有或下线。
5. 修复后验证：
   - 可疑 URL 返回 `404`、`410`、登录保护，或带 `X-Robots-Tag: noindex, nofollow, noarchive`。
   - `robots.txt` 继续阻止敏感路径和带 key 的 query。
   - Search Console URL Inspection 的实时测试能看到修复后的响应。
6. 在 Security Issues report 中提交 Request Review。说明要包含：发现的问题、采取的修复步骤、修复后的验证结果。不要在上一个审核还没结束时重复提交。
7. 等待审核结果。Google 官方说明中，安全问题复审可能需要数天到数周。期间继续保持 `PUBLIC_INDEXING=none`，不要重新开放 docs。

如果你确认是误判，仍应先完成上面的证据收集和响应头检查，再通过 Search Console 或 Safe Browsing 相关入口提交误判反馈。误判申诉也需要清楚说明为什么页面不是钓鱼、恶意软件、误导下载或社工内容。

## 恢复信誉后开放 docs

满足以下条件再开放：

- Search Console 的 Security Issues report 没有未解决问题。
- Safe Browsing Site Status 对根域和业务域显示无危险内容。
- 最近一段时间没有新的公开分享泄露、异常使用、异常跳转或恶意附件告警。
- `/login`、`/dashboard`、`/share/`、`/api/shared/` 和带 key 的 URL 仍然保持 noindex 或不可公开访问。

开放步骤：

```bash
PUBLIC_INDEXING=docs
docker compose up -d app
```

或 systemd：

```bash
systemctl restart hloolmail
```

然后验证：

```bash
curl -fsSI "$BASE_URL/api/docs.md"
curl -fsS "$BASE_URL/sitemap.xml"
curl -fsSI "$BASE_URL/login" | grep -i '^X-Robots-Tag:'
```

开放 docs 不等于开放控制台或分享内容。`docs` 模式会开放首页、Markdown API 文档、Skill 文档、OpenAPI JSON/YAML、`/api/version` 和 `/api/health`，方便开发者和 AI 工具读取；分享链接、控制台和用户数据 API 仍必须保持 `noindex` 或禁止抓取。

如果 Search Console 仍显示文档被 `noindex` 排除，用 URL Inspection 的 live test 检查 Googlebot 实际收到的 header。确认没有 `noindex` 后，再请求重新抓取；索引状态更新可能滞后。

## 官方参考

- [Google Search Central: Introduction to robots.txt](https://developers.google.com/search/docs/crawling-indexing/robots/intro)
- [Google Search Central: Block Search indexing with noindex](https://developers.google.com/search/docs/crawling-indexing/block-indexing)
- [Google Search Central: Robots meta tag and X-Robots-Tag specifications](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag)
- [Google Safe Browsing](https://safebrowsing.google.com/)
- [Search Console Help: Security issues report](https://support.google.com/webmasters/answer/9044101)
