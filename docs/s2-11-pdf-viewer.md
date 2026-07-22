# S2.11 PDF Viewer 与原文高亮

## 用户可见变化

- 文章解析上传 PDF 后，引用 chip、证据卡、导图引用和 Audio Overview 引用都可以打开同一个内嵌原文 Viewer。
- Viewer 优先跳到 citation 的真实页码，并用 PDF.js 文本层高亮逐字引用；同时提供上一页、下一页和手动查找。
- 关闭 Viewer 后仍停留在文章解析，不再误触顶部“知识宇宙”入口。
- 若当前会话没有原 PDF 文件，界面明确提示重新选择文件，不伪装成已经定位或高亮。

## 实现边界

- PDF 字节只保留在当前浏览器内存中的 `File`，Viewer 复用同一个本地文件，不把 PDF 上传到新的服务。
- citation 新增可选 `pageNumber` 与 `chunkIndex`；本地 PDF 解析会保留 `[第 N 页]` / `[page N]` 标记并生成页码 locator。
- PDF.js 4.10 的 `PDFFindController` 没有公开 `executeCommand`；本实现使用其 EventBus `find` 事件，并等待 `pagesloaded` 后再搜索。
- 搜索控制器只由 `PDFViewer.setDocument` 初始化一次，避免重复 `setDocument` 清空正在进行的搜索。
- Viewer 层级为 `z-index: 200`，高于全局导航的 100，防止关闭按钮点击穿透。
- 本任务没有数据库迁移、后端/API 版本变化、鉴权变化、外部网络出口或新增 npm 依赖。

## 关键文件

- `src/components/article/pdf-citation-viewer.tsx`：Viewer、翻页、搜索、高亮与生命周期。
- `src/lib/pdf-citation.ts`：页码与高亮 query 解析、本地 citation 构造。
- `src/components/answer/answer-card.tsx`：引用 chip 和证据卡的原文入口。
- `src/components/modes/article-parser.tsx`：当前会话 PDF 文件保留与统一引用跳转。
- `src/app/globals.css`：PDF.js Viewer/TextLayer 样式与高亮主题。
- `src/lib/__tests__/pdf-citation.test.ts`、`scripts/e2e-local.js`：页码解析、真实 Viewer 和防跳页回归。

## 验收证据

- 单元测试：34 个文件、171/171 通过。
- ESLint：0 warning / 0 error。
- Next.js 生产构建：通过。
- 本地产品 E2E：37/37 通过。
- 2 页固定样本：点击引用后打开第 1 页，文本层出现真实 `.highlight`，关闭后不跳转。
- 10 页 LayoutLMv3 论文：保留分页/换行与图像页诊断，引用可打开 10 页 Viewer。
- 三板块切换延迟样本：152ms / 121ms / 73ms；知识宇宙 scope 切换 66ms。

## 生产发布记录（2026-07-23）

- PR #53 压缩合并为 `main@055123d0db64539ae9f46a28e7fe8c8b9a0b9f8b`。
- GitHub Pages 发布产物为 `gh-pages@7d54b3d729dfb756438b5ae17214a08c669c6276`；首次平台部署任务停在队列，使用内容不变的空提交重试后成功，未重复修改产物。
- 公网 deployment fact 精确核对前端 `055123d`、API `10.11.0`、后端源码 `5ee87d450af8dc4a75fde169064ef5e2d5c96fd8` 与 `authRequired=true`，workflow `29956156844` 通过。
- 公网前端 E2E 7/7、后端安全 smoke 7/7 通过；阿里云函数与 Supabase 无需变更。

## 回滚

1. 移除 `PdfCitationViewer` 及文章解析中的本地 `File` 会话状态。
2. 恢复 AnswerCard 的普通 citation 选中行为和原有 CSS。
3. 保留 citation 的可选页码字段不会破坏旧数据；如需完全回滚，可同时移除 `pageNumber` / `chunkIndex` 和本地 citation 构造器。
4. 无数据库、阿里云函数或 Supabase 回滚步骤。

