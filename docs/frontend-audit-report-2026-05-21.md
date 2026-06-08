# HLOOL Mail 前端专项审查报告

日期：2026-05-21
范围：`web/src` 前端代码、主要页面、共享组件、样式、构建产物
目标读者：非前端开发也能看懂，方便按优先级安排后续工作

## 一句话结论

这次前端整体不是“不能用”，而是存在几类会慢慢放大维护成本和用户风险的问题：弹窗重复造轮子、移动端和表格体验不够稳、部分动效没有照顾低动效用户、少数安全细节会把密钥或密码留在浏览器里。

本轮已经把最值得立刻处理的一批问题落地修了：敏感信息不再写进请求历史和安装表单缓存；主要弹窗统一成共享外壳；移动端触摸区、宽表格、弹窗底部按钮做了适配；动效支持“减少动态效果”；删除动画改成接口成功后再播放；构建已通过。

## 本次怎么审的

我把前端拆成 4 个方向让子代理并行复查，然后本地再做一次总审和补修：

1. 安全和数据：API Key、安装密码、开发快捷入口、请求历史。
2. 组件复用：弹窗、确认框、表格、表单弹层。
3. 多设备适配：手机、平板、宽表格、触摸目标、弹窗高度。
4. 动效和可访问性：键盘操作、焦点、减少动态效果、加载态。

额外本地补查了：删除动画时机、分页越界、通行密钥开关失败回滚、API 文档调试器跨站发送密钥、非 JSON 错误提示、动效依赖分包。

## 已处理的问题

### 1. API Key 不再写入浏览器请求历史

之前的问题：API Docs 的请求历史会把完整 API Key 存进 `localStorage`。这就像把门钥匙写在浏览器的小本子里，同机用户、浏览器插件或同步数据都可能看到。

已处理：

- 请求历史改成白名单保存，只保存接口、路径、参数、响应预览等非密钥内容。
- 旧历史里如果已经有 `apiKey`，读取时会自动剥离。
- 从历史恢复请求时会清空 API Key，用户需要重新输入。

涉及文件：

- `web/src/hooks/useRequestHistory.ts`
- `web/src/pages/APIDocsPage.tsx`

### 2. 安装页不再缓存管理员密码和数据库密码

之前的问题：安装页会把表单保存到 `sessionStorage`，里面可能包含管理员密码、数据库密码、带密码的数据库 URL。

已处理：

- 保存安装表单时会剔除 `admin_password` 和 `database_password`。
- 带用户名密码或 `password/pass/pwd` 参数的数据库 URL 不再持久化。
- 页面刷新后不会把密码重新带回来。

涉及文件：

- `web/src/pages/InstallPage.tsx`

### 3. 开发快捷安装入口只允许开发环境使用

之前的问题：安装页 logo 三连点会触发开发账号快捷安装。如果这类逻辑被带进生产构建，会造成误用风险。

已处理：

- 只在 `import.meta.env.DEV` 下启用。
- 生产构建产物中未搜索到 `dev@localhost`、`devdevdev`、`hlool_skip_install`。

涉及文件：

- `web/src/App.tsx`
- `web/src/pages/InstallPage.tsx`

### 4. API Docs 向外部地址发送 API Key 前会强确认

之前的问题：API Docs 允许用户改 API Base。如果用户填了外部网站，API Key 可能被直接发到别人服务器。

已处理：

- 当接口需要 `X-API-Key` 且目标地址不是当前站点时，会弹出明确确认。
- 用户取消后不会发送密钥。

涉及文件：

- `web/src/pages/APIDocsPage.tsx`

### 5. 弹窗重复实现已大幅收敛

之前的问题：多个页面各自手写弹窗、背景点击关闭、Esc 关闭、焦点控制。这样很容易出现某些弹窗键盘进不去、Esc 关不了、手机上超出屏幕等问题。

已处理：

- 新增共享 `DialogShell`，统一处理：
  - portal 渲染
  - `role="dialog"` / `aria-modal`
  - 标题和描述关联
  - Esc 关闭
  - 背景点击关闭
  - 焦点 trap
  - 关闭后恢复焦点
  - 移动端最大高度
- 已接入创建用户、编辑用户、创建 API Key、分享链接、Webhook、添加域名、用户资料、OAuth 编辑等弹窗。

涉及文件：

- `web/src/components/shared/DialogShell.tsx`
- `web/src/pages/CreateUserDialog.tsx`
- `web/src/pages/EditUserDialog.tsx`
- `web/src/pages/CreateAPIKeyDialog.tsx`
- `web/src/pages/ShareLinksPage.tsx`
- `web/src/pages/WebhooksPage.tsx`
- `web/src/pages/AddDomainDialog.tsx`
- `web/src/pages/UserProfileDialog.tsx`
- `web/src/pages/LoginSettingsPage.tsx`

