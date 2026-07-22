# S2.8 Heptabase 白板底座

状态：S2.8.1–S2.8.4 已实现
产品边界：卡片、空间分组、可视化编排；知识节点与 Citation 仍是唯一内容源。

## 1. 产品原则

1. **不复制知识**：白板卡片只引用 `nodes.id`，位置、尺寸和分组属于视图数据；标题、解释、来源与引用继续从知识节点读取。
2. **不破坏原图**：思维导图与白板是同一知识库的两个视图。切换、拖动或分组不会改写 `contains / relates_to / contradicts`。
3. **默认不自动整理**：首次进入白板只生成可预览的初始排布；持久化发生在用户拖动、建组或明确保存之后。一键整理属于 S2.13。
4. **跨设备可恢复**：白板默认视图、卡片位置/尺寸、空间分组均由租户隔离的后端保存，本地模式使用同构契约。
5. **渐进展示**：大库先显示主题分组与卡片标题；进入分组或放大后显示摘要与 Citation，不降低原始信息密度。

## 2. 数据模型

### 知识库

`maps.canvas_view`：`mindmap | whiteboard`。它只表示默认展示视图，与 `maps.mode`（knowledge / meeting / article）完全独立。

### 卡片布局

`node_layouts` 继续以 `node_id + map_id` 唯一定位卡片，新增：

- `group_id`：可为空，且后端验证分组与节点属于同一 map；
- `card_width / card_height`：只控制阅读卡尺寸；
- `updated_at`：解决旧请求覆盖新拖动；
- 原有 `position_x / position_y / zoom_level` 继续使用。

卡片布局禁止保存 `content`、`desc` 或 Citation 副本。

未分组卡片保存画布绝对坐标；已分组卡片保存相对分组左上角的坐标。移动分组时只更新一条分组记录，不批量改写卡片；删除分组时服务端把相对坐标转换回绝对坐标，再解除 `group_id`。

### 空间分组

`whiteboard_groups` 保存分组标题、颜色、坐标、尺寸、折叠状态和排序。删除分组时卡片与节点、关系、Citation 全部保留；前端也为已归组卡片提供“移出”入口，便于触控设备使用。

## 3. 分阶段交付

| 子任务 | 交付 | 验收 |
|---|---|---|
| S2.8.1 | V14 迁移、读写 API、本地同构、Store/缓存契约 | bootstrap 与 map GET 返回 layouts/groups；越权 map/group 被拒绝；回滚脚本可恢复 V13 |
| S2.8.2 | 思维导图/白板切换、阅读卡、首次确定性排布、拖动持久化 | 刷新后位置与默认视图恢复；切回思维导图结构不变 |
| S2.8.3 | 新建/重命名/移动/缩放/折叠/删除空间分组，卡片移入移出 | 删除分组不删节点；分组移动不丢卡；撤销失败时回滚 UI |
| S2.8.4 | 大图渐进展示、键盘/移动端、性能与生产 E2E | 500 卡平移缩放可用；桌面与移动端核心路径通过；真实账号跨刷新恢复 |

### S2.8.4 大图交互规则

- 80 张卡片起启用大图性能模式，React Flow 只挂载当前视口附近的卡片；Store、后端布局、关系和 Citation 仍保留全量数据。
- 桌面端缩放低于 `0.78` 只显示标题，`0.78–1.05` 显示摘要，`1.05` 以上显示摘要与 Citation；移动端阈值分别为 `0.9 / 1.18`。选中或搜索命中的卡片可恢复完整阅读。
- 小于 80 张卡片保持原有完整阅读卡，不因本次性能策略减少信息。
- 键盘 `G` 新建空间分组，`0` 适配全部内容；移动端无需展开更多菜单即可使用“＋ 分组”。
- 固定 500 卡 E2E 同时验证视口裁剪、首屏可交互、2 秒内缩放响应、键盘操作、iPhone SE 尺寸入口和无横向溢出。

## 4. API 契约

- `GET /api/bootstrap` 与 `GET /api/knowledge?mapId=...`：返回 `layouts[]`、`whiteboardGroups[]`。
- `PUT /api/knowledge`：保存单张卡片，或用 `{ mapId, layouts[] }` 一次保存最多 500 张卡片的位置、尺寸和分组；节点、map、group 三者必须同租户同知识库。
- `POST action=setMapCanvasView`：保存默认视图。
- `POST action=createWhiteboardGroup | updateWhiteboardGroup | deleteWhiteboardGroup`：管理空间分组。
- `/health.checks.whiteboardLayout`：只有 V14 字段与表均可读才为 `ready`。

所有写请求必须携带现有 Supabase 登录令牌与工作区范围；不新增面向普通用户的令牌门槛。

## 5. 迁移与回滚

发布顺序：

1. 执行 `supabase-v14-whiteboard-migration.sql`；
2. 部署 API `10.10.1`；
3. 验证 `/health` 的 `whiteboardLayout=ready`；
4. 合并并发布前端白板视图。

S2.8.4 仅调整前端展示与测试，API 继续使用 `10.10.1`。若只回滚 S2.8.4，可回退前端而无需改数据库或 API；若回滚 S2.8.3 前端或 API，先回退到 API `10.10.0`；只有决定整体撤销白板底座时，才继续回退到 `10.9.2` 并执行 `supabase-v14-whiteboard-rollback.sql`。V14 只增加视图数据，不修改知识节点、边、实体或 Citation。

## 6. 不属于 S2.8

- AI 自动重排、多策略整理、预览与撤销：S2.13；
- 跨库实体合并与统一知识宇宙：S2.14；
- GraphRAG 查询定位与召回重排：S2.12；
- PDF 原文高亮：S2.11。
