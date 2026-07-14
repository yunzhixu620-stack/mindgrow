# MindGrow V8 国际竞品与体验分析

> 结论分为两类：MindGrow 为实际构建与端到端验证；竞品为 2026-07-14 官方资料能力核验。未使用相同账号和金标数据集跑出的结果不伪装成量化实测分数。

## 1. 竞品好在哪里

| 产品 | 最强场景 | UI/使用体验优势 | 回答与引用优势 | MindGrow 应吸收 |
|---|---|---|---|---|
| NotebookLM | 个人研究、学习、长资料理解 | Source-first：先选资料，再进入 Chat/Studio；同一资料可变成摘要、导图和 Audio Overview | 仅基于所选来源；引用 hover 看原句，点击跳到原文位置 | 来源选择器、引用前后文、PDF 深链、更多 Studio 产物 |
| Notion AI | 团队文档与工作流 | 搜索、页面编辑、数据库和 AI 在同一工作区；可 `Add context` 指定页面/人员 | 搜索 Notion、连接器和 Web；工作区/连接器回答带来源 | “回答 → 写回页面/数据库/任务”的连续动作与连接器 |
| Glean | 大型企业统一搜索 | 一个搜索入口覆盖文档、文件、人员和代码；来源预览后再跳原应用 | 行内引用、View sources、权限继承、可跳具体段落/页码 | 查询时权限过滤、深链、来源预览、专门的代码检索 |
| Guru | 企业知识治理 | 答案、验证、审批、知识维护和训练中心形成闭环；知识送到 Slack/Teams/浏览器 | 平台级强制引用；内容新鲜度、冲突、专家验证和审计 | 不只“找到知识”，还要验证、过期、纠错一次全局生效 |
| MindGrow V8 | 个人/小团队的研究与可编辑知识图谱 | 输入成本低；正文/URL/PDF/会议都能直接形成可编辑导图；开发模式可本地运行 | 原文逐字引用可保存到节点；证据不足拒答；中国云栈可控 | 保持可编辑图谱差异化，同时补齐来源管理、深链和检索精排 |

## 2. 官方能力依据

- NotebookLM 支持 PDF、网页、音频、Google 文件等来源，回答使用清晰行内引用，并能生成 Audio Overview 和 Mind Map：[产品说明](https://support.google.com/notebooklm/answer/16164461?hl=en)。其引用可 hover 看原句并点击跳到原文位置：[聊天与引用](https://support.google.com/notebooklm/answer/16179559?hl=en)。
- Notion Enterprise Search 可以搜索工作区、Slack、Google Drive、Jira 等连接器，工作区/连接器答案会引用来源，并支持限定搜索范围：[Enterprise Search](https://www.notion.com/en-gb/help/enterprise-search)。
- Glean 的引用紧跟需要证据的陈述，支持来源预览和部分来源的段落/页码深链，并且不会提升用户原有权限：[Glean citations](https://docs.glean.com/user-guide/assistant/glean-chat/glean-chat-citations/glean-citations)。
- Guru 强调连接器统一索引、权限继承、平台级引用、验证/归档和 AI Training Center：[Guru platform capabilities](https://www.getguru.com/features)。

## 3. 分维度差异

### 检索效果

- NotebookLM 的优势是用户显式勾选来源，检索空间天然更干净。
- Glean/Guru 的优势是跨连接器、权限感知和企业级索引；MindGrow 当前只检索 Supabase 中的单个知识库。
- MindGrow V8 已避免全图进上下文，但当前 trigram + 图邻居仍不如“混合召回 + rerank”。V8.1 必须引入 embedding、稀疏/关键词、RRF 与 `qwen3-rerank`。

### 回答质量

- NotebookLM 的最佳体验是“陈述旁引用 + 点击回原文”；MindGrow 已有逐字引文和页码，但缺少 PDF viewer 深链。
- Glean/Guru 把权限、新鲜度和治理算作回答质量的一部分；MindGrow 已有租户隔离，尚无文档新鲜度/验证状态。
- MindGrow 的强项是回答结果可以直接沉淀为可编辑图节点，并保留来源，而不是只停留在答案列表。

### 使用体验

- NotebookLM 的 Studio 把复杂提示变成一键产物，降低“我该问什么”的门槛。
- Notion 的优势是 AI 与原有编辑/数据库任务无缝衔接，用户不用切换工具。
- Glean/Guru 的优势是出现在员工已有的 Slack/Teams/浏览器工作流中。
- MindGrow V8 已把文章、会议、导图放进同一产品，但来源列表、批量导入、处理进度和失败重试仍需独立 UI。

## 4. MindGrow 的产品取舍

不应复制 NotebookLM 做成“另一个资料聊天框”。MindGrow 更合适的定位是：

**NotebookLM 式可信解析 + 可持续编辑的知识图谱 + 面向中国用户和小团队的低门槛部署。**

优先级：

1. 引用点击回原文、来源管理和混合检索；这是可信度底座。
2. 让文章/会议产生的节点可合并、去重、验证和更新；这是长期知识价值。
3. 再做连接器、团队治理和国际化；不要在检索质量未达标前堆很多入口。

## 5. 公平对比评测执行法

使用同一组 20 份公开资料、100 个金标问题，在各产品关闭 Web 搜索或明确标记 Web 结果后测试。记录：

- Recall@5、nDCG@5、MRR；
- 逐条 claim 的引用正确率和覆盖率；
- 有答案/无答案的拒答准确率；
- 从提问到打开有效原文的秒数与点击数；
- PDF、网页、跨文档、版本冲突、权限撤销五类专项；
- 首次导入完成率、处理失败恢复率、移动端任务完成率。

无法获得竞品测试账号或统一关闭联网搜索时，只写“官方能力存在/不存在/未验证”，不输出误导性的排名分数。
