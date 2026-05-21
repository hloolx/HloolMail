# React/Vite 前端控制台审查报告

审查范围：`web/src/api.ts`、`web/src/App.tsx`、`store`、`hooks`、`lib`、`pages`、`components`、`styles` 中登录、安装、收件箱、域名、API Key、Webhook、共享链接、用户管理、通知、API 文档相关实现。

已知前提：`npm run build` 已通过。本报告只列能从代码证据推出的问题。

## 高风险

### 1. 公告 Markdown 可被做成存储型 XSS

- 位置：
  - `web/src/lib/markdown.ts:54-58`
  - `web/src/components/layout/NotificationBell.tsx:278-280`
  - `web/src/pages/AnnouncementsPage.tsx:153-158`
- 问题说明：
  - `simpleMarkdownToHTML` 先转义了 `< > &`，但随后又用字符串拼接生成 `<img src="$2">` 和 `<a href="$2">`，没有转义 `$1/$2`，也没有过滤 `javascript:`、事件属性、引号等危险内容。
  - 生成后的 HTML 在公告预览和通知弹层里通过 `dangerouslySetInnerHTML` 直接插入页面。
  - 例如 Markdown 图片地址或链接地址里带双引号时，可以跳出属性，拼出 `onerror`/`onclick` 这类事件属性。
- 为什么影响用户：
  - 公告是面向用户展示的内容。如果管理员账号被盗，或后端已有脏公告数据，普通用户打开通知或管理员预览时，攻击脚本会在控制台同源页面运行。
  - 同源脚本可以直接调用当前登录态可访问的 API，风险不只是弹窗，而是可能读写收件箱、API key、用户管理等数据。
- 建议修复方向：
  - 不要手写 Markdown 到 HTML 的字符串替换。使用成熟 Markdown 渲染器加 DOMPurify 之类白名单清洗。
  - 至少要对链接/图片属性做 HTML 属性转义，禁止 `javascript:`、`data:` 等危险协议，图片也要禁止事件属性。
  - 公告内容如果不是必须支持 HTML，优先渲染为 React 节点或纯文本。

### 2. API Explorer 会把完整 API Key 持久化到 localStorage

- 位置：
  - `web/src/pages/APIDocsPage.tsx:303-310`
  - `web/src/hooks/useRequestHistory.ts:18,41-43`
  - `web/src/pages/APIDocsPage.tsx:217-229`
- 问题说明：
  - API Explorer 调用接口后，`addEntry` 把 `apiKey: apiKey.trim()` 写入历史。
  - `useRequestHistory` 使用固定 key `hlool_api_explorer_history` 存到 `localStorage`。
  - 恢复历史时又会把历史里的 `entry.apiKey` 填回输入框。
- 为什么影响用户：
  - localStorage 是长期保存的，退出登录也不会自动清除这份历史。
  - 共享电脑、浏览器备份、恶意扩展或任意前端 XSS 都能读到完整 API Key。
  - 项目在 `store.ts` 里已经有清理旧版本地 API key 的逻辑，但 API Explorer 这条新路径又把明文密钥存回去了。
- 建议修复方向：
  - 历史记录不要保存完整 API Key，只保存“是否使用过 key”或前缀。
  - 恢复历史时让用户重新选择/粘贴密钥。
  - 登出时清理 `hlool_api_explorer_history` 中的敏感字段，最好做一次迁移清洗。

## 中风险

### 3. 首次安装表单把管理员密码和数据库密码写入 sessionStorage

- 位置：
  - `web/src/pages/InstallPage.tsx:15-35`
  - `web/src/pages/InstallPage.tsx:55-69`
- 问题说明：
  - `InstallForm` 包含 `admin_password`、`database_password`、`database_url` 等敏感字段。
  - 表单每次变化都会 `sessionStorage.setItem(INSTALL_FORM_KEY, JSON.stringify(form))`。
- 为什么影响用户：
  - 首次安装阶段最敏感的数据会留在浏览器标签页存储里。只要同源页面出现 XSS、浏览器扩展读取页面存储，或用户在共享机器上恢复标签页，就可能泄露管理员初始密码和数据库连接信息。
- 建议修复方向：
  - sessionStorage 只保存非敏感配置，例如主机名、端口、域名。
  - 密码类字段只放 React state，刷新后让用户重新输入。
  - 安装成功、安装失败、离开页面时都清理已有敏感暂存。

### 4. API Explorer 可把用户填写或选择的 API Key 发到任意 API Base

- 位置：
  - `web/src/pages/APIDocsPage.tsx:116-118`
  - `web/src/pages/APIDocsPage.tsx:246-283`
  - `web/src/pages/APIDocsPage.tsx:348-355`
