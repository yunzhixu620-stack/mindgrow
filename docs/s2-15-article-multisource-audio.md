# S2.15 文章多源解析与 Audio Overview

## 用户可见结果

- 文章解析继续支持公开 URL、本地 PDF 和粘贴正文，但一次请求只能选择一种来源。
- 解析成功后先显示“来源校验通过”，并给出实际读取字符数、可定位证据块数量和最终网址或 PDF 文件名。
- URL 可以打开但正文不足、返回非文章类型、超时、重定向异常或不可访问时，接口会明确拒答；不会根据网址、标题或常识继续生成。
- PDF 仍由浏览器本地提取版面文字并保留页码；扫描件文字不足时提示先 OCR。
- Audio Overview 只使用文章解析阶段已有直接引用的摘要、要点和论证。每一段对话必须关联内部 claim id，并与对应 claim 保持最小文本重合，再由服务端映射回原文 Citation；模型自己填写的引用编号不被信任。
- 音频卡片显示“引用核验通过”、已绑定证据的段数与预计时长。云端 TTS 不可用时保留同一份已核验脚本，自动降级为浏览器双角色朗读。

## 正确性与安全边界

- 来源协议会拒绝 URL 与正文同时提交、URL/正文类型伪装，以及缺少 PDF 文件元数据的 PDF 声明。
- URL 抓取延续公网 IPv4 固定解析、每次重定向重新校验、禁止 HTTPS 降级、内网/保留地址拒绝、3 次重定向、1MB 和 30 秒上限。
- 网页正文优先读取 `article` / `main`，并移除导航、页眉页脚、表单、脚本和样式噪声。
- Article Citation 仍由逐字原文、定位信息和来源类型共同校验；Audio Overview 不新增事实，只重组已核验的文章 claim。
- Audio Overview 脚本在送入 TTS 前限制为完整的 3100 字符以内，避免“页面显示完整脚本但云端音频被静默截断”。
- 所有工具端点仍经过现有登录与工作区鉴权。本任务不新增跨工作区查询，不修改租户隔离规则。

## 验证证据

- 定向单测：多源协议、网页正文去噪、音频 claim 映射与脚本长度共 6/6；连同 SSRF、Citation 共 26/26。
- 完整单元测试：38 files / 187 tests。
- RAG 与旧运行时兼容门禁：64/64；修复了首次实现中阿里云旧 Node 不支持 `Array.prototype.flatMap` 的问题。
- 本地后端：9/9，并额外通过混合来源拒绝、内网 URL 拒绝和无证据音频拒绝三项接口门禁。
- 产品端到端：37/37；覆盖真实两页 PDF、来源状态、引用定位与高亮、音频证据状态、保存、问答、实体图和三板块切换。
- 真实公网抓取：`https://example.com/` 连续 3 次均提取 144 个可读字符，耗时 200ms / 106ms / 114ms；不存在页面返回 `ARTICLE_FETCH_FAILED` / HTTP 422。
- lint、API 版本一致性与 Next.js 生产构建通过；API 版本为 `10.15.0`。

## 依赖、数据与回滚

- 无新增依赖，无 license 或前端包体新增风险。
- 无数据库迁移，不改写已有文章、节点、Citation 或实体关系。
- 回滚时恢复阿里云 API `10.14.0` 和上一版前端即可；已有数据无需处理。

## 发布顺序

1. 合并前完成 CI、Vercel Preview、unit、RAG、backend local、产品 E2E 与 build。
2. 合并后把实际合并提交写入阿里云部署身份并发布 API `10.15.0`。
3. 发布同一合并提交的 GitHub Pages。
4. 用公网 health、backend smoke、前端 E2E 与 production fact 核对版本和提交身份。

## 生产验证（2026-07-23）

- PR #57 已压缩合并为 `main@af00ec59e58c4ea742e73b7d3dc62f59aae2bdfb`，CI 与 Vercel Preview 通过。
- 阿里云 API `10.15.0` 已发布；公网健康检查返回精确合并提交、`authRequired=true`、`nodeEnv=production`、`deploymentIdentity=ready`，知识存储、实体图与 GraphRAG 排序均为 ready。
- 公网 backend smoke 7/7 通过。
- GitHub Pages 已发布为 `gh-pages@8e8bcc534700e5f60c0351dc808a10c1b2997fe5`；Pages workflow `29970768271` 与公网前端 E2E 7/7 通过。
- production fact workflow `29970868143` 精确核对前后端提交、API 版本与鉴权门禁并通过。
