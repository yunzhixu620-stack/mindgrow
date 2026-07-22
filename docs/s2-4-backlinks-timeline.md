# S2.4 Backlinks 与节点时间轴

## 产品行为

在概念图节点上右键选择“引用与时间轴”，侧边面板会展示三类信息：

1. 原文来源：该节点自己的逐字引用、文档标题、定位信息与原网页；
2. 反向关联：直接指向该节点的上级/语义边，以及复用同一来源文档的节点；
3. 变更时间轴：节点创建与后续标题、说明、类型等修改快照。

反向关联严格限定当前 workspace 和 map。没有 citation 的节点明确显示“无原文引用”，不会把结构边或语义相似误写成来源证据。

## 数据与接口

- Supabase V13 新增 `node_revisions`；浏览器角色无表权限，仅阿里云 service role 可读写；
- `PATCH /api/knowledge` 只在字段实际变化时写入 revision；
- 新建节点写入 `created` revision；旧节点通过已有 `created_at` / `updated_at` 生成只读兼容事件；
- `GET /api/knowledge?action=nodeContext&nodeId=...` 聚合节点、来源、backlinks 与 timeline；
- API 10.8.0 的 `/health.checks.nodeTimeline` 必须为 `ready`。

## 发布与回滚

发布顺序：

1. 执行 `supabase-v13-node-revisions-migration.sql`；
2. 部署阿里云 API 10.8.0，确认 health 与 authenticated nodeContext smoke；
3. 发布 GitHub Pages 前端；
4. 用真实账号编辑节点并确认刷新后时间轴仍存在。

回滚顺序相反：先回滚前端和 API 10.7.0，再运行 `supabase-v13-node-revisions-rollback.sql`。回滚会删除 revision 历史，不影响节点正文、引用与图谱。
