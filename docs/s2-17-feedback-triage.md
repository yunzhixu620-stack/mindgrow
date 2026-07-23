# S2.17 国际用户反馈与版本回访机制

## 用户入口

- 桌面端右上角和移动端顶部均提供“反馈 / Feedback”入口。
- 用户可提交检索、回答、Citation、性能、UX、账号、功能建议或其他问题，并选择影响程度。
- “申请加入国际反馈群”不依赖第三方 SDK。用户必须主动允许邮箱联系，系统才记录可用于发送邀请的账号邮箱。
- 用户可在“处理进度 / Updates”查看自己的最近 50 条反馈；只显示当前用户、当前 workspace 的数据。

## 自动标签

每条记录自动生成四类稳定标签，供 on-call 分诊与统计：

- `category:*`：retrieval、answer、citation、performance、ux、account、feature、community、other；
- `severity:*`：low、normal、high、blocker；
- `area:*`：knowledge、article、meeting、universe、auth、guide、other；
- `locale:*`：zh-CN、en。

标签由后端根据白名单字段生成，不接受浏览器自定义标签。用户传入的 workspace id、user id 和额外上下文字段均被忽略。

## On-call 分诊规则

1. `blocker`：无法登录、数据跨租户、现有知识不可访问或核心流程完全中断；立即按 S2.10 P0/P1 runbook 处理。
2. `high`：主要任务可复现失败、错误引用、明显跨文档误召回；当日确认并建立修复任务。
3. `normal`：功能可绕过、局部 UX 或单一来源失败；进入下一次计划评审。
4. `low`：轻微体验、建议和反馈群申请；批量处理。

国际反馈群申请只用于发送一次邀请，不把邮箱导出到文档、日志或测试 fixture。邀请完成后把该记录设为 `closed`，并在 `resolution_note` 说明“邀请已发送”，不得写入群链接或个人信息。

## 状态与版本回访

状态依次为 `new → triaged → planned → resolved/closed`。管理员在 Supabase 后台更新 `status`、`resolution_note`、`resolved_version` 和 `updated_at`；产品端不提供管理员写入口。

当 `resolved_version` 非空且用户尚未确认时，反馈按钮显示角标，记录显示“已在该版本修复 / Fixed in this version”。用户点击“我已看到 / Acknowledge”后，只能更新属于本人和当前 workspace 的 `follow_up_acknowledged_at`，不能修改状态、说明或版本。

## 数据最小化与频控

- 自动上下文仅包括页面路径、产品板块、map id、设备类别和客户端版本。
- 不采集知识正文、对话回答、Citation 原文、URL 查询参数、访问令牌或数据库凭证。
- 联系邮箱默认不记录；只有用户勾选联系授权才保存。
- 每个用户每小时最多提交 5 条，超出返回 429；输入长度为 20–4000 字符。
- `product_feedback` 开启 RLS，撤销 `PUBLIC`、`anon`、`authenticated` 直接权限，仅允许阿里云函数的 `service_role` 访问。

## 回滚

- 前端可先隐藏反馈入口并回滚到上一静态版本；不影响已有知识数据。
- API 可回滚到 10.16.0。若保留反馈记录，数据库表可以继续存在。
- `supabase-v17-feedback-loop-rollback.sql` 会删除全部反馈记录；生产执行前必须先导出需要保留的数据。