### 6. 宽表格和移动端触摸体验已优化

之前的问题：Webhook、API Key、域名这类宽表格在窄屏上容易横向滚动后找不到操作按钮；手机上的按钮、开关、分页点击区也偏小。

已处理：

- `DataTable` 默认支持操作列 sticky，横向滚动时右侧操作不会丢。
- 表格横向滚动更顺滑，避免页面整体被拖乱。
- 手机和触摸设备上按钮、分页、开关、输入框最小高度提升。
- 窄屏弹窗底部按钮会自动换行，避免挤在一行。
- Inbox 在平板宽度补了安全布局和触摸尺寸。

涉及文件：

- `web/src/components/shared/DataTable.tsx`
- `web/src/styles/components.css`
- `web/src/styles/layout.css`
- `web/src/styles/inbox.css`
- `web/src/styles/automation.css`

### 7. 动效开始尊重“减少动态效果”

之前的问题：一些呼吸动画、页面切换、弹窗缩放、主题切换涟漪没有完整尊重系统的“减少动态效果”设置。对容易晕动或注意力敏感的用户不友好。

已处理：

- 中心加载态、确认弹窗、页面切换、主题切换会根据 `prefers-reduced-motion` 降低或取消动画。
- 删除粒子动效已有低动效保护。
- 登录页 tab 键盘方向键支持补齐。
- InfoTip 支持 Enter/Space 打开关闭。

涉及文件：

- `web/src/components/shared/CenteredState.tsx`
- `web/src/components/shared/ConfirmModal.tsx`
- `web/src/components/layout/Console.tsx`
- `web/src/components/shared/InfoTip.tsx`
- `web/src/lib/theme.ts`
- `web/src/pages/LandingPage.tsx`

### 8. 动效依赖从主包拆出

之前的问题：`canvas-confetti` 和 `html-to-image` 这种低频动效库被主流程直接 import，会增加首页主包负担。

已处理：

- 成功礼花和删除溶解动效改成用到时再动态加载。
- 构建产物里已经出现独立 `confetti` 和 `dissolve` chunk。

涉及文件：

- `web/src/lib/feedback.ts`

### 9. 删除动画不再早于真实删除结果

之前的问题：某些删除流程会先播放“消失”动画，再调用接口。接口如果失败，用户会误以为已经删掉了。

已处理：

- API Key 删除：先等删除接口成功，再播放行消失动画，再刷新列表。
- 待验证域名删除：先等接口成功，再播放动画并刷新统计。
- 删除失败时保留当前 UI，并显示错误。

涉及文件：

- `web/src/pages/APIKeysPage.tsx`
- `web/src/pages/DomainManagementPage.tsx`

### 10. 一些容易造成“页面假坏”的小问题已修

已处理：

- SSE 错误冷却期间仍会安排重连，不会因为短时间连续错误后一直不恢复。
- 用户搜索使用延迟值，减少输入时频繁请求。
- 管理员配额表单编辑中不会被后台刷新覆盖。
- Dashboard 公共域名分页会在总页数变小时自动回到有效页。
- 通行密钥开关保存失败会回滚，不会显示成“已开启但实际没开启”。
- 后端返回 HTML 或代理错误页时，前端会显示更友好的“非 JSON 内容”错误，而不是 `Unexpected token <`。

涉及文件：

- `web/src/pages/inbox/useActiveMailboxStream.ts`
- `web/src/pages/UsersPage.tsx`
- `web/src/pages/Dashboard.tsx`
- `web/src/pages/LoginSettingsPage.tsx`
- `web/src/api.ts`

## 仍建议后续处理的问题

### A. 分享访问 key 仍然依赖 URL query

当前分享邮箱 key 仍通过 `?key=...` 使用。前端已经会在成功或失败后尝试从地址栏移除 key，但第一次请求时 key 仍会出现在 URL。

为什么暂时没直接改：这牵涉后端协议。更理想的做法是用 POST 校验 key，然后后端发短期 HttpOnly cookie 或临时访问票据。

建议优先级：高。

涉及文件：

- `web/src/pages/SharedMessagePage.tsx`
- 后端分享接口

### B. 邮件 HTML 内相对 API 链接仍可能注入 API Key query

`MessageDrawer` 里会把邮件 HTML 中的相对 `/api/...` 链接补上 `api_key=...`。这通常是为 iframe 内下载或访问接口准备的，但从安全角度看，密钥出现在 URL 里仍不理想。

为什么暂时没直接改：如果直接去掉，可能影响现有邮件内链接或附件访问。更稳的方案需要后端提供一次性下载链接、短期签名 URL，或由前端代理点击请求。

