# S2.19 SEO 与产品说明书发布记录

## 交付范围

- 新增公开可索引的 `/product/`，覆盖产品定位、三板块场景、技术选型原因、隐私安全、成本与能力边界。
- 新增 `docs/product-handbook.md` 与 `docs/seo-content-plan.md`，并从 `/guide/` 建立产品说明入口。
- sitemap 纳入 `/product/`；公开 E2E 同时检查产品页、robots 与 sitemap。
- 主要文件：`src/app/product/page.tsx`、`src/app/guide/page.tsx`、`src/app/sitemap.ts`、`src/components/layout/main-layout.tsx`、`scripts/e2e-public.js` 和两份说明文档。

## 质量与边界

- `/product/` 是静态页面，不读取登录会话、工作区或知识内容；未改变鉴权、SSRF、租户隔离、Citation 与 GraphRAG。
- 未新增依赖、数据库迁移或后端接口。构建报告中该路由自身为 163 B，首屏共享资源 106 kB；不增加应用内板块切换请求。
- 回滚可单独回退 PR #62；只会移除产品页、导航入口和 sitemap 项，不影响用户数据。
- SEO 计划明确不发布无法验证的宣传结论；真实模型效果、价格与第三方额度变化需在更新内容前重新核验。

## 发布证据

- PR #62 合并为 `main@ff690b529c3a2dcf0d596135d5a11bd7cb90aad0`，随后随统一版本 `main@9cffe83b0780ff50d8606c848edd5246f11d340a` 发布。
- `gh-pages@817e60efa463c6c18405010685f81210f507426a` 与 Pages workflow `29982390204` 成功；公网 E2E 10/10，产品页、指南、robots 与 sitemap 均通过。
- production fact workflow `29982477274` 精确核对线上前端与后端均对应 `9cffe83b0780ff50d8606c848edd5246f11d340a`。
