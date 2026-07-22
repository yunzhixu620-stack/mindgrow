# P2.0.4 翻译 `usedIds` 类型报告

状态：只读追踪完成；Owner 已于 2026-07-22 确认方案 B。运行时实施位于后续独立 PR。

## 结论与待确认项

当前翻译链路的授权键是字符串 `evidence.id`，不是数字 citation index：

- 翻译证据 ID：`chunk:chunk_<24 位哈希>`，类型为 `string`。
- `allowedIds`：`Set<string>`。
- `citations[].index`：`number`，值为当前文档的 `chunk_index + 1`。
- 模型原始 `usedSourceIds`：Prompt 约定为字符串数组，但 JSON 运行时元素可能是字符串或数字；代码立即执行 `map(String)`，白名单判断时已经是 `string[]`。
- 前端 `sources[].index`：重新编号后的展示序号 `1..N`，不是原始 citation index。

因此，不能把 `usedSourceIds`、`citations[].index` 和前端展示 `sources[].index` 当成同一种 ID。建议采用“严格字符串证据 ID”方案，并用 `coverage` 处理翻译完整性；不要把数字索引硬塞进 `allowedIds`。

需要 Owner 确认：是否采用下文方案 B，并允许在 `coverage=partial` 时只保留模型明确返回的证据子集；`coverage=complete` 但 ID 不完整时降级为 partial，不自动补齐。

## 真实数据流与类型

| 字段 | 产生位置 | 真实/可证明类型 | 示例 | 作用域 |
|---|---|---|---|---|
| `document_chunks.id` | `createDocumentChunkRows`、SQL `TEXT PRIMARY KEY` | `string` | `chunk_4f…` | 全局存储 ID |
| `evidence[].id` | `retrieveArticleTranslationEvidence` | `string` | `chunk:chunk_4f…` | 回答证据授权键 |
| `allowedIds` | `new Set(evidence.map(node => node.id))` | `Set<string>` | `Set{"chunk:chunk_4f…"}` | 服务端白名单 |
| 原始 `parsed.usedSourceIds[]` | DashScope JSON | Schema 期望 `string`；运行时未做元素类型约束 | `"chunk:chunk_4f…"`；模型也可能返回数字 | 不可信模型输出 |
| 规范化 `usedIds[]` | `parsed.usedSourceIds.map(String)` | `string[]` | `"chunk:chunk_4f…"` | 白名单过滤后定位 evidence |
| `evidence[].citations[].index` | `Number(chunk_index) + 1` | `number` | `3` | 文档内 citation 序号 |
| `sources[].id` | `node.id` | `string` | `chunk:chunk_4f…` | 前端来源稳定键 |
| `sources[].index` | `used.map((node, index) => index + 1)` | `number` | `1` | 当前答案内展示序号 |

补充：当前翻译检索只选择一篇文档，但通用回答链路可以混合多篇文档。不同文档的 `citation.index` 都可从 1 开始，因此它不是跨文档唯一键。

## 翻译分支清单

1. `classifyArticleRequest`：识别 `task=translate`、目标语言与 full/abstract/page/relevant 范围。
2. `retrieveArticleTranslationEvidence`：按 workspace、map、document 查询 `document_chunks`；证据 ID 组装为 `chunk:${item.id}`，citation index 为 `chunk_index + 1`。
3. 多文档或超长全文：返回 clarification，不进入模型。
4. 无 evidence：返回 abstain，不进入模型。
5. 无 DashScope key：返回 abstain，不进入模型。
6. `articleTaskSystemPrompt`：要求 `usedSourceIds` 填写提供的证据 ID；翻译 Prompt 还要求包含每一个证据 ID。
7. 模型正常返回：验证 answer 字符串和 `usedSourceIds` 数组；数组元素转为字符串后，用 `allowedIds` 过滤。
8. 当前破例：只要翻译 answer 非空，就用全部 `evidence[].id` 覆盖模型返回的 `usedSourceIds`。
9. 来源组装：按 `usedIds` 找回 evidence，再生成前端 sources；前端显示 index 会重新从 1 编号。
10. Schema/来源验证失败：翻译任务返回 abstain，不降级为普通问答。

