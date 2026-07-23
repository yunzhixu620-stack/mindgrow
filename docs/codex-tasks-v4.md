# MindGrow · Codex 任务书 v4

> 状态：Owner 已确认 Sprint 0 补丁与后续主线，可以按 §2 主顺序实施。
>
> 版本目标：成为替代 v1/v2/v3 与 UX 补充文档的自包含执行底座。旧文档只作为审计记录，实际开发以本文件为准。

## 0. Owner 开工前确认

以下为 v4 默认决策。Owner 如果没有提出异议并明确回复“开工”，即视为全部采用。

1. 实体图质量 P2.1 是 P0 发布阻断项。
2. 新生成的实体没有可核验证据支持的 description 时不进入正式实体图；历史旧数据允许详情面板显示“原文未直接说明”。
3. 关系引用同时出现 source 和 target 只是必要条件，还必须命中关系谓词、方向模板或独立支持度判定。
4. 中文 shortLabel 允许 2–10 字，其他语言允许 2–20 字符；不得包含状态、证据数或括号元信息。
5. descriptionEvidence 是 description 专属证据，不能用只证明实体“出现过”的 citationIndexes 代替。
6. 实体质量 CI 使用冻结的本地样本；真实 URL + 真实模型评测走 nightly/人工流程，不作为不稳定的合并阻断。
7. P2.1 只解决 GraphRAG 建图质量；查询时实体消歧、混合召回、路径重排与定位准确率由 S2.12 继续解决。
8. U8 是新增亮色主题并保留现有深色主题，不是“再做一次深色模式”。
9. U10 替换现有移动端顶部 tab，不叠加第二套导航。
10. U1 挂载到右上角“使用指南”对应的 /guide 页面，使用构建期 node:fs，不使用 ?raw。

补充边界：

- P2.1 不做跨 map 实体链接，不做查询意图消歧，不做召回路径重排；这些属于 S2.12。
- S2.20 的 case 收集与 S2.12 并行启动，不拖到 Sprint 2 末尾；先积累真实使用样本，再完善自动化脚本。

## 1. v4 解决的问题总表

| 来源 | 已知问题 | v4 处理 |
|---|---|---|
| v1 | 未建立可执行的单测和本地后端门禁 | P0.0 完整建立 Vitest、本地 smoke、runbook |
| v1 | 生产可能落入匿名模式 | P0.1 fail-closed + health 断言 |
| v1 | URL 解析存在 SSRF、重定向绕过和 DNS rebinding 风险 | P0.2 固定验证 IP并逐跳重校 |
| v1 | 切换账号、工作区或知识库时残留旧租户数据 | P1.0/P1.1 完整 reset、租户 key、请求取消 |
| v2 | hydrate 被拒后仍可能污染 cache | P1.0 三层快照，server 与 local overlay 分离 |
| v2 | 本地 mutate 不同步 cache | mutateGraphLocally 同步写 local overlay |
| v2 | 原地修改可能漏触发 Zustand 订阅 | 引入 Immer 并测试 |
| v2 | 移动端和桌面端各有一套 loader | P1.3 统一 loader |
| v2 | Citation 有编号但 quote 未必来自原文 | P2.0 verbatim 卡点 |
| v2 | 整体引用率掩盖单条 Claim 无证据 | P2.0 perClaim 审计 |
| v2 | 翻译 usedSourceIds 类型被错误假设 | P2.0.4 先出类型报告，Owner 确认后实施 |
| v3 | U2 用两个独立 revision 大小判断 dirty 不可靠 | P1.4 改为 local overlay + 写入版本令牌 |
| v3 | lastWriteSucceededAt / lastWriteError 为全局值会串图 | P1.4 改为 ByMap |
| v3 | P2.1 与 P2.0/P3.0 被描述为完全并行 | §2 改为子任务级依赖 |
| v3 | normalizedEntityGraph 会丢掉 P2.1 新字段 | P2.1.2 明确服务端归一化和字段贯通 |
| v3 | 一个关键词重叠即可通过 description | P2.1.2 改为实体命中 + 有效锚点覆盖 |
| v3 | source/target 共现被误当成关系成立 | P2.1.2 增加谓词、方向或支持度验证 |
| v3 | shortLabel 3 字下限与“使用/依赖/提出”冲突 | 统一为中文 2–10 字 |
| v3 | 过滤空 description 后仍要求新数据展示空警告 | 空警告只兼容历史数据 |
| v3 | 评测在过滤后统计会天然高分 | P2.1.6 同时统计 raw、accepted、retention 和人工精度 |
| v3 | 真实 URL 直接进入 CI 不稳定 | 冻结 fixture 进 CI；live benchmark 独立 |
| v3 | U9 只看 nodes/modeLibraryBusy 仍可能误闪 | 增加 catalogReady、当前库与 onboarding 状态 |
| v3 | U1 非法 tag 被强制 cast 为合法联合类型 | 严格白名单；非法 entry 丢弃并在测试中断言 |

## 2. 强制依赖与合并顺序

### 2.1 主顺序

~~~
Sprint 0 hotfix 前置（§2.3）
H0.0 大知识库可打开
        ↓
H0.1 无证据强制拒答
        ↓
H0.2 统一 URL 抓取 + arXiv 降级
        ↓
H0.3 输入来源互斥
        ↓
H0.4a 文章超时、阶段错误与失败阶段重试
        ↓
Owner 验收 Sprint 0
        ↓
P0.0.1 Vitest ───────→ U1 使用指南 Timeline（只依赖 P0.0.1）
P0.0.2 本地后端门禁
P0.0.3 API 版本/runbook
        ↓
P0.1 鉴权 fail-closed
        ↓
P0.2 SSRF
        ↓
P1.0 三层租户缓存 + Immer + reset
        ↓
P1.1 page/Universe 迁移
        ↓
P1.3 桌面/移动统一 loader
        ↓
P1.2 双账号隔离 E2E
        ↓
P1.4 写入/同步状态模型
        ↓
P2.0.1 精确匹配与集中导出
        ↓
