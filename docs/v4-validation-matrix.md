# MindGrow v4 验证矩阵

> 执行基线：`docs/codex-tasks-v4.md`
> 更新规则：每个任务进入下一阶段前更新本表；“已有局部能力”不等于“任务已完成”。
> 最近核对基线：`main@7cb1842`；S2.1 发布分支 `agent/s2-1-map-mode@b27846c`（PR #36）

## 状态定义

- `已合并`：代码与规定门禁已进入 `main`。
- `开发中`：已进入独立任务分支，尚未完成全部门禁与发布。
- `发布中`：数据库和后端已发布并验证，前端尚未合并到 `main`。
- `待发布`：实现和本地门禁已完成，但仍需预览、数据库或云端发布证据。
- `局部已有`：产品中已有相关功能，但尚未满足该任务的完整验收口径。
- `待开发`：尚未按 v4 验收口径实施。

## Sprint 1

| 任务 | 状态 | 主证据 |
|---|---|---|
| P0.0.1 | 已合并 | `aa3cbc8`，Vitest 单测底座 |
| P0.0.2 | 已合并 | PR #2 / `7a7b004`，本地与公网 backend smoke 分离 |
| P0.0.3 | 已合并 | PR #3 / `ca4676b`，API 版本镜像与 runbook |
| P0.1 | 已合并 | PR #4 / `9482302`，鉴权配置 fail-closed |
| P0.2 | 已合并 | PR #5 / `f2c6e2f`，URL 抓取固定地址并逐跳复核 |
| P1.0 | 已合并 | PR #6–#9 / `5665d04`–`84e929f`，Immer、租户缓存、overlay 与 reset |
| P1.1 | 已合并 | PR #10–#11 / `63c1e7f`、`a22901c`，页面与 Universe 租户隔离 |
| P1.2 | 已合并 | PR #14 / `2d6f223`，双账号隔离 E2E |
| P1.3 | 已合并 | PR #12–#13 / `4f7f026`、`a0a3102`，统一图加载与 E2E 稳定化 |
| P1.4 | 已合并 | PR #15 / `51a64ab`，按 map 的写入与同步状态 |
| P2.0 | 已合并 | PR #16–#20 / `a0f02d3`–`a2042e3`，逐字 citation、逐 claim 审计与翻译证据约束 |
| P2.1 | 已合并 | PR #21–#25、#28 / `680236f`–`bb060f4`、`aac2ce0`，实体/关系证据门禁、兜底、评测与详情 |
| P3.0 | 已合并 | PR #26–#27 / `8f81662`、`d19172f`，health 预热与图骨架屏 |
| U1 | 已合并 | `/guide` 构建期数据与 Timeline 已在 v4 基线前进入主线，当前 E2E 持续验证入口 |
| U2 | 已合并 | PR #34 / `fb1b87b`，map 同步状态 |
| U3 | 已合并 | 随 P3.0.2，复用统一骨架屏 |
| U4 | 已合并 | PR #29 / `58e6222`，产品层级面包屑 |
| U5 | 已合并 | PR #33 / `e237de3`，本地命令搜索 |
| U6 | 已合并 | 随 PR #18，文章/会议逐 claim 回答审计 |
| U7 | 已合并 | PR #30 / `15019f7`，一跳关系聚焦 |
| U8 | 已合并 | PR #35 / `7cb1842`，浅色/深色/跟随系统主题 |
| U9 | 已合并 | PR #31 / `d695ed2`，新用户空知识库引导 |
| U10 | 已合并 | PR #32 / `d02b9b0`，移动端底部导航 |

## Sprint 2+