- 问题说明：
  - `apiBase` 是用户可编辑输入框。
  - 发送请求时用 `fetch(url.href, credentials: 'omit')`，但仍会在 API Key 接口上设置 `X-API-Key`。
  - 没有同源限制，也没有跨域发送密钥前的强确认。
- 为什么影响用户：
  - 用户如果被诱导把 API Base 改成攻击者域名，再选择已有密钥，前端会把完整 `X-API-Key` 直接发给外站。
  - `credentials: 'omit'` 只是不带 Cookie，不能保护 header 里的 API Key。
- 建议修复方向：
  - 默认只允许同源或安装配置里的可信 base URL。
  - 跨源调用时弹出明显确认，确认文案要说明会发送 `X-API-Key`。
  - 对“选择已有密钥”模式，跨源时应禁止自动 reveal/发送完整 key。

### 5. 邮件 HTML 原样放进 iframe，缺少资源/CSP 限制

- 位置：
  - `web/src/lib/emailHtml.ts:61-72`
  - `web/src/pages/MessageDrawer.tsx:53-58`
  - `web/src/pages/SharedMessagePage.tsx:267-272`
- 问题说明：
  - `buildEmailSrcDoc` 把邮件 `html_content` 原样拼到 `srcDoc`。
  - iframe 只设置了 `sandbox="allow-downloads"`，没有 CSP，也没有清洗远程图片、CSS、表单样式等 HTML 内容。
  - 收件箱详情还会把 API Key 拼到邮件内 `/api/...` 链接查询参数里。
- 为什么影响用户：
  - sandbox 能挡住脚本执行，但邮件 HTML 仍可加载远程图片等资源，暴露用户打开邮件的时间、IP、User-Agent。
  - 恶意邮件可以伪装成控制台 UI 或登录提示，诱导用户点击。
  - 带 `api_key` 的链接一旦被复制、截图或误点，密钥更容易出现在 URL、日志或历史里。
- 建议修复方向：
  - 给 `srcDoc` 加严格 CSP，例如默认禁止外部资源，只允许必要的 `data:`/`blob:` 图片。
  - 对邮件 HTML 做清洗，移除脚本、表单、事件属性、外链追踪资源。
  - 附件/API 下载不要通过 URL 查询参数传 API Key，改用受控按钮或后端短期下载 token。

### 6. Webhook 的 domain/mailbox 范围 ID 没有前端数值校验

- 位置：
  - `web/src/pages/WebhooksPage.tsx:262-272`
  - `web/src/pages/WebhooksPage.tsx:379-387`
- 问题说明：
  - 输入框只设置了 `inputMode="numeric"`，实际仍是普通文本框。
  - `formPayload` 直接 `Number(form.domainId)` / `Number(form.mailboxId)`。
  - 如果输入空格、`abc`、`1.5`，会变成 `NaN` 或非整数；`JSON.stringify` 发送时 `NaN` 会变成 `null`。
- 为什么影响用户：
  - 用户看起来已经填写了必填项，但后端可能收到 `null` 或非法 ID，报错会比较难懂。
  - 如果后端把缺失 ID 当成全局范围或默认范围处理，还可能造成 Webhook 作用范围误判。
- 建议修复方向：
  - 输入框改成 `type="number" min="1" step="1"`，提交前用 `Number.isSafeInteger(id) && id > 0` 校验。
  - 非法时在表单内提示，不要发请求。
  - 后端仍需保留强校验，前端只是减少误操作。

## 低风险 / 测试缺口

### 7. 前端缺少安全与状态流测试，当前只能靠 build 兜底

- 位置：
  - `web/package.json:6-9`
  - 全仓搜索未发现前端 `test/spec`、`vitest`、`@testing-library`、Playwright 测试代码；`output/playwright/*.png` 只是截图产物。
- 问题说明：
  - `web/package.json` 只有 `dev/build/preview`，没有前端测试脚本。
  - 这次发现的 Markdown XSS、API Key 历史、安装表单敏感暂存、Webhook ID 转换，都不是 TypeScript build 能发现的问题。
- 为什么影响用户：
  - 后续改动很容易再次把密钥写入本地存储，或把未清洗 HTML 放进页面，构建依然会通过。
- 建议修复方向：
  - 增加少量高价值测试：Markdown 渲染不得产生事件属性/危险协议、API Explorer 历史不得保存完整 key、InstallPage 暂存不得包含密码字段、Webhook 表单非法 ID 不发请求。
  - 移动端收件箱/共享链接空状态可用 Playwright 做一条 smoke test，防止三栏/钻取状态回归。
