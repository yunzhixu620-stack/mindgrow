# S2.12 查询时 GraphRAG 定位

## 用户可见变化

- 知识问答会先判断查询属于精确查找、局部关系、多跳链路或全库概览，再选择 1–2 跳图谱路径与文档候选。
- 同名实体优先结合类型、别名和来源标题消歧；仍无法唯一判断时明确要求用户选择，不静默猜测。
- 文档向量召回、关键词召回与实体图证据进入同一个可解释排序器；回答仍只使用可核验引用，没有足够证据时拒答。
- 问答中的“检索链路”会标记当前路由：精确查找、局部关系、多跳链路或全库概览。

## 排序与检索设计

排序分数由六类 0–1 信号组成：实体锚点 28%、语义 24%、词面 18%、图路径 14%、来源元数据 10%、时效 6%。否定、历史和提案状态只在问题没有主动询问该状态时施加惩罚。

- Supabase `hybrid_search_document_chunks_v2` 分别返回 semantic/keyword 的 rank 与原始 score，同时保留 RRF 分数。
- 后端优先调用 v2；升级窗口内如果 v2 尚不可用，会临时回退原 v1 RRF，避免直接中断问答。
- `/health.checks.graphRagRanking` 必须为 `ready` 才能通过正式发布门禁，防止长期停留在兼容回退。
- 图谱关系证据的语义信号来自已约束的图遍历分数，词面信号来自引用原文；不会因为它不是普通文档 chunk 就被错误记为 0。

## 冻结评测与 S2.20 样本启动

冻结集当前有 12 个排序 case：文章 6、会议 3、知识碎片 3；另有 4 个实体链接 case 和 4 个查询路由 case。覆盖别名、同名实体、类型/来源消歧、否定关系、历史与当前状态、负责人、截止日期、多跳路径、全库概览和数值精确查找。

首次标定在不修改金标的前提下得到：Recall@5 100%、MRR 65.28%、实体 Hit@5/Top-1/歧义/路由 100%。根因是直接图谱证据的语义与词面信号被记为 0。修正信号来源与“是否”问句的否定关系策略后：Recall@5 100%、MRR 100%，其余指标保持 100%。

这只是与 S2.12 并行启动 S2.20 的样本收集，不代表三板块各 20 case 的完整产品测评已经完成。

## 关键文件

- `fc-proxy/index.js`：查询路由、实体消歧、文档/图谱混合候选、六信号排序、拒答链路和健康检查。
- `supabase-v15-graphrag-ranking-migration.sql`：新增兼容 v2 RPC 和独立稀疏/语义信号。
- `supabase-v15-graphrag-ranking-rollback.sql`：只删除 v2 RPC，保留原 v1 检索能力。
- `tests/fixtures/graphrag-ranking-cases.json`：冻结金标。
- `scripts/graphrag-ranking-benchmark.js`：Recall@5、MRR、实体链接、歧义和路由门禁。
- `src/components/chat/chat-panel.tsx`、`src/components/modes/article-parser.tsx`：检索路由可见解释。

## 数据、安全与性能边界

- RPC 继续按 `workspace_id + map_id` 过滤，只授予 `service_role` 执行；不新增匿名或登录用户直连权限。
- 不改变鉴权、SSRF 规则、citation verbatim 校验或文档存储结构，不增加 npm 依赖。
- 候选读取上限 60，进入统一重排的候选预算为精确/局部 12、漂移/全局 16；图遍历最多 2 跳，避免无界扩散。
- v15 是函数新增，不重写已有表和数据；数据库风险与锁时长低。

## 发布与回滚

发布顺序：先执行 v15 migration 并确认 RPC 可调用，再部署 API 10.12.0，最后发布前端并运行 production fact、公网 E2E 和后端 smoke。

回滚顺序：先把阿里云函数回滚到 10.11.0，再运行 `supabase-v15-graphrag-ranking-rollback.sql`；原 `hybrid_search_document_chunks` v1 不受影响。若只回滚前端，路由标签会消失，但后端检索仍可工作。

## 本地与数据库验收（2026-07-23）

- Supabase v15 migration 已在 mindgrow production project 执行成功；控制台事务返回 `Success. No rows returned`。
- GraphRAG 冻结评测：Recall@5/MRR/实体 Hit@5/实体 Top-1/歧义/路由均为 100%。
- RAG 回归 64/64、单元测试 171/171、本地后端 9/9、产品 E2E 37/37；lint、生产构建、API 版本和部署身份门禁通过。
- 改动差异的密钥格式扫描为 0 命中；构建生成的 `out/` 没有进入提交。
- 阿里云 10.12.0、前端 GitHub Pages 和公网门禁必须等 PR/CI 合并后执行，尚未在本节冒充已发布。
