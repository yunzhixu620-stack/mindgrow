# MindGrow 实体图质量评测（P2.1.6）

本评测只覆盖单文档/单会议的实体、description、关系谓词与方向质量。跨 map entity linking、查询意图消歧、召回路径重排属于 S2.12；三板块各 20 个产品 case 属于 S2.20，不能用本评测代替。

## 1. 两层结构

### CI 冻结集

- Fixture：`tests/fixtures/entity-quality/entity-graph-quality.json`
- 测试：`src/lib/__tests__/entity-quality-benchmark.test.ts`
- 命令：`npm run test:entity-quality`
- 特性：固定文本、固定 raw output、固定 expected output；不访问公网，不调用收费模型。
- 链路：逐 case 检查 `raw → normalizedEntityGraph validator → accepted`，不是只测最终对象。
- 覆盖：中文论文、英文论文、会议纪要、缩写/alias、否定关系、表格/数字、无定义实体、伪造数字、仅共现关系、错误方向。

当前冻结集共 10 个 case、19 个 raw entity。基线：

| 指标 | 当前基线 | CI 处理 |
|---|---:|---|
| rawDescriptionCoverage | 94.7% | 80% 是目标；低于目标只 warning，不阻断首次实现 |
| acceptedDescriptionGrounding | 100% | ≥90% |
| entityRetentionRate | 100% | ≥80%，后续改动不得无解释显著下降 |
| descriptionGroundingPrecision | 100%（冻结人工标签） | ≥90% |
| shortLabelValidRate | 100% | ≥95% |
| relationPredicateSupport | 100% | ≥90% |
| relationPrecision | 100%（冻结人工标签） | ≥85% |
| relationRecall | 100% | ≥80%，后续版本同时比较基线 |
| emptyGraphRate | 20% | 报告项；两个空图均是预期拒绝 case |

`rawDescriptionCoverage ≥80%` 是目标而不是准入门槛。CI 会打印当前值；不能通过放松 evidence gate 或把 citationIndexes 复制到 descriptionEvidence 来追求覆盖率。

## 2. Live benchmark

- 来源清单：`tests/fixtures/entity-quality/live-benchmark-sources.json`
- 脚本：`scripts/entity-quality-live.js`
- 命令：`npm run benchmark:entity-quality:live`
- 10 个来源：RAG、DPR、LayoutLMv3、GraphRAG、ColBERT、REALM、RETRO、Atlas、HyDE、CRAG。
- 默认模式：warning-only；单个 URL、模型或网络失败不会把 nightly 标红。
- 严格人工复核：在命令后增加 `-- --strict`，任一失败会返回非零退出码。

运行前设置：

```powershell
$env:MINDGROW_LIVE_BENCHMARK_ENDPOINT='https://<aliyun-function-domain>'
$env:MINDGROW_ACCESS_TOKEN='<supabase-user-access-token>'
$env:MINDGROW_WORKSPACE_ID='<test-workspace-id>'
$env:MINDGROW_LIVE_MODEL='qwen-plus'
$env:MINDGROW_ENTITY_PROMPT_VERSION='v4-p2.1.1'
npm run benchmark:entity-quality:live
```

可选成本参数：

```powershell
$env:MINDGROW_INPUT_COST_PER_1K_TOKENS='0'
$env:MINDGROW_OUTPUT_COST_PER_1K_TOKENS='0'
```

每个 case 记录：模型名、prompt 版本、开始时间、延迟、HTTP 状态、实体/关系数、description coverage、description evidence coverage、shortLabel valid rate、empty graph、input/output/total token 与估算费用。若后端暂不返回 usage，token 和费用明确记录为 `null`，报告附 warning，不会伪造估算。

报告写入 `artifacts/entity-quality-live-<timestamp>.json`（已 gitignore）。nightly 建议由 GitHub Actions 或外部调度器注入测试账号 token；凭据不得提交仓库，测试工作区不得使用生产用户数据。

## 3. 人工 precision 标注

Live 结果不能只看自动 lexical gate。每次 prompt、模型或关系验证器有实质变化时，至少抽查：

1. description 是否真的说明该实体在本文中的含义或角色；
2. descriptionEvidence 是否专属于 description，而非普通 citationIndexes 的复制；
3. relation 的 source、target、谓词与方向是否在同一句得到支持；
4. 否定、历史、拟议状态是否正确；
5. 未通过 case 是合理拒绝还是漏召回。

人工标签回填到冻结 fixture 后，再更新 precision/recall 基线。不得删除困难样本来提高分数。
