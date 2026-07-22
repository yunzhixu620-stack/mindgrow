# S2.2 首屏 Bootstrap

## 目标

登录会话建立后，浏览器用一次 `GET /api/bootstrap` 获取当前用户可见的工作区、所选工作区的知识库目录、分类和默认知识图谱，避免首屏依次请求 `/api/workspaces`、`action=maps`、`action=categories` 与默认 `mapId`。

## 接口契约

- 方法：`GET /api/bootstrap`
- 鉴权：与其他生产 API 相同，必须提供有效 Supabase Bearer 会话。
- 工作区：可用 `X-Workspace-Id` 请求已加入的工作区；无值或值已失效时安全回退到该用户的第一个工作区，不会返回其他租户数据。
- 返回：`user`、`workspaces`、`workspace`、`maps`、`categories`、`defaultMap`、`generatedAt`。
- `defaultMap` 同时包含 map 元数据、nodes、edges 与 entityGraph；工作区没有 map 时返回 `null`。

## 前端行为

1. AuthProvider 对同一用户与工作区的并发初始化请求去重。
2. 首页只消费与当前 `userId + workspaceId` 完全匹配的 bootstrap 快照。
3. 默认图快照直接进入租户缓存和 Zustand，首屏不再重复请求默认图。
4. 后台仍可在首屏完成后预取会议与文章板块，用户手动切换工作区时继续使用原有可回退目录加载链路。
5. 登出、换账号或换工作区会清除旧 bootstrap，不能跨租户复用。

## 门禁与回滚

- API 版本：`10.7.0`
- 单测覆盖：工作区授权选择、失效工作区回退、默认 map 选择、前端租户匹配。
- 回归门禁：lint、API version、Vitest、RAG、local backend、local E2E、Next.js build。
- 回滚：阿里云函数回滚到 API `10.6.0`；前端回滚 S2.2 提交后会自动恢复原有 workspaces/maps/categories/default graph 请求，不需要数据库回滚。