├─ P2.0.2 / P2.0.3 / P2.0.4 / P2.0.5
├─ P2.1.1 / P2.1.2 / P2.1.3 / P2.1.5 / P2.1.6 / P2.1.7
└─ P3.0.1 /health warm
        ↓
P3.0.2 骨架屏 + U3
        ↓
H0.4b 文章五阶段视觉进度（与 P3.0.2 同 PR）
        ↓
P2.1.4 实体详情面板
        ↓
P2.2 会议固定输出结构
        ↓
P2.3 关联补充复用旧节点
        ↓
U4 → U7 → U9 → U10 → U5 → U2 → U8
~~~

P2.1 的范围只到单文档/单会议建图、正式实体与关系的证据质量和可见解释。跨 map entity linking、查询意图消歧、候选召回与路径重排不得夹带进 P2.1。

### 2.2 不能并行的文件

| 文件 | 任务 | 约束 |
|---|---|---|
| fc-proxy/index.js | H0.0、H0.1、H0.2、P0.1、P0.2、P2.0、P2.1、P2.2、P2.3 | 按主顺序串行 rebase；P2.1 至少等待 P2.0.1 |
| src/app/page.tsx | H0.0、P1.1、P1.3、P3.0.2、U9、U10 | 严格串行 |
| mind-map-panel.tsx | P3.0.2、P2.1.4、U7 | P3.0.2 → P2.1.4 → U7 |
| universe-view.tsx | P1.1.2、P2.1.4、U7 | P1.1.2 → P2.1.4 → U7 |
| article-parser.tsx | H0.3、H0.4a、H0.4b、P2.0.3/U6 | H0.3 → H0.4a；H0.4b 与 P3.0.2 合并 |
| meeting-assistant.tsx | P2.0.3/U6、P2.2 | P2.0.3/U6 → P2.2 |
| header.tsx | U4、U2、U8 | 串行 |
| layout.tsx | P3.0.1、U5、U8 | 串行 |

### 2.3 Sprint 0 hotfix 前置

真实产品测试暴露的三个核心链路问题，以及 336 节点会议库无法打开的问题，会阻断后续 fixture 回归。因此在 v4 原主线前增加 Sprint 0；Sprint 0 只修可用性、正确性和恢复能力，不夹带实体详情、Universe 视觉或跨库检索。

#### H0.0 · 大知识库必须可打开

事实基准：

- `QA-真实测试-TC39会议-20260723`：336 个原始节点；
- 当前表现为整库加载失败，会议图谱区域无法使用；
- 节点和原始会议内容不得因性能修复而删除、合并或降级。

要求：

1. `node_citations`、文档和其他 `in.(...)` 查询必须分批，禁止把数百个节点 ID 拼进单个请求；
2. 图快照只选择前端需要的字段，不使用无边界 `select=*`；
3. Citation 或实体图增强数据暂时失败时，先返回可用的概念图，并明确返回子资源状态；不得让单个增强服务拖垮整库；
4. 首屏只渲染有限主干和下一层，原节点完整保留，用户逐级展开；
5. 增加 336 节点冻结 fixture，覆盖分批完整性、节点不丢失、增强数据降级和前端可恢复状态。

验收：

- 336 节点会议库接口返回 200，节点总数与库记录一致；
- 页面不再显示“会议知识库暂时不可用”；
- 默认首屏不同时挂载全部 336 张节点卡片；
- Citation 暂时失败时仍可打开概念图，重试后可补齐引用；
- 记录接口耗时、返回体大小、布局耗时和首个可交互时间的 baseline。

#### H0.1 · 无证据强制拒答

定位 `fc-proxy/index.js` 中 evidence 组装后、任何回答模型调用前的分岔点。

要求：

- `retrievalTrace.candidateChunks === 0` 且实体证据为 0 时，不得进入回答模型；
- 即使候选数大于 0，若过滤后不存在带原文 quote 的 `document_chunk` 或 `entity_graph_evidence`，同样拒答；
- 保持现有前端接口契约，固定返回：

~~~json
{
  "reply": "当前知识库没有相关证据",
  "sources": [],
  "abstained": true,
  "refusalReason": "NO_EVIDENCE"
}
~~~

- 不新增另一套 `answer/citations` 同义字段，避免前后端出现双协议；
- 仍保留只含计数和阶段的 retrievalTrace，禁止泄露敏感内容。

回归：

- F10 输入断言固定 reply、`sources=[]`、`refusalReason=NO_EVIDENCE`；
- 断言回答模型调用次数为 0；
- 增加“存在候选节点但没有直接原文证据”的用例，同样必须拒答。

#### H0.2 · 统一 URL 抓取链路

事实基准：同一 arXiv URL 在知识碎片可成功，在文章解析长时间失败，说明两个产品入口没有复用一个完整的来源准备服务。

要求：

1. 建立唯一的 `readArticleSource`/等价服务，知识碎片与文章解析只调用它；
2. 服务内部统一复用 `assertPublicUrl`、`fetchArticleText`、逐跳 SSRF 重校、超时、正文抽取、重试和错误码；
3. arXiv 顺序为 HTML 正文 → 官方 PDF；每次降级仍执行 SSRF 与大小限制。HTML 与 PDF 都无法提取可核验正文时必须拒绝，不得用摘要 metadata 冒充全文；
4. PDF 无法提取足够原文时明确失败，不允许拿标题或 URL 猜测正文；
5. A01–A10 十篇 LLM Wiki 相关文章 URL、F07/F08 链接输入全部复跑，输出逐条成功/失败、耗时、正文字符数和降级路径。

#### H0.3 · 输入来源残留清除

文件：`src/components/modes/article-parser.tsx`。

要求：

- URL、PDF、正文是互斥的单一来源；
- 输入 URL 时清空 PDF 文件对象、文件控件 value 和正文 raw state；
- 选择 PDF 时清空 URL 与正文 raw state；
- 输入正文时清空 URL、PDF 文件对象和文件控件 value；
- 提交函数只从当前 source kind 构造请求体，不得把隐藏输入带入 API。

回归：粘贴 URL → 切换正文 → 提交，断言请求体没有 `url`、旧 `fileName`、旧 `mimeType` 或旧 PDF extraction。

#### H0.4 · 文章解析可恢复任务

