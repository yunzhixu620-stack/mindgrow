# MindGrow V8 SEO 内容建设

## 1. 已完成技术底座

- canonical、title/description、Open Graph、Twitter Card；
- SoftwareApplication 与 FAQ 结构化数据；
- `/guide/`、`robots.txt`、`sitemap.xml`；
- HTTPS、移动端、可缩放、静态导出和稳定 URL；
- 生产登录页不泄漏私有知识内容。

仍需：Search Console/Bing Webmaster 验证、Core Web Vitals 数据、英文 URL 与 `hreflang`、独立隐私/删除/安全页、公开 changelog、站内搜索结构化数据。

## 2. 内容集群与页面

支柱页：`/ai-knowledge-assistant/`，下分五组：

1. **问题词**：AI 知识助手是什么、RAG 如何减少幻觉、引用正确率如何评测、资料不足为什么要拒答。
2. **输入词**：AI PDF summarizer with citations、网页文章解析、URL to mind map、会议转知识库、扫描 PDF OCR。
3. **产物词**：Audio Overview、带引用思维导图、阅读笔记、证据报告、会议行动项。
4. **场景词**：产品研究、竞品分析、客户支持、销售赋能、HR/IT、合规、个人第二大脑。
5. **对比词**：MindGrow vs NotebookLM / Notion AI / Glean / Guru；只写可复现差异，注明官方能力核验与真实跑分的区别。

首批页面建议：

| URL | 主关键词 | CTA |
|---|---|---|
| `/pdf-ai-summary-with-citations/` | PDF AI 总结 引用 | 上传 PDF 生成导图 |
| `/url-to-cited-mind-map/` | 网页转思维导图 | 粘贴 URL |
| `/audio-overview/` | Audio Overview 中文 | 生成文章音频概览 |
| `/rag-citation-evaluation/` | RAG 引用评测 | 下载 100 题模板 |
| `/meeting-to-knowledge-graph/` | 会议知识图谱 | 粘贴会议转写 |
| `/compare/notebooklm/` | NotebookLM alternative | 查看引用与图谱差异 |

## 3. 页面内容规范

每页必须包含：明确场景、真实输入样例、处理流程、可展开的引用截图、限制说明、隐私说明、FAQ、相关页面内链和唯一 CTA。禁止批量生成只有同义词变化的薄内容。

对比页必须说明：测试日期、套餐/模型、数据集、是否允许联网、指标定义和原始结果。没有竞品实测账号时只能写官方能力矩阵。

## 4. 90 天节奏

- 第 1–2 周：1 个支柱页、PDF/URL/Audio 三个高意图页、隐私和安全页。
- 第 3–6 周：每周 2 篇问题型内容 + 1 个公开评测案例；接入 Search Console。
- 第 7–10 周：3 个公平对比页、英文首页与 3 个英文场景页，添加 `hreflang`。
- 第 11–13 周：按真实查询补齐 FAQ/内部链接，合并低质量页，发布季度质量报告。

北极星是“自然搜索 → 完成首个来源解析并保存”的激活率，不是单纯访问量。辅助指标：有效收录、非品牌曝光、CTR、来源解析成功率、首个引用打开率、7 日留存和自然流量付费转化。