建议优先级：高。

涉及文件：

- `web/src/pages/MessageDrawer.tsx`

### C. API Key reveal 属于后端安全设计问题

前端仍有“复制已有 API Key”的入口，会调用 reveal 接口拿完整密钥。前端这次只解决“不再把 key 存浏览器历史”，但更根本的做法是后端只在创建时显示一次完整密钥，之后不可 reveal，只能轮换。

建议优先级：高。

涉及文件：

- `web/src/components/api-explorer/ApiKeySelector.tsx`
- `web/src/pages/APIKeysPage.tsx`
- 后端 API Key 模型和 reveal 接口

### D. 主包仍超过 500k

构建通过，但 Vite 提醒主包 `index` 超过 500k。已经把低频动效包拆出去了，但主应用仍有进一步分包空间。

建议后续：

- 对图表、API Docs、管理页、国际化大对象继续做更细的懒加载。
- 配置 `manualChunks`，把 React Query、Framer Motion、图标库等拆得更稳定。

建议优先级：中。

### E. 前端还缺自动化 UI 测试

目前主要依赖 TypeScript 构建检查。弹窗焦点、移动端布局、SSE 重连、删除失败回滚这类问题更适合用 Playwright 或 Vitest + Testing Library 固化。

建议优先级：中。

建议先补：

- 弹窗 Esc / Tab 焦点循环。
- API Docs 不保存 API Key。
- 移动端表格操作列可见。
- 删除接口失败时行不消失。
- SSE 失败后会重连。

## 优先级建议

### 近期优先做

1. 后端配合改分享 key：不要长期把 key 放 URL。
2. 后端改 API Key reveal：完整密钥只显示一次。
3. 邮件 HTML 内 API 链接改成短期签名或安全代理。
4. 加 3 到 5 个关键前端自动化测试，锁住本轮修过的风险。

### 中期优化

1. 继续拆主包，降低首次加载体积。
2. 给更多表单加“保存中/失败回滚”的一致模式。
3. 对 Inbox 平板布局做一次产品级设计，而不是只做安全适配。
4. 建一个轻量设计规范，把开关、状态标签、按钮组、表格操作列统一下来。

## 验证结果

已执行：

- `git diff --check`：通过。
- `npm run build`：通过。
- 生产构建产物搜索开发快捷账号和跳过安装 key：未命中。

构建提示：

- Vite 仍提示主 chunk 超过 500k，这是性能优化提醒，不是构建失败。
- 本轮已经把 `confetti` 和 `dissolve` 拆为独立 chunk，但主包仍有继续拆分空间。

## 本轮主要改动文件

共享组件：

- `web/src/components/shared/DialogShell.tsx`
- `web/src/components/shared/DataTable.tsx`
- `web/src/components/shared/InfoTip.tsx`
- `web/src/components/shared/CenteredState.tsx`
- `web/src/components/shared/ConfirmModal.tsx`
- `web/src/components/layout/Console.tsx`

安全和请求：

- `web/src/hooks/useRequestHistory.ts`
- `web/src/pages/APIDocsPage.tsx`
- `web/src/pages/InstallPage.tsx`
- `web/src/App.tsx`
- `web/src/api.ts`

页面体验：

- `web/src/pages/APIKeysPage.tsx`
- `web/src/pages/AddDomainDialog.tsx`
- `web/src/pages/CreateAPIKeyDialog.tsx`
- `web/src/pages/CreateUserDialog.tsx`
- `web/src/pages/EditUserDialog.tsx`
- `web/src/pages/Dashboard.tsx`
- `web/src/pages/DomainManagementPage.tsx`
- `web/src/pages/LandingPage.tsx`
- `web/src/pages/LoginSettingsPage.tsx`
- `web/src/pages/ShareLinksPage.tsx`
- `web/src/pages/UserProfileDialog.tsx`
- `web/src/pages/UsersPage.tsx`
- `web/src/pages/WebhooksPage.tsx`
- `web/src/pages/inbox/useActiveMailboxStream.ts`

样式：

- `web/src/styles/components.css`
- `web/src/styles/layout.css`
- `web/src/styles/inbox.css`
- `web/src/styles/automation.css`

## 给非开发者的最后提醒

这轮前端最大的收益不是“页面更漂亮”，而是把一些以后会反复踩坑的基础问题收住了：密钥别乱存、弹窗别各写各的、手机别点不中、动画别让人不舒服、失败时别假装成功。

剩下的高优先级问题主要已经不是单纯前端能优雅解决的了，需要后端接口一起调整。尤其是分享 key、API Key reveal、邮件 HTML 链接里的 API Key，这三项建议作为下一轮安全收口重点。