H0.4 拆为可靠性与视觉两层，不能把“等待 100 秒后只显示解析失败”的产品阻断整体延后。

H0.4a（Sprint 0 / P0）：

- 后端与前端共享五阶段 ID：读取网页 → 提取正文 → 生成摘要 → 定位引用 → 构建图谱；
- 每阶段有独立错误码、开始/结束时间和有界超时；
- 读取或提取失败时重试来源阶段；摘要、引用或图谱失败时复用已准备正文，不重复抓取 URL；
- 前端在有界时间内进入明确失败态并显示“重试失败阶段”，禁止无限等待或只显示通用错误。

H0.4b（P1，与 P3.0.2 同 PR）：

- 五阶段可视化、骨架屏、完成/失败状态与移动端适配；
- 视觉层复用 P3.0.2 loading 组件，不再创建第二套 spinner。

#### Sprint 0 fixture 与发布门禁

冻结基准库：

- `QA-真实测试-知识碎片-20260723`（135 节点）；
- `QA-真实测试-LLMWiki文章-20260723`（37 节点）；
- `QA-真实测试-TC39会议-20260723`（336 节点）。

三库只作为回归基准，禁止测试脚本删除、合并或重写原始数据。先保存脱敏后的冻结输入与预期断言；真实生产库只用于人工 smoke，不直接进入不稳定 CI。

## 3. 全局执行规则

1. 每个 PR 只完成一个编号子任务；确实要求合并的 U3/U6 除外。
2. PR 标题使用 [P0.0.1]、[P2.1.4] 或 [U7]。
3. 禁止修改 out/ 与 .next/。
4. 禁止在日志、截图、fixture 或 PR 中输出 Authorization、Supabase key、DashScope key、SMTP 密钥和服务角色密钥。
5. 生产数据、数据库结构或云配置变更必须提供回滚路径。
6. 任务未覆盖的产品分歧先写选择项、推荐项和影响，等待 Owner 确认。
7. 每个 PR 至少运行：

~~~
npm run check:api-version
npm run lint
npm run build
npm run test:unit
npm run test:rag
npm run test:e2e:local
npm run test:backend:local
~~~

纯前端 PR 可以省略 test:backend:local，但必须写明原因。缺少外部测试账号时可以 skip 双账号 E2E，但不得宣称发布门禁已通过。

## 4. Sprint 1 · 安全、正确性、性能和核心 UX

### P0.0 · 测试底座与运行手册

#### P0.0.1 · Vitest

文件：

- package.json
- vitest.config.ts
- .gitignore
- src/lib/__tests__/smoke.test.ts

要求：

- 使用 Vitest 2 和 coverage-v8。
- test:unit 使用 vitest run。
- environment 为 node；alias @ 指向 src。
- include 覆盖 src 下 test.ts 和 test.tsx。
- 显式 passWithNoTests: true，同时保留 smoke test。
- .gitignore 加 coverage/。

验收：test:unit 退出码 0；故意制造失败断言时退出码非 0，随后还原。

#### P0.0.2 · 本地后端与公网 smoke 分离

文件：

- package.json
- scripts/backend-smoke.js
- scripts/run-backend-local.js

要求：

- backend-smoke 从 MINDGROW_API_BASE 读取目标地址。
- test:backend:public 指向线上地址，仅人工运行。
- test:backend:local 由 run-backend-local.js 统一编排：
  1. 启动 fc-proxy/index.js 子进程；
  2. 等待 127.0.0.1:9000/health 为 200；
  3. 以本地 base 运行 smoke；
  4. 无论成功或失败都在 finally 终止子进程；
  5. 透传 smoke 退出码。
- CI 只允许运行 local，不允许以公网 smoke 代替本地正确性。
- 使用 cross-env 保持 Windows/macOS/Linux 一致。

验收：端口占用、后端启动失败、smoke 失败三种情况都能非 0 退出且不遗留进程。

#### P0.0.3 · API 版本与 runbook

文件：

- fc-proxy/index.js
- docs/api-version.txt
- scripts/check-api-version.js
- docs/operations-runbook.md
- package.json

要求：

- fc-proxy 中 API_VERSION 是运行时权威值。
- docs/api-version.txt 是 CI 校验镜像，不称为第二个真源。
- 发版顺序固定为：先修改 fc-proxy/index.js 的 API_VERSION，再在同一 PR 同步 docs/api-version.txt；check:api-version 通过即可提交。
- check-api-version 比较两者，不一致退出 1。
- runbook 不写死旧版本号，要求 health.version 与镜像一致。
- PR 命令增加 check:api-version。

验收：一致时通过；临时改错镜像时失败并还原。

### U1 · 使用指南版本 Timeline

依赖：P0.0.1。可以与 P0.0.2/P0.0.3 并行。

#### U1.1 · 数据源

文件：

- docs/changelog.md

要求：

- changelog 标题格式为：二级标题 + 日期 + 版本 + tag。
- tag 仅允许 milestone、feature、performance、fix、security。
- 内容由简短标题和项目符号组成，目标是让用户 30 秒理解产品演进。

#### U1.2 · 构建期解析

文件：

- src/lib/changelog.ts
- src/lib/__tests__/changelog.test.ts

要求：

- 非法 tag、无标题或非法日期 entry 丢弃；不得用 TypeScript cast 假装合法。
- loadChangelog 只在 Server Component 构建期通过 node:fs 读取。
- 不修改 next.config，不使用 ?raw，不引入 raw-loader。
- parser 兼容 CRLF/LF并按日期倒序。

#### U1.3 · Timeline 组件

文件：

- src/components/guide/version-timeline.tsx

要求：

- 新组件 test id 为 version-timeline，不复用 guide-timeline。
- renderer 支持列表、粗体、安全链接和普通换行；链接仅接受 http、https 或站内相对路径。
- 外部新窗口链接增加 rel=noopener noreferrer。

#### U1.4 · 挂载

文件：

- src/app/guide/page.tsx

要求：

- 挂载到 /guide，保留现有 workflow timeline。

#### U1.5 · 验收

验收：parser 覆盖合法、CRLF、非法 tag、缺标题、排序和安全链接；静态 build 后 /guide 可打开。

