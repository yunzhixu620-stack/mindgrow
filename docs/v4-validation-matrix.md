# MindGrow v4 验证矩阵

> 执行基线：`docs/codex-tasks-v4.md`
> 更新规则：每个任务进入下一阶段前更新本表；“已有局部能力”不等于“任务已完成”。
> 最近核对基线：`main@7cb1842`；S2.1 发布分支 `agent/s2-1-map-mode@b27846c`（PR #36）

## 状态定义

- `已合并`：代码与规定门禁已进入 `main`。
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
| S2.1 maps.mode 数据迁移 | 发布中 | Supabase V12 已迁移并校验 22 张 map（knowledge 17 / meeting 3 / article 2 / invalid 0）；阿里云 API `10.6.0` 已发布，公网 health 与匿名拒绝 smoke 5/5 通过；待 authenticated CRUD 与前端合并 |
| S2.2 `/api/bootstrap` 首屏聚合 | 待开发 | 依赖 S2.1 稳定的数据分类 |
| S2.3 CI 部署事实校验 | 待开发 | 需增加 `git_sha`、线上 health 与静态前端对应断言 |
| S2.4 Backlinks + 时间轴 | 待开发 | 当前 citation 不等于可反查 backlinks |
| S2.5 canonical ID + 真 createdAt | 待开发 | 依赖统一实体数据模型与可撤销迁移 |
| S2.6 React Flow 可复现 bug | 局部已有 | 已修复若干跳转/展开问题；尚未形成只按复现步骤验收的清单 |
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
4. [ ] 运行带真实测试账号的 authenticated backend smoke，确认三种 `mode` 可写入、读取和清理；当前未提供 `MINDGROW_ACCESS_TOKEN`，不以匿名结果替代。
5. [ ] 合并前端并等待 Vercel/GitHub Pages 对应提交成功。
6. 若任一阶段失败，先停止后续发布；数据库回滚使用 `supabase-v12-map-mode-rollback.sql`，阿里云函数回滚到 API `10.5.2`。
