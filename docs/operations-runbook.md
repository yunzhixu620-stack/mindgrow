# MindGrow V8 On-call 与国际用户反馈机制

## 1. 服务目标

| 服务 | SLO | 延迟/质量目标 |
|---|---:|---|
| GitHub Pages 前端 | 99.9% | LCP p75 <2.5 秒，静态资源 404 = 0 |
| 阿里云 API | 99.5% | 非生成接口 p95 <1.5 秒，5xx <1% |
| AI 生成/文章解析 | 99.0% | p95 <20 秒，结构解析成功率 ≥99% |
| 知识问答 | 99.0% | 引用覆盖率 ≥95%，越权泄漏 0 |
| Audio Overview | 98.5% | MP3 失败时浏览器朗读降级成功率 ≥99% |

## 2. 事故分级与响应

- **SEV0**：密钥/个人数据泄漏、跨租户越权。立即停用凭证或入口，15 分钟内响应；保留审计证据，不在群里粘贴敏感数据。
- **SEV1**：登录、核心知识读写或全部问答不可用，影响 >10% 用户。30 分钟内响应，2 小时内给状态更新。
- **SEV2**：PDF/文章/Audio 等单一能力失败或性能明显退化。4 小时内响应。
- **SEV3**：低影响 UI、文案、单用户问题。下一工作日处理。

值班角色：Incident Commander（协调/决策）、Operations（云平台/数据库）、Product Liaison（用户公告/反馈）、Scribe（时间线/复盘）。早期团队可一人兼多职，但每次事故必须明确唯一 IC。

## 3. 合成监控与发布门禁

- 每 5 分钟：`GET /health`，要求 HTTP 200、`version=10.0.0`、model/store/hybridRetrieval 均为 ready 或 ok。
- 每 15 分钟：匿名访问 knowledge/workspaces/audio 均应为 401；任何 2xx 视为 SEV0。
- 每 60 分钟：专用测试账号列出 workspaces/maps，不执行付费模型。
- 每天：专用测试知识库解析一篇固定短文，验证 citation quote 与来源一致；生成一次 Audio 脚本。
- 每次发布：lint、build、本地 E2E、公网 E2E、后端冒烟、Supabase 权限审计全部通过。
- 每周：恢复演练一次（数据库只读、模型超时、TTS 失败、GitHub 静态资源缓存）。

## 4. Runbook：Supabase 不可达

1. 先看 `/health` 的 knowledgeStore；确认不是阿里云 DNS/网络问题。
2. 在 Supabase 控制台检查项目状态、Auth、REST API 和 SQL 查询。
3. 新项目用 `supabase-schema.sql`；V7 项目依次执行 V7、V8 migration。
4. 阿里云环境变量只放 project URL 与 service-role/secret key；部署后立即跑匿名 401 检查。
5. 若 30 分钟内无法恢复，状态页标记云同步不可用；不要把生产网站切为匿名本地共享数据。

## 5. Runbook：引用错误

1. 保存 query id、workspace/map（脱敏）、答案、claim、citation index、quote、locator 和 source hash。
2. 先判断是解析错误、检索错误、模型引用错配、原文更新还是权限撤销。
3. SEV0：引用了无权限来源；立即禁用回答入口并检查成员/过滤条件。
4. 普通错误：把问题加入金标集，修复后同时验证引用正确率和拒答行为。
5. 若后验引用校验失败，产品应降级到“证据列表”，不得继续展示无来源的确定性答案。

## 6. 国际用户反馈群设计

建议建立：产品内反馈 + 英文 Discord + GitHub Discussions/公开 changelog。Discord 最小频道：

- `#announcements`：只读发布与事故状态；
- `#getting-started`：英文上手和 FAQ；
- `#bug-reports`：UI/导入/Audio 故障；
- `#retrieval-quality`：搜索、答案和引用问题；
- `#feature-requests`：场景与需求；
- `#office-hours`：每月英语用户圆桌。

反馈表必填：匿名 query id、语言/地区、场景、来源类型、预期/实际、严重级别、是否允许脱敏后进入评测。禁止在公开频道发送原始企业文档、密码、访问令牌、个人身份信息或 service-role key。

闭环 SLA：24 小时内分流 → 每周 Top 5 进入产品评审 → 可复现问题进入评测集 → 发布后回访原用户 → 月度公开 changelog。指标：首次响应时间、可复现率、进入评测集比例、修复周期、回访满意度、同类问题复发率。

当前状态：机制与模板已定义，但未对外创建 Discord/Discussion，因为尚未获得指定社区账号与代表产品对外发言的授权。创建时应先确定管理员、隐私说明、社区守则和升级联系人。