### P0.1 · 鉴权 fail-closed 与 health 断言

依赖：P0.0.2。

文件：

- fc-proxy/index.js
- scripts/backend-smoke.js
- docs/operations-runbook.md

要求：

- AUTH_REQUIRED 关闭时，只有非 production 且 ALLOW_ANON_LOCAL=true 才允许 local_test_user。
- 生产或配置错误时拒绝匿名，不得静默降级。
- health 输出 authRequired、nodeEnv、allowAnonLocal，但不输出密钥或内部 URL。
- smoke 验证匿名知识请求被拒绝、health.authRequired 为 true。
- runbook 将生产 authRequired 非 true 记为 SEV0。

验收：所有现有 smoke 加新增断言通过；不要用固定“7 条”作为长期验收条件。

### P0.2 · SSRF 固定 IP 与逐跳重校

依赖：P0.1。

文件：

- fc-proxy/index.js
- 对应 Vitest 测试

要求：

- 只允许 http/https，拒绝带用户名密码的 URL。
- DNS 解析所有候选地址；私网、环回、链路本地、保留、组播、文档网段和不可分类地址全部拒绝。
- 当前实现若不能完整安全支持 IPv6，则显式拒绝 IPv6，不允许回退到系统自动解析。
- 从验证通过的公网 IPv4 中固定一个地址发起请求，防 DNS rebinding。
- HTTPS 连接使用固定 IP，但 TLS servername 与 Host 保留原 hostname。
- 禁止自动跟随重定向；每一跳重新解析、验证、固定 IP。
- 最大 3 次重定向；拒绝协议降级、无 Location、循环跳转和超大响应。
- 设连接、首字节和整体超时；限制内容长度和允许的 Content-Type。

测试：

- 127.0.0.1、10/8、172.16/12、192.168/16、169.254/16、0/8、保留网段；
- 十进制/十六进制 IP、混合大小写 hostname、尾点、重定向到内网；
- DNS 第一次公网第二次内网；
- HTTPS SNI/Host 保持原域名；
- 正常公开网页成功。

### P1.0 · 三层租户缓存、Immer 与 reset

#### P1.0.0 · Immer

文件：package.json、store 单测。

要求：使用 Immer 10；对 Set 使用 enableMapSet；所有 recipe 产生新的可观察状态。

#### P1.0.1 · tenant-cache

文件：

- src/lib/tenant-cache.ts
- src/lib/__tests__/tenant-cache.test.ts

数据模型：

- TenantScope：userId + workspaceId。
- GraphSnapshot：nodes + edges + entityGraph。
- CachedMapGraph：server snapshot、可选 local overlay、storedAt、localBaseEpoch。
- Universe cache 同样必须按 tenant scope 分区。
- pending write 不伪装成 server snapshot；其生命周期由 P1.4 管理。

规则：

- tenant key 必须包含 user、workspace、map。
- read 时 local overlay 优先于 server。
- 旧请求只能更新与其 base epoch 匹配的 server snapshot。
- local 存在时服务器旧响应不得覆盖 local。
- clear local 必须由匹配的写入成功确认或明确撤销触发。
- clearAllTenantCache 幂等并通知订阅者。

测试：租户唯一性、旧请求、local 优先、写入期间继续编辑、清理幂等和 Universe 隔离。

#### P1.0.2 · Store 双通道

文件：

- src/store/mindgrow-store.ts
- src/store/__tests__/mindgrow-store.test.ts

要求：

- hydrateGraphFromServer 只处理服务器响应。
- mutateGraphLocally 只处理本地用户修改，并同步写 local overlay。
- 使用 Immer recipe，禁止调用者直接修改 Store 数组。
- hydrationEpochByMap 与 localEditVersionByMap 都是因果令牌，不进行大小比较来判断 dirty。
- dirty 的权威来源是该 map 是否存在未确认的 local overlay。
- resetTenantContext 清理 map、node、edge、entityGraph、消息、搜索、选中态、折叠态、历史和所有 revision/epoch。

#### P1.0.3 · 登录/退出清理

文件：auth-provider 与相关测试。

要求：

- 使用 nextSession.user.id 判断换号。
- SIGNED_OUT、显式 signOut 和 token 失效都走同一个幂等 reset。
- 换号时先清 store/cache，再加载新用户 workspace。
- 清理函数重复调用不报错、不恢复旧数据。

### P1.1 · 页面和 Universe 迁移

#### P1.1.1 · page loader

文件：src/app/page.tsx、竞态测试。

要求：

- 每次请求记录 scope、mapId、request token、base hydration epoch。
- 新请求 abort 前一个同资源请求。
- 返回后校验 token、scope 和 currentMapId。
- local overlay 存在时不覆盖 UI；server 响应只按 cache 规则记录。
- 切 map 可以先读对应 tenant cache，再后台 revalidate。
- 切 workspace 立即清屏，不展示前一租户缓存。
- maps 依赖使用稳定 signature，避免数组引用造成重复请求。

#### P1.1.2 · Universe loader

文件：src/components/universe/universe-view.tsx、Universe 测试。

要求：

- 删除模块级无租户 universeCache，迁移到 tenant cache。
- fetchUniverseLibraries 接受 AbortSignal。
- effect cleanup 必须 abort。
- 新请求只允许覆盖相同 tenant scope。
- 聚合接口失败时兼容旧接口，但需保留超时、取消和失败数量提示。

### P1.3 · 桌面与移动端统一 loader

依赖：P1.1。

文件：src/app/page.tsx 和相关组件。

要求：

- 删除移动端自建加载分支。
- 桌面和移动端切 map 都调用 handleSwitchMap。
- currentMode、map 选择、cache hydrate 和后台请求只有一套状态机。
- 模式切换先原子清理板块专属响应，防文章/会议/碎片互串。

### P1.2 · 双账号隔离 E2E

依赖：P1.3。

要求：

- 账号 A/B 拥有不同 workspace 与 map 内容。
- A 登录加载 A；退出后不残留 A 的名称、节点、消息或 Universe。
- B 登录只看到 B；切回 A 仍正确。
- 覆盖快速换号、慢请求晚返回、浏览器刷新。
- 缺测试账号时明确 skipped + exit 0，但发布清单仍显示“未验证”。

