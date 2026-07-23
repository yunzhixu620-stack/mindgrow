# S2.17 国际化与反馈闭环

## 交付范围

- 核心产品界面支持中文与英文切换，偏好保存在当前浏览器；首次访问按浏览器语言选择，中文浏览器使用中文，其他语言使用英文。
- 登录、工作区、知识碎片、文章解析、会议助手、知识宇宙、全局搜索、移动导航和新用户引导覆盖英文主流程。
- 顶部与移动端提供反馈入口，支持问题类型、影响等级、正文、可选联系许可和国际用户反馈群申请。
- 用户可查看本人当前工作区的反馈状态；问题解决并填写版本号后，产品展示版本回访并允许确认。
- 服务端自动生成 `category:*`、`severity:*`、`area:*`、`locale:*` 标签，方便 on-call 分流。

## 数据与权限

- V17 新增 `product_feedback`，以 `workspace_id + user_id` 隔离；浏览器角色不能直接访问，只能通过鉴权后的 API。
- `workspaceId`、`userId` 和账户邮箱全部由服务端会话决定，客户端同名字段会被忽略。
- 默认不收集邮箱。仅在用户主动允许联系时记录当前登录邮箱；任何请求都不能提交其他邮箱。
- 自动上下文白名单仅包含页面、板块、知识库 ID、设备等级和客户端版本，不上传知识正文、回答、令牌或浏览器指纹。
- 单用户每小时最多提交 5 条；正文长度为 20–4000 字符。

## 主要文件

- 前端：`src/lib/i18n.ts`、`src/components/i18n/*`、`src/components/feedback/*`、各主界面组件。
- 本地适配：`src/lib/client-api.ts`。
- 后端：`fc-proxy/index.js`。
- 数据库：`supabase-v17-feedback-loop-migration.sql`；回滚为 `supabase-v17-feedback-loop-rollback.sql`。
- 测试：`src/lib/__tests__/i18n-feedback.test.ts`、`scripts/e2e-local.js`、`scripts/run-backend-local.js`、`scripts/rag-quality-test.js`。
- 运营流程：`docs/s2-17-feedback-triage.md`。

## 验证证据

- Lint：通过。
- 单元测试：39 个文件、193 个测试通过。
- RAG/安全检查：66/66 通过。
- 本地后端：9/9 通过，另含租户隔离、标签和数据最小化断言。
- 本地产品 E2E：38/38 通过；包含语言偏好刷新保持、反馈提交/标签/隐私，以及碎片、文章、会议、宇宙和跨模块缓存回归。
- 生产构建：通过；主页 123 kB，First Load JS 318 kB；本任务未增加第三方依赖。
- 线上迁移与部署：Supabase V17 执行成功；`main@e895ca819ea47e5e827092d03166350c51eef463`、API `10.17.0`、`gh-pages@055addbd117a251e116a70b26088dc4e224f38d9` 已发布。
- 线上验证：`/health` 返回 `status=ok`、精确 `gitSha`、`feedbackLoop=ready`；公网 backend 7/7、公开 E2E 7/7、production fact workflow `29975287462` 均通过。

## 性能与体验

- 翻译字典在客户端静态打包，不增加网络请求。
- 反馈历史仅打开应用后读取一次，之后按需刷新；正文和历史数量均有上限。
- 本地 E2E 实测三板块切换约 295/459/868 ms，知识宇宙范围切换约 54 ms。该结果来自开发构建，只作为回归基线，不等同于线上用户延迟。

## 回滚

1. 前端与 API 回滚到 10.16.0 对应提交。
2. 保留 `product_feedback` 数据表不会影响旧版本；优先采用此无损回滚。
3. 只有在确认不需要历史反馈时才执行 V17 rollback；它会删除反馈表和全部反馈数据。
4. 若只需关闭入口，可移除 Header/移动端的 `FeedbackCenter`，无需删除数据。

## 风险与未验证项

- 国际反馈群目前是申请入口与 on-call 流程，不会自动邀请第三方群组；自动邀请需要后续明确群平台及其 API 权限。
- Guide/SEO 长内容的完整英文版本归 S2.19；本任务覆盖产品核心交互界面。
- 未在生产账号中写入伪造反馈记录；生产写路径由 V17 schema health、服务端租户集成测试和本地 E2E 覆盖。上线后的第一条真实用户反馈应按 triage runbook 检查标签与回访状态。
- Supabase 控制台在迁移后提示项目正在耗尽多项资源、性能受影响；V17 迁移成功且 health 为 ready，但容量与慢查询需要纳入 S2.18/S2.20 运维观察。
- S2.17 不改变 SSRF、RAG 引用判定或实体证据门禁；新增后端读写仍要求 Supabase 登录并验证当前工作区成员身份。