| 任务 | 状态 | 当前结论 / 下一门禁 |
|---|---|---|
| S2.1 maps.mode 数据迁移 | 已合并 | PR #36 / `a1a988a`；Supabase V12、阿里云 API `10.6.0`、GitHub Pages 均已发布；真实账号三种 mode 的创建、刷新读取、板块隔离与清理全部通过 |
| S2.2 `/api/bootstrap` 首屏聚合 | 已合并 | PR #37 / `eac8102`；阿里云 API `10.7.0`、GitHub Pages 已发布；匿名拒绝公网 smoke 6/6、带认证本地聚合 smoke 7/7；真实登录首屏一次恢复工作区、5 个知识库与默认图 107 节点，三板块往返无缓存残留，页面无 warning/error |
| S2.3 CI 部署事实校验 | 已合并 | PR #38 / `4653d25`；GitHub Pages 静态清单的完整 SHA、API `10.7.0` 与 `authRequired=true` 生产校验通过；后端 `git_sha` 按 Owner 决定留到 S2.10 |
| S2.4 Backlinks + 时间轴 | 已合并 | PR #39 / `04f4cab`；Supabase V13、阿里云 API `10.8.0` 与 GitHub Pages 已发布；补齐触发器 PATCH 后，公网 smoke、真实账号 created/updated 时间轴与刷新持久化全部通过 |
| S2.5 canonical ID + 真 createdAt | 已合并 | PR #41 / `e68b455` 与 PR #42；Supabase V11 字段、API `10.9.2` 与公网 smoke 已验证；真实文章重复导入、canonical ID/时间、刷新持久化和临时数据清理全部通过 |
| S2.6 React Flow 可复现 bug | 已合并 | PR #43 / `3f89eee`；修复知识宇宙全页返回后大型图从总览退化为全部展开的竞态；固定复现清单、单测与 E2E 均已落库，GitHub Pages 真实账号验证通过 |
| S2.7 Obsidian 式实体网状图 | 局部已有 | 已有实体图、一跳聚焦和详情；缺完整强关系默认、过滤、搜索验收 |
| S2.8 Heptabase 白板底座 | 待开发 | 需要卡片、空间分组和可视化编排模型 |
| S2.9 阿里云常驻实例 | 待开发 | 属生产云配置；需 Owner 授权、成本记录和回滚证据 |
| S2.10 观测/on-call | 局部已有 | 已有 runbook/health；缺 `git_sha`、部署断言、错误分级与值班闭环 |
| S2.11 PDF Viewer + 原文高亮 | 待开发 | 当前只有文本抽取/locator，不宣称原文 Viewer 高亮 |
| S2.12 查询时 GraphRAG 定位 | 待开发 | P2.1 只保证建图质量；仍需 entity linking、混合召回、路径重排、拒答与 Recall@5/MRR |
| S2.13 一键整理知识库 | 局部已有 | 已有分级展开/展示能力；缺多策略、预览、撤销和默认不整理的完整闭环 |
| S2.14 统一知识宇宙 | 局部已有 | 三模块已有共享展示基础；缺统一实体与“会议确认后入长期库”门禁 |
| S2.15 多源文章 + Audio Overview | 局部已有 | 已支持部分 URL/PDF/正文与 citation；缺完整拒答、可靠多源覆盖及 Audio Overview |
| S2.16 跨库全局搜索 | 局部已有 | U5 仅本地命令搜索；缺后端索引、权限过滤和命中解释 |
| S2.17 国际化与反馈闭环 | 待开发 | 英文 UI、反馈群机制、标签与版本回访均待完整实施 |
| S2.18 邮件投递长期方案 | 待开发 | 需 SMTP 选型、退信监控、频控和成本验证 |
| S2.19 SEO 与产品说明书 | 待开发 | 需可索引页面、结构化内容及功能/技术/隐私/定价文档 |
| S2.20 三板块产品测评集 | 局部已有 | 现有 59 项 RAG 测试不替代碎片/文章/会议各 ≥20 个真实产品 case |
| S2.21 普通用户凭证包装 | 待开发 | 需把 Supabase 登录和 workspace token 对普通用户透明化，并验证续期/最小权限 |

## S2.1 发布检查点

1. [x] 2026-07-22 在 Supabase SQL Editor 执行 `supabase-v12-map-mode-migration.sql`：22 张 map 全部获得合法 `mode`；约束、索引、兼容触发器、`NOT NULL` 均已核验。
2. [x] 2026-07-22 部署阿里云函数 API `10.6.0`：`/health` 返回 `status=ok`、`authRequired=true`、`knowledgeStore=ok`、`hybridRetrieval=ready`、`entityGraph=ready`。
3. [x] 2026-07-22 运行公网匿名 smoke：CORS、health 与三类匿名拒绝共 5/5 通过。
4. [x] 2026-07-22 使用已登录真实账号完成三种 `mode` 的创建、刷新读取和板块隔离验证，随后删除全部测试 map；未读取或导出浏览器令牌。
5. [x] 2026-07-22 前端合并为 `main@a1a988a`，GitHub Pages 公网 `index.html` SHA-256 与本地构建完全一致。
6. 若任一阶段失败，先停止后续发布；数据库回滚使用 `supabase-v12-map-mode-rollback.sql`，阿里云函数回滚到 API `10.5.2`。