### P1.4 · 写入与同步状态模型

依赖：P1.0–P1.3。U2 的硬前置。

文件：

- src/store/mindgrow-store.ts
- src/lib/client-api.ts
- src/lib/use-sync-status.ts
- 对应测试

数据：

- pendingWritesByMap
- lastWriteSucceededAtByMap
- lastWriteErrorByMap
- networkOnline
- 每次写入携带 mapId 和 localEditVersionAtStart

规则：

1. GET 和模型读取请求不改变同步灯。
2. 写请求 begin 时记录 mapId、requestId、发送时 local edit version。
3. 成功时：
   - 若当前 local edit version 等于发送版本，确认写入、更新 server snapshot、清 local overlay；
   - 若期间又发生编辑，只确认旧版本，保留 local overlay 和 dirty。
4. 失败时保留 local overlay并记录该 map 的错误；不得污染其他 map。
5. dirty = 当前 map 存在 local overlay且没有被本次成功确认；不得比较 serverRevision 与 localRevision 的数值大小。
6. offline 来自 navigator.onLine 和 online/offline 事件，监听只注册一次并可清理。
7. 错误信息需脱敏。

状态优先级：

~~~
offline
→ syncing
→ recent error
→ dirty
→ idle
~~~

### P2.0 · Citation 真实性、Claim 支持度与回答呈现

#### P2.0.1 · 精确匹配工具与集中导出

文件：fc-proxy/index.js、citation 单测。

要求：

- normalizeForExactMatch 只做确定性规范化，不做 n-gram 模糊放行。
- isVerbatimQuote 确认 quote 来自允许的 source chunk。
- fc-proxy 只在文件末尾组装一次 module.exports。
- citation、SSRF、entity internal 测试入口都合并到最终导出对象，禁止先挂属性再被整体覆盖。

#### P2.0.2 · Citation 写入前卡点

要求：

- Citation 编号必须在 allowedIndexes 中。
- quote 规范化后必须是对应 sourceChunks.content 的逐字片段。
- locator 和 source 类型存在。
- 无效 citation 删除；删除后 Claim 无证据则进入 perClaim unsupported。
- 不允许 bestCitationIndexes 自动制造“逐字引用已验证”的假象。

#### P2.0.3 · perClaim 审计 + U6

文件：

- fc-proxy/index.js
- src/components/answer/answer-card.tsx
- article-parser.tsx
- meeting-assistant.tsx

要求：

- citationAudit 返回 perClaim，并区分 supported/unsupported。
- 任一关键 Claim 不支持时单独标记；关键 Claim 全不支持时拒答。
- 回答统一三段：结论、证据、AI 延伸。
- 引用 chip 显示来源、短 quote 和 locator；hover 展开；点击滚动并高亮 3 秒。
- PDF 本轮只显示 locator，不宣称已在 PDF Viewer 中定位。

#### P2.0.4 · 翻译 usedIds 类型报告

要求：

- 第一 PR 只读追踪 translate 分支，报告 usedSourceIds、citation index、evidence id 与 allowedIds 的真实类型。
- 不记录敏感正文和 token。
- 给出数字索引、字符串节点 ID、双通道三个候选方案及兼容影响。
- Owner 确认后第二 PR 才实现。

#### P2.0.5 · 句子级 Citation 与元数据分离

依赖：P2.0.1、P2.0.2；P2.2 会议结构化必须等待本项。

文件：

- fc-proxy/index.js
- src/types/index.ts
- 文章、会议 Citation 展示与对应测试

要求：

1. 每条 citation 绑定一个独立原文句子，不得把整段摘要重复绑定给多个结论；
2. 返回 `charStart`、`charEnd` 和 `sentenceIndex`，offset 以清洗前保存的规范化正文为坐标基准，并满足 `source.slice(charStart, charEnd) === quote`；
3. PDF 同时保留 page/locator；未建立页面坐标映射前不宣称 Viewer 高亮；
4. URL、文档标题、会议标题、议题名、参会人等只进入 document metadata；
5. claim extraction、结论、决议和行动项只能读取正文/会议发言区，禁止把 metadata 当作结论证据；
6. Verbatim 门禁继续生效；offset 不一致的 citation 不进入正式结果。

验收：

- 同一段中的两个不同 Claim 分别绑定支持它们的原文句子；
- 十个节点不得全部复用一个整段 quote；
- 会议标题包含结论式文案时，正文没有该结论则不得输出；
- 中文、英文、页码文本与换行规范化均有 offset 回归。

#### U6.2 · PDF 原文高亮（本轮退役并迁移）

旧 UX 文档中的 U6.2 不在 Sprint 1 实施。原因是当前产品只有 PDF 文本抽取，没有内嵌 Viewer、页面坐标映射和 findController。该任务完整迁移为 S2.11；Sprint 1 的 P2.0.3 只能显示 PDF locator，不能宣称已经在 PDF 原文中定位或高亮。

### P2.1 · 实体图质量 P0

目标：让实体图中的每个正式实体都能回答“它在本文中是什么意思”，让每条正式关系都能回答“为什么这样连接”。

#### P2.1.1 · Prompt 与类型

文件：

- fc-proxy/index.js
- src/types/index.ts

实体字段：

- tempId、name、type、aliases
- description：本文语境下 30–80 字的一句话解释
- descriptionEvidence：description 专属 citation 编号，至少一条
- citationIndexes：证明实体在文中出现或参与事实
- confidence

关系字段：

- source、target、type
- shortLabel：中文 2–10 字，其他语言 2–20 字符
- explanation：20–60 字说明关系具体含义
- status、citationIndexes、confidence
- label 仅作为旧数据兼容，不再作为新输出主字段

Prompt 规则：

- 原文不能支持 description 时输出空，后续会丢弃。
- 每条关系必须有方向与直接证据。
- aliases 只输出原文或常识性缩写可可靠推断的别名，不强制编造中英文双别名。
- 不输出证据数和状态到 shortLabel。

节点预算：

