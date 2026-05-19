# 审计日志分页改造方案

## 背景

当前「最近关键审计」使用 **Cursor 分页**（基于 `created_at + id` 的 base64 游标），前端通过 `next_cursor` 逐页加载。存在以下问题：

1. 无法跳转到任意页码，只能「加载更多」
2. 没有总页数/总数信息，用户不知道数据量
3. 头部操作区按钮（重置 / 更早）功能弱且 UI 不整齐
4. 缺少显式的刷新按钮

目标：改为**页码分页** + **刷新按钮**，与其他页面（用户管理、域名列表等）的交互保持一致。

---

## 一、后端改造

### 1.1 接口变更

**当前**
```
GET /api/admin/audit-logs?limit=10&cursor=xxx&category=xxx&...
→ { items: [...], next_cursor: "..." }
```

**目标**
```
GET /api/admin/audit-logs?page=1&per_page=20&category=xxx&...
→ { items: [...], total: 156, page: 1, per_page: 20, total_pages: 8 }
```

### 1.2 `admin_handlers.go` 修改点

文件：`internal/http/admin_handlers.go`

#### 响应结构体替换

```go
// 移除旧的 cursor 响应结构
type adminAuditLogsResponse struct {
    Items      []models.AuditLog `json:"items"`
    NextCursor string            `json:"next_cursor,omitempty"`
}

// 复用已有的 PaginatedResponse 模式（或新建）
type auditLogListResponse struct {
    Items      []models.AuditLog `json:"items"`
    Total      int64             `json:"total"`
    Page       int               `json:"page"`
    PerPage    int               `json:"per_page"`
    TotalPages int               `json:"total_pages"`
}
```

#### Handler 逻辑替换

```go
func (h *Handler) adminAuditLogs(c *gin.Context) {
    if !h.requireAdmin(c) {
        return
    }

    // 解析分页参数（复用项目已有的 parsePage / parsePerPage 工具）
    page := parsePage(c.Query("page"))
    perPage := parsePerPage(c.Query("per_page"), 20, 100) // 默认 20，最大 100

    // 构建带筛选的基础查询
    query := h.DB.Model(&models.AuditLog{})
    query = filterAuditLogs(query, c)

    // 1) COUNT 总记录数（带同样筛选条件）
    var total int64
    if err := query.Count(&total).Error; err != nil {
        fail(c, http.StatusInternalServerError, err.Error())
        return
    }

    // 2) 查询当前页数据
    var logs []models.AuditLog
    offset := (page - 1) * perPage
    if err := query.Order("created_at desc, id desc").
        Limit(perPage).Offset(offset).
        Find(&logs).Error; err != nil {
        fail(c, http.StatusInternalServerError, err.Error())
        return
    }

    totalPages := int((total + int64(perPage) - 1) / int64(perPage))
    if totalPages < 1 {
        totalPages = 1
    }

    ok(c, auditLogListResponse{
        Items:      logs,
        Total:      total,
        Page:       page,
        PerPage:    perPage,
        TotalPages: totalPages,
    })
}
```

#### 移除 Cursor 相关代码

以下代码可删除：
- `encodeAuditCursor()`
- `parseAuditCursor()`
- handler 内 `cursor` 参数解析逻辑

> 如果其他模块仍在使用 cursor（目前搜索看只有审计日志在用），可安全删除；否则保留但不使用。

---

## 二、前端改造

### 2.1 类型定义

文件：`web/src/types/index.ts`

```ts
// 移除旧的 AuditLogPage
type AuditLogPage = {
  items: AuditLog[];
  next_cursor?: string;
};

// 替换为复用已有的 PaginatedResponse
type AuditLogPage = PaginatedResponse<AuditLog>;
// PaginatedResponse 已存在，结构为 { items, total, page, per_page, total_pages }
```

### 2.2 组件改造

文件：`web/src/pages/AdminAuditLog.tsx`

#### 状态变更

```ts
// 移除
const [auditCursor, setAuditCursor] = useState('');

// 新增
const [auditPage, setAuditPage] = useState(1);
const auditPerPage = 20; // 与后端默认保持一致
```

#### React Query 变更

```ts
const auditLogs = useQuery({
  queryKey: ['admin-audit-logs', auditFilters, auditPage],
  queryFn: () => api<AuditLogPage>(
    `/api/admin/audit-logs?${buildAuditLogQuery(auditFilters, auditPage, auditPerPage)}`
  ),
  retry: false,
  staleTime: 30_000
});
```

> 注意：queryKey 中移除 `auditCursor`，加入 `auditPage`。筛选条件变化时需在 onChange 中 `setAuditPage(1)`。

