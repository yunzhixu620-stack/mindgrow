# S2.16 全工作区搜索

## 用户可见结果

- 左侧入口与命令面板统一为“搜索整个工作区”，可同时查找知识库、节点、实体、文章来源和 Citation 原文。
- 当前知识库的本地结果即时出现；输入至少 2 个字符后，等待 220ms 再请求云端，避免每次按键都调用接口。
- 每条云端结果明确显示命中原因，例如“命中实体别名”“命中 Citation 原文”，不把相似结果伪装成精确命中。
- 点击其他知识库中的节点或实体时，先切换目标知识库并等待数据加载，再定位和高亮；不会先跳到空白画布。
- 云端查询失败或超时时，本地结果仍然保留，并在云端分组显示可恢复的错误状态。

## 正确性与安全边界

- 后端只接受登录态解析出的 workspace id，不信任浏览器传入的 workspace 参数。
- Supabase RPC 只授予 `service_role`，并在 maps、nodes、entities、documents 和 citation chunks 的每条检索分支中重复执行工作区约束。
- 只搜索未归档节点；实体别名必须是有效数组，异常历史数据不会使整次检索失败。
- 本地结果优先，云端结果按稳定键去重；过期请求使用 AbortController 和序号保护，慢响应不能覆盖新查询。
- `/health.checks.workspaceSearch` 会实际探测 RPC。迁移缺失、权限错误或结构不兼容时，生产健康检查 fail-closed。

## 数据库与索引

- V16 migration 新增 `search_workspace_knowledge` RPC，返回统一的 map、node、entity、document 和 citation 结果契约。
- 新增标题、描述、实体名称和内容的 trigram 索引；不改写现有知识库、节点、文档、Citation 或实体关系。
- RPC 撤销 `PUBLIC`、`anon`、`authenticated` 权限，仅允许后端 `service_role` 调用。
- 回滚脚本只移除 V16 RPC 与新增索引，不删除用户数据。

## 验证证据

- 完整单元测试：38 files / 189 tests。
- RAG、迁移安全和旧运行时兼容门禁：65/65。
- 本地后端：9/9，并额外断言搜索 RPC 使用服务端解析出的准确 workspace id。
- 产品端到端：37/37；覆盖防抖、跨知识库结果、命中原因、切库后定位、请求失败降级和测试数据清理。
- 三板块切换延迟为 100ms / 217ms / 178ms，知识宇宙进入耗时 91ms。
- lint、API 版本一致性与 Next.js 生产构建通过；API 版本为 `10.16.0`。

## 发布顺序

1. 合并前完成 CI、Vercel Preview、unit、RAG、backend local、产品 E2E 与 build。
2. 在 Supabase Production 执行 V16 migration，并以 SQL Editor 成功结果确认事务提交。
3. 把实际合并提交写入阿里云部署身份，发布 API `10.16.0`，以 health 的 `workspaceSearch=ready` 验证 RPC、权限与函数代码同时生效。
4. 发布同一合并提交的 GitHub Pages。
5. 用公网 health、backend smoke、前端 E2E 与 production fact 核对版本和提交身份。

## 生产验证（2026-07-23）

- PR #58 已压缩合并为 `main@2a5fa505d3ade0d67c3ba20e562ecc89e6351492`，CI 与 Vercel Preview 通过。
- Supabase Production 已执行 V16 migration，SQL Editor 返回成功；阿里云公网 health 的 `workspaceSearch=ready` 进一步验证 RPC 可由服务端调用。
- 阿里云 API `10.16.0` 已发布；公网健康检查返回精确合并提交、`authRequired=true`、`nodeEnv=production`、`deploymentIdentity=ready`，知识存储、实体图、GraphRAG 排序与全工作区搜索均为 ready。
- 公网 backend smoke 7/7 通过。
- GitHub Pages 已发布为 `gh-pages@e0c3340febdcc8b135be3e1d3064651f0e99595e`；Pages workflow `29973061109` 与公网前端 E2E 7/7 通过。
- production fact workflow `29973110087` 精确核对前后端均为本次合并提交、API `10.16.0` 与鉴权门禁并通过。