- 知识碎片短文本：4–8 个可视节点；
- 知识碎片长文本：10–20 个可视节点；
- URL：首层及默认可视节点合计 12–20 个；
- 文章和会议默认可视节点不超过 20 个；
- 预算同时写入 Prompt 和服务端确定性后处理，不能只相信模型遵守；
- 超出预算的原文、document chunks、citation 与检索索引完整保留，只限制默认平铺展示；
- 前端使用分级展开，每次只展开下一层，不得一次递归展开全部后代。

#### P2.1.2 · 服务端归一化与证据门禁

文件：fc-proxy/index.js。

必须显式修改 normalizedEntityGraph，不能只改 prompt。

实体验证：

1. descriptionEvidence 只接受模型明确给出的合法编号，不自动回填。
   - 明确禁止从 citationIndexes 复制、取子集、求交集或以其他方式派生 descriptionEvidence；字段缺失就是缺失，必须判为 description 无专属证据。
2. 至少一条证据 quote 命中 canonical name 或 alias。
3. 去除停用词后，description 与 quote 至少命中两个有效锚点，或达到经过 fixture 标定的覆盖阈值。
4. description 中数字、百分比、版本号等必须在 quote 精确出现。
5. 不通过时 description 清空；正式输出阶段丢弃该实体。

关系验证：

1. citation quote 同时命中 source 和 target 的 canonical name 或 alias。
2. quote 还必须命中 type 对应的谓词/方向模板，或通过独立 relation-support 判定。
3. shortLabel 不合法时使用 relation type 映射；不做破坏语义的硬截断。
4. explanation 超长时按完整句边界裁剪；无证据支持时丢弃关系。
5. 被实体过滤后，指向失效实体的关系同步丢弃。

覆盖阈值门禁：

- 首次实现必须随 PR 提交 fixture 标定报告，至少包含样本构成、tokenize 后有效锚点分布、候选阈值对 precision/retention 的影响和建议初值。
- 在 Owner 确认建议初值前，不得把覆盖阈值 hardcode 为合并后的正式常量。

字段贯通：

- normalizedEntityGraph 保留 descriptionEvidence、shortLabel、explanation。
- GraphEntity 增加 descriptionCitations 或等价的专属证据字段。
- GraphRelation 保留 explanation。
- aiEntityGraphToEntityGraph 使用 shortLabel → legacy label → type 映射的顺序。
- KnowledgeEdge 若用于关系 hover，增加 relationId、relationStatus、relationExplanation 或提供可靠的 relation lookup，不得靠字符串解析。

#### P2.1.3 · 前端正式图过滤

文件：

- src/lib/entity-graph.ts
- src/types/index.ts
- 对应单测

规则：

- canonicalName 非空；
- description trim 后满足最低有效长度；
- descriptionCitations 至少一条；
- citation quote 已由服务端验证；
- 关系只连接仍存在的实体；
- 主标签只显示 shortLabel，状态改为独立 chip，证据数不拼进边标签。

历史数据兼容：旧实体可以进入只读详情并显示“原文未直接说明”，但不得伪装为已通过 v4 grounding。

#### P2.1.4 · 实体详情与关系交互

依赖：P3.0.2；完成后 U7 才能开始。

开始前 dependency check：

- 确认 mind-map-skeleton 已合并；
- 确认 showSkeleton 或等价加载态可以复用；
- 若加载态接口不存在，先回到 P3.0.2 补齐，不在 P2.1.4 重复创建 loading spinner。

文件：

- src/components/entity/entity-detail-panel.tsx
- src/components/mindmap/mind-map-panel.tsx
- src/components/universe/universe-view.tsx
- 必要类型与测试

面板内容：

1. canonical name、类型和 alias chips；
2. 一句话 description；
3. description 专属证据，显示 quote 与 locator；
4. 相关关系列表：shortLabel + 对端实体；展开显示 explanation 与 citation；
5. “在本图定位”和“进入所属知识库”是两个不同动作。

知识宇宙数据链路：

- GraphNode 增加 refKind 与 refId，至少区分 library、knowledge-node、entity。
- 点击实体打开详情；点击库/普通节点进入所属知识库。
- Canvas 关系 hover 需要线段命中检测和 hoveredLink，不得复用节点命中假装完成。
- GraphLink 保留 relationId、explanation、citations，而不是只有 label。

脑图：

- 实体节点通过稳定 entityId 定位。
- 关系边点击打开小卡片；hover 只显示 shortLabel。
- 面板关闭、键盘 Esc、移动端抽屉和无障碍焦点可用。

#### P2.1.5 · 确定性兜底

文件：fc-proxy/index.js 与单测。

要求：

- 兜底不生成空 description。
- definition extractor 使用 escapeRegExp、句子边界、最大长度。
- 支持中文“是/指/意为/定义为”和英文 is/refers to/defined as/stands for。
- 找不到定义或本文角色说明时不生成实体。
- 关系兜底必须在同一证据句中定位 source、target 和关系谓词。
- shortLabel 使用固定映射表并满足统一长度规则。
- 高精度优先，但评测必须监控 retention/recall，防止通过“全部删除”获得高分。

#### P2.1.6 · 两层评测集

文件：