## 当前缺陷与语义冲突

实际缺陷不是“数字和字符串比较失败”，因为现代码已经 `map(String)`；问题是翻译分支会无条件覆盖模型返回值：

```js
if (articleRequest && articleRequest.task === 'translate' && parsed.answer.trim()) {
  usedIds = evidence.map((node) => node.id);
}
```

这会让来源卡片看起来覆盖全部证据，即使模型只翻译或只声明使用了其中一部分。

同时，现 Prompt 要求翻译全部选中证据并返回每个证据 ID，而旧验收希望“3 段 evidence、模型只报 1 段时 usedIds 不超过 1”。二者需要用 `coverage` 明确协调，不能简单删除覆盖逻辑后就宣称完整翻译。

## 三个候选方案

### A. 数字 citation index 白名单

做法：把模型输出改成 `usedCitationIndexes: number[]`，以 `citations[].index` 过滤并反查 evidence。

优点：字段短，容易给人阅读。

风险：citation index 只在单篇文档内局部唯一；多文档时会碰撞；与现有 Prompt、`allowedIds` 和 sources 稳定 ID 都不兼容。还容易误用前端重新编号的 source index。

结论：不建议。

### B. 严格字符串 evidence ID 白名单（推荐）

做法：保留 `usedSourceIds: string[]`；元素转字符串后严格匹配 `Set<string>`；删除“翻译非空就补齐全部 ID”的覆盖逻辑。

完整性规则：

- `coverage=partial`：只显示模型明确返回且通过白名单的来源；不得自动补齐。
- `coverage=complete`：要求返回全部选中 evidence ID；若集合不完整，服务端降级为 partial，并在 `missingInformation` 标记“翻译覆盖与来源声明不完整”，不得自动补齐。
- 空集合：保持现有 abstain。

优点：与现有检索、Prompt 和 sources 主键一致；改动最小；跨文档不碰撞。

风险：依赖模型正确抄写较长 ID，需要固定样本覆盖漏 ID、重复 ID、伪造 ID 和 complete/partial 不一致。

### C. 双通道兼容

做法：规范字段仍是字符串 `usedSourceIds`；迁移期可额外接受数字 citation index，但仅当该数字在本次 evidence 中唯一映射到一个 evidence ID 时转换。歧义数字直接丢弃。

优点：兼容可能存在的旧模型数字输出。

风险：增加分支和长期维护成本；数字映射在多文档时容易歧义；当前没有证据表明线上模型正在返回数字。

结论：只有观察到真实数字输出后才采用，不建议预先加入。

## 观测边界

现有 `test:rag` 是离线函数测试，不调用 DashScope，也不执行未导出的 `answerQuestion` 模型分支，因此无法从该测试获得真实模型原始数组元素类型。本文没有为了“制造一次日志”而调用生产模型，也没有记录正文、token、完整 evidence ID 或模型答案。

如 Owner 要求上线前补运行时观测，建议只记录以下聚合字段，并放在受控测试环境：

- `usedSourceIds` 是否为数组；
- 元素 `typeof` 计数；
- 返回数量、白名单命中数量、evidence 总数；
- `coverage`；
- 不记录正文、answer、token、原始 ID、workspace/map 或用户标识。

## 方案 B 的实施验收草案

1. 3 段 evidence，模型返回 1 个合法字符串 ID、`coverage=partial`：只返回 1 个 source。
2. 返回伪造字符串 ID：被白名单删除。
3. 返回数字 `1`：严格字符串方案下不映射到 evidence，结果为空并 abstain。
4. `coverage=complete` 但缺 1 个 ID：降级 partial，`missingInformation` 增加覆盖警告。
5. `coverage=complete` 且 ID 集合与 evidence 集合相同：保持 complete。
6. ID 重复：去重后顺序稳定。
7. 日志不包含正文、token、原始 ID 或用户标识。

## 本报告未做的事

- 未修改 `fc-proxy/index.js`。
- 未修改 Prompt、白名单或来源组装。
- 未调用生产 DashScope、Supabase 或用户数据。
- 未决定兼容数字输出；等待 Owner 确认。