## S2.4 发布检查点

1. [x] 2026-07-22 在 Supabase SQL Editor 执行 V13 migration；`node_revisions` 表、索引与 RLS 均存在，`anon` / `authenticated` 不可直接读取，`service_role` 可用。
2. [x] 2026-07-22 阿里云 WebIDE 源码写入前校验 SHA-256 `9ded77a64eebe2d51ef4346714a10a38c816f29ed74415ab19b0cff8ea223efa`、版本 `10.8.0`、字节数 `253485`，控制台部署完成。
3. [x] 2026-07-22 公网 `/health` 返回 `status=ok`、`version=10.8.0`、`authRequired=true`、`knowledgeStore=ok`、`nodeTimeline=ready`；匿名安全 smoke 6/6 通过。
4. [x] PR #39 压缩合并为 `main@04f4cab`，GitHub Pages 发布完成；production fact 通过，前端完整 SHA、API `10.8.0` 与 `authRequired=true` 一致。
5. [x] 使用真实账号创建隔离 map、生成 14 个节点、编辑根节点；时间轴展示 created / updated 共 2 条，刷新后标题、说明和两条事件仍存在；随后删除临时 map，状态恢复“已同步”。
6. [x] 真实验收发现阿里云 HTTP 触发器漏配 PATCH（平台层 `403 AccessDenied`）；已将触发器方法补为 `GET, POST, DELETE, PUT, OPTIONS, PATCH`，匿名 PATCH 现进入应用鉴权并返回 `401 AUTH_REQUIRED`，同时加入公网 smoke 防回归。

## S2.5 发布检查点

1. [x] 2026-07-22 在 Supabase SQL Editor 补齐 V11 字段：`graph_entities.description_citation_indexes` 与 `graph_relations.explanation`；API `10.9.2` 的 health 会真实探测这两个字段，避免部分迁移被误报为 ready。
2. [x] 阿里云 WebIDE 原子写入前校验源码：`255553` 字节，SHA-256 `bdecce275af7e3c8a77fbdb8d99fee88a84fab10309720f3bbfce0d5c14c3612`，版本 `10.9.2`，必需实体字段探针存在；控制台部署成功。
3. [x] 公网 `/health` 返回 `status=ok`、`version=10.9.2`、`authRequired=true`、`knowledgeStore=ok`、`hybridRetrieval=ready`、`entityGraph=ready`、`nodeTimeline=ready`；公开后端 smoke 7/7 通过。
4. [x] 真实文章首次保存得到 5 个实体、1 条关系；第二篇得到 3 个实体、2 条关系，跨文章去重后共 6 个实体。`GraphRAG` canonical ID 固定为 `entity_ac6ac5a82bced63768762f78`，首次时间 `2026-07-22 11:59 UTC`、最近更新 `2026-07-22 12:01 UTC`，刷新后仍保留两条专属证据。
5. [x] 删除临时文章知识库 `QA-S2.5-实体时间-20260722`；生产账号恢复到原有知识库集合。

## S2.6 发布检查点

1. [x] 在 `main@caca8d9` 生产真实账号稳定复现 RF-01：默认知识库 107 个原节点，从知识宇宙返回后持续显示 108 个 React Flow 节点，工具栏为 `主干 107/107`，不是瞬时动画。
2. [x] PR #43 增加 `outline` 初始化恢复规则，同时保护用户主动选择的 `all` 与逐级展开后的 `custom`；未修改存储节点、边、引用、实体或 GraphRAG 拓扑。
3. [x] 本地门禁：unit 142/142、lint、build、E2E 35/35；新增“全页返回后仍保持大型图总览”用例通过，三板块热切换 147ms / 216ms / 118ms。
4. [x] PR #43 压缩合并为 `main@3f89eee`；`gh-pages@93d837b` 发布成功，production fact 精确对应前端完整 SHA、API `10.9.2` 与 `authRequired=true`；公网后端 smoke 7/7。
5. [x] GitHub Pages 真实账号按 RF-01 复测：进入知识宇宙后返回，`viewMode=outline`、React Flow 节点数为 1、总原节点为 107、抬头为 1、控制台无 warning/error。
6. [x] 生产逐级展开回归：总览 1 → 10，只出现 9 个下一层主题与 9 个继续展开入口；收起后恢复 1，页面状态为“已同步”。