- docs/entity-quality-benchmark.md
- tests/fixtures/entity-quality/*
- Vitest 质量测试
- scripts/entity-quality-live.js

CI 冻结集：

- 至少覆盖中文论文、英文论文、会议纪要、缩写/别名、否定关系、无定义实体、表格/数字。
- 输入是固定文本和固定期望，不访问公网，不调用收费模型。
- 测 raw output、验证器、accepted output 三个阶段。

Live benchmark：

- 10 篇代表性 URL/PDF 或固定样本；
- 记录模型名、prompt 版本、时间、延迟、token 和费用；
- nightly/人工执行，初期只 warning。

指标：

| 指标 | 初始要求 |
|---|---|
| rawDescriptionCoverage | ≥80%，在硬过滤前统计 |
| acceptedDescriptionGrounding | ≥90% |
| entityRetentionRate | 首次建立基线；不得通过清空图谱提升 |
| descriptionGroundingPrecision | 人工标注 ≥90% 起步 |
| shortLabelValidRate | ≥95% |
| relationPredicateSupport | ≥90% |
| relationPrecision | 人工标注 ≥85% 起步 |
| relationRecall | 先报告基线，连续版本不可无解释显著下降 |
| emptyGraphRate | 报告并设回归告警 |

rawDescriptionCoverage ≥80% 是产品目标，不是首次实现的合并准入门槛。若当前模型 + 当前 prompt 的 baseline 明显偏低，提交 baseline 报告、根因分布和提升方案即可，不因此阻断 P2.1.6 首次 PR。

验收：

- test:rag 全部现有用例通过，不依赖固定“46/46”文案。
- 固定集通过。
- 至少一篇 Owner 固定论文完成端到端人工验收。
- 每个正式实体有可见解释和专属证据；每条正式关系能解释方向与原文依据。

#### P2.1.7 · 关系产出率诊断与红线

并入 P2.1 评测集，不单独通过“增加关系数量”验收。

要求：

1. 对每个 fixture 记录模型 raw relations、服务端 accepted relations 和 filtered relations；
2. 每条被过滤关系记录稳定原因码，例如缺 source、缺 target、非同句共现、缺谓词、方向不支持、证据非 verbatim、实体已过滤；
3. 不允许在没有诊断报告时放宽过滤阈值；
4. 只有人工标注“存在至少 3 条关系机会”的 fixture 才要求 accepted relations ≥3；
5. 合法无关系或关系不足 3 条的正文允许输出 0–2 条，不得为了过数量门槛编造；
6. 关系类型优先固定为：proposes、supports、opposes、approves、responsible_for、due_on、depends_on、improves；
7. 每条正式关系包含 source、target、方向谓词/shortLabel、explanation 和原文证据。

指标：

- eligible fixture 关系产出覆盖率；
- relation precision、relation recall、predicate support、direction accuracy；
- raw → accepted retention；
- 0 关系结果的原因分布。

当前“4/4 成功案例但 0 关系”视为系统性失败，必须先通过诊断区分 Prompt 未产出与服务端过度过滤，再决定修复层。

### P2.2 · 会议输出结构化

依赖：P2.0.5；实体关系写入部分依赖 P2.1。

文件：

- fc-proxy/index.js
- src/components/modes/meeting-assistant.tsx
- 会议类型、fixture 与测试

固定结构：

1. 一句话结论；
2. 已确认决议；
3. 未决问题；
4. 行动项；
5. 负责人和截止时间；
6. 原文证据。

规则：

- “讨论、建议、可能、尚未批准”不得进入已确认决议；
- 只有原文明示任务时生成行动项；
- 没有行动项时固定显示“本段未形成行动项”；
- 负责人或截止时间缺失时显示空值/破折号，不生成“待确认”占位噪音；
- 每个结论、决议和行动项绑定 P2.0.5 句子级 citation；
- 会议标题、来源 URL、议题和参会人仅作为 metadata，不参与结论抽取；
- 前端按固定区块展示，不把几百字发言原样塞进“结论”卡片。

### P2.3 · 关联补充复用旧节点

依赖：P2.1 canonical 实体索引与 P2.1.6 阈值标定。

要求：

1. 识别“补充、更新、完善、修正、继续补充”等输入意图；
2. 优先匹配当前 map 的 canonical 实体与语义相近旧节点，再决定更新、挂载或新增；
3. 默认目标节点复用率 ≥50%；
4. 低于 50% 时只生成预览，前端提示“将新增较多分支，是否继续”；
5. 用户确认后才写入；取消不产生节点、边或文档副作用；
6. 返回 `reusedNodes`、`createdNodes`、`reuseRatio` 和可解释匹配依据；
7. 不得为了达到复用率错误合并语义不同的节点。

验收覆盖：高复用补充、低复用提醒、同名不同义、别名命中、取消写入和确认写入。

### P3.0 · 加载性能

#### P3.0.1 · /health warm

文件：src/lib/warmup.ts、layout 或顶层 Provider。

要求：

- API_BASE_URL 为空时不请求当前静态站点的 /health。
- 浏览器会话内单飞，30 秒冷却，短超时。
- 只 warm health，不预取用户 workspaces/knowledge。
- 失败静默记录脱敏诊断，不阻断首屏。

#### P3.0.2 · 骨架屏 + U3

文件：page、mind-map-panel、新建 mind-map-skeleton。

要求：

- 首帧显示图谱形态骨架。
- 1.5 秒后才显示“网络较慢，正在唤醒服务”。
- 正常返回不闪慢提示。
- 真实内容 200ms 淡入。
- 卸载和请求结束清理 timer。

### U4 · 面包屑

依赖：P1.1、P1.3。

- 产品层级使用“工作区 › 产品板块 › 知识库”，不虚构独立的“图”对象。
- 移动端显示知识库短名称。
- 快速切换必须走统一 loader。

### U7 · 图谱悬停呼吸感

依赖：P1.1.2、P3.0.2、P2.1.4。

- Canvas 在 draw loop 中降低非邻居透明度。
- React Flow 使用 node/edge opacity transition。
- 默认只突出强关系；点击实体看一跳关系。
- 无 hover 行为不变，目标 60fps。
- 复用 P2.1.4 的实体/关系详情，不再新建第二套 tooltip 数据。

### U9 · 新用户空状态

依赖：P1.1、P1.3、P3.0.2。

显示必须同时满足：

- mapCatalogReady；
- 不在 modeLibraryBusy；
- 当前 map 已确认是新账号默认空库；
- nodes 为空；
- onboarding 未完成且未主动关闭。

卡片：个人笔记、论文速读、会议纪要。后两者切换到对应板块，不在知识碎片中模拟。

### U10 · 移动端底部 tab

依赖：P1.3、P3.0.2。

- 替换现有顶部三 tab。
- 内容区增加 safe-area 与底部 padding。
- 浮起新建按钮根据当前板块调用正确动作。
- iPhone SE 尺寸不遮挡输入框和引用面板。

### U5 · Cmd/Ctrl+K

依赖：P1.1、P1.3、P3.0.1。

- 只搜索当前已加载的 maps、当前 map nodes/entities 和最近 chat。
- 文案不得宣称“搜索所有知识库”。
- Windows 使用 Ctrl+K，macOS 使用 Cmd+K。
- 500 节点本地搜索目标 <30ms。
- 跨库全局搜索归 S2.16。

### U2 · 同步状态灯

依赖：P1.4。

- 使用 useSyncStatus(currentMapId)。
- idle、syncing、dirty、offline、error 状态与 P1.4 一致。
- 时间与错误按 map 隔离。
- HTTP 4xx 不自动显示“离线”；只有网络不可达显示 offline。
- Header 与 U4/U8 串行合并。

### U8 · 明暗主题切换

依赖：本轮其他 UX 完成。

- 当前深色变量作为 dark 基线。
- 在 globals.css 增加 light 变量，不大面积堆叠 dark:/light: 硬编码。
- tailwind 配置使用仓库真实文件名 tailwind.config.ts。
- layout 加防 FOUC 的最小脚本，读取本地偏好和系统偏好。
- Canvas 背景、节点、边和 tooltip 必须跟随主题。
- 主要页面满足 WCAG AA 对比度。

## 5. Sprint 2+ · 已保留产品承诺

| 编号 | 任务 | 关键验收 |
|---|---|---|
| S2.1 | maps.mode 数据迁移 | 可回滚，旧 map 正确归类 |
| S2.2 | /api/bootstrap 首屏聚合 | 登录后一次拿 workspace/maps/defaultMap |
| S2.3 | CI 部署事实校验 | version、git_sha、health、静态前端对应 |
| S2.4 | Backlinks + 时间轴 | 引用可反查，节点变更可追踪 |
| S2.5 | 实体 canonical ID + 真 createdAt | 跨文章同实体可合并且可撤销 |
| S2.6 | React Flow 可复现 bug 清单 | 只修有复现步骤的问题 |
| S2.7 | Obsidian 式实体网状图 | 默认强关系、一跳展开、过滤和搜索 |
| S2.8 | Heptabase 白板底座 | 卡片、空间分组、可视化编排 |
| S2.9 | 阿里云常驻实例 | Owner 授权后设置，记录成本和回滚 |
| S2.10 | 观测/on-call + 跨标签页版本同步 | git_sha、部署断言、错误分级、值班 runbook；保存后广播 map 版本，旧标签自动刷新或提示“知识库已在其他页面更新” |
| S2.11 | PDF Viewer + 原文高亮 | 页码定位、findController、引用跳转 |
| S2.12 | 查询时 GraphRAG 定位 | entity linking、混合召回、路径重排、拒答；Recall@5/MRR；与 S2.20 同步开始收集 case |
| S2.13 | 一键整理知识库 | AI推荐/语义主题/工作流/自定义目录；预览、撤销、默认不整理 |
| S2.14 | 统一知识宇宙 | 文章/会议/碎片共用实体；会议确认后进入长期库 |
| S2.15 | 文章多源与 Audio Overview | URL/PDF/正文、无法读取时拒答、citation、音频概览 |
| S2.16 | 跨库全局搜索 | 后端索引、权限过滤、命中解释 |
| S2.17 | 国际化与反馈闭环 | 英文 UI、反馈群、问题标签、版本回访 |
| S2.18 | 邮件投递长期方案 | 自定义 SMTP、退信监控、频控与成本评估 |
| S2.19 | SEO 与产品说明书 | 可索引页面、结构化内容、功能/技术/隐私/定价文档 |
| S2.20 | 三板块产品测评集 | 与 S2.12 并行启动 case 收集；碎片/文章/会议各至少 20 case；召回、质量、延迟、可用性 |
| S2.21 | 普通用户凭证包装 | Supabase 登录与 workspace token 对用户透明，最小权限和续期 |

## 6. 发布与质量门禁

每个任务必须提供：

1. 改动文件清单；
2. 用户可见行为；
3. 单测/集成/E2E 覆盖；
4. 回滚方法；
5. 对鉴权、SSRF、租户隔离、引用真实性的影响；
6. 新依赖 license、体积与必要性；
7. 性能基线和变化；
8. 未验证项，不得以“未发现问题”替代验证。

Sprint 1 完成的最低证据：

- 本地与 CI 命令日志；
- 双账号隔离结果；
- URL/PDF/正文与会议模块真实端到端结果；
- Citation 与实体质量固定集；
- 主要桌面/移动视口截图；
- 线上 health.version 与 health.authRequired 对应；git_sha 对应顺延至 S2.10；
- 无密钥泄露扫描；
- 工作区干净且提交范围与任务一致。

## 7. Codex 执行开场指令

~~~
docs/codex-tasks-v4.md 是唯一执行底座。
Owner 未明确回复“开工”前，不修改产品代码、数据库、云配置或部署。
开工后先确认当前分支、提交、工作区和线上 health，再从 H0.0 开始。
严格按 §2 的子任务依赖执行；不要把逻辑可并行误解为同文件可无冲突并行。
每次只完成一个 PR 级子任务；U3 与 P3.0.2、U6 与 P2.0.3 合并。
任何敏感信息不得进入输出、日志、测试 fixture 或提交。
P2.0.4 只先交类型报告；Owner 确认后才能实现。
P2.1 的正式实体必须有 description 专属证据；正式关系必须有实体共现和关系谓词/方向支持。
测试必须证明需求，不得以过滤后天然 100% 的指标冒充质量提升。
每个任务完成后更新验证矩阵，再进入下一任务。
~~~

## 8. v4 确认记录

- 文档创建基线：main @ 51ea9de。
- 开工状态：已确认。
- Owner 修改意见：P2.1 阈值先标定后确认；rawDescriptionCoverage 80% 首次不阻断；git_sha 门禁顺延 S2.10；API_VERSION 先改常量再同步镜像。
- Owner 开工原文：v4 commit push 完成后，按 v4 §2 主顺序从 P0.0.1 开始。
- Sprint 0 补丁确认：Owner 回复“行，按你判断的来”，采用 H0.0 大库可用性、H0.1–H0.4、P2.0.5、P2.1.7、P2.2、P2.3 与 S2.10 调整后的顺序。
- 实施起始 commit：以本 v4 文档提交后的 main HEAD 为基线。