#### query 构建函数

```ts
function buildAuditLogQuery(
  filters: AuditLogFilters,
  page: number,
  perPage: number
) {
  const params = new URLSearchParams({
    page: String(page),
    per_page: String(perPage)
  });
  // ... 原有筛选参数逻辑不变
  return params.toString();
}
```

#### 头部区域（添加刷新按钮）

```tsx
<div className="panel-header admin-panel-header">
  <div>
    <h2>{text.admin.auditLogs.title}</h2>
    <p>{text.admin.auditLogs.desc}</p>
  </div>
  <div className="table-actions">
    <button
      className="btn-secondary"
      type="button"
      onClick={() => auditLogs.refetch()}
      disabled={auditLogs.isFetching}
      title={text.common.refresh}
    >
      <RefreshCw size={14} className={auditLogs.isFetching ? 'animate-spin' : ''} />
      {text.common.refresh}
    </button>
  </div>
</div>
```

> 刷新按钮使用 `btn-secondary` 样式，与筛选区下拉框高度一致（2.25rem），不再出现之前 `btn-ghost` + `btn-secondary` 高度不齐的问题。

#### 底部区域（页码分页）

```tsx
{auditLogs.data && auditLogs.data.total_pages > 1 && (
  <div className="admin-audit-pagination">
    <PaginationControls
      page={auditLogs.data.page}
      totalPages={auditLogs.data.total_pages}
      onPageChange={setAuditPage}
    />
  </div>
)}
```

> `PaginationControls` 是项目已有组件，在 UsersPage / Dashboard / InboxPage 中均已使用，无需重复开发。

### 2.3 样式补充

文件：`web/src/styles/components.css`

```css
.admin-audit-pagination {
  display: flex;
  justify-content: center;
  margin-top: 0.75rem;
}
```

### 2.4 i18n 清理

文件：`web/src/locales/zh-CN.ts`、`web/src/locales/en-US.ts`

- `admin.auditLogs.loadMore` → **保留**（如未来其他列表需要）或 **删除**
- `admin.auditLogs.older` → **删除**
- `admin.auditLogs.reset` → **删除**
- `common.refresh`（已有）→ **复用**，无需新增

---

## 三、交互流程

| 用户操作 | 前端行为 |
|---------|---------|
| 进入页面 | 加载第 1 页，默认筛选 `category=security` |
| 切换筛选条件 | `setAuditPage(1)` + 重新请求 |
| 点击页码 | `setAuditPage(n)` + 重新请求 |
| 点击刷新 | `auditLogs.refetch()` + 保持当前页和筛选 |
| 无数据 | 显示 `emptyLabel`（已有的 DataTable 空状态） |
| 只有 1 页 | 不显示分页组件 |

---

## 四、影响范围与风险

| 项目 | 影响 | 说明 |
|-----|------|------|
| 后端 API | 有 | 分页参数从 `cursor/limit` 变为 `page/per_page`；响应结构变化 |
| 前端类型 | 有 | `AuditLogPage` 结构变更 |
| 前端状态 | 有 | 移除 `cursor`，新增 `page` |
| 测试用例 | 有 | `http/audit_test.go` 中如测试了 cursor 分页，需改为测试 page 分页 |
| 性能 | 轻微 | 增加一次 `COUNT(*)` 查询；审计日志表有索引，数据量通常不大，影响可控 |
| 兼容性 | 无 | 审计日志接口仅管理员后台使用，无外部依赖 |

---

## 五、替代方案（如不想改后端）

如果坚持不改后端，仅在前端模拟页码分页：

1. 前端维护一个 `pageHistory: string[]` 数组，记录每一页的 cursor
2. 点击「下一页」= 取当前页返回的 `next_cursor` 存入数组，请求下一页
3. 点击「上一页」= 用数组中上一页的 cursor 请求
4. 无法显示总页数，只能显示「第 N 页」+「上一页 / 下一页」

**不推荐此方案**：它绕过了真正的页码分页优势（跳转任意页、知道总量），且代码复杂度更高。审计日志表有索引，COUNT 性能可以接受。

---

## 六、实施顺序

1. 后端：`adminAuditLogs` handler 改为 page/per_page 分页
2. 后端：删除 cursor 编码/解码函数（确认无其他调用）
3. 后端：更新对应测试用例
4. 前端：修改 `AuditLogPage` 类型
5. 前端：改造 `AdminAuditLog.tsx`（状态、query、刷新按钮、分页组件）
6. 前端：添加分页样式
7. 前端：清理冗余 i18n 文案
8. 验证：TypeScript 编译 + 手工测试分页/筛选/刷新流程
