# S2.18 邮件投递长期方案

## 结论

MindGrow 当前仍使用 Supabase 内置邮件服务。它是 best-effort 测试通道，当前项目级上限为每小时 2 封，不适合作为生产注册邮件。首发推荐 **Resend Free + 自有域名的独立发信子域名**；在没有完成域名验证和 SMTP 密钥配置前，Supabase 的“Enable custom SMTP”必须保持关闭，避免所有注册邮件中断。

产品端已经增加 60 秒发送冷却，注册成功、重新发送成功或服务端返回频控错误后都会生效；冷却刷新页面仍保留，但本地不保存用户邮箱。界面同时提醒用户只使用最新邮件链接并检查垃圾邮件箱。

## 选型与成本

| 方案 | 当前公开成本 | 优点 | 限制 | 决策 |
|---|---:|---|---|---|
| Supabase 内置 | 免费 | 零配置 | 约 2 封/小时、best effort、非生产 | 仅保留到自定义 SMTP 激活 |
| Resend Free | 3,000 封/月、100 封/日，$0 | 配置简单；1 个自定义域名；事件与 Webhook；适合国际早期用户 | 必须拥有可验证域名；超过免费档后需升级 | **首发推荐** |
| Resend Pro | $20/月起，50,000 封/月 | 运维简单、事件保留更完整 | 小流量阶段成本高于按量 | 超过免费档再评估 |
| 阿里云邮件推送 | 总计 2,000 封免费、每日最多 200；之后约 $0.29/千封 | 大量邮件单价低；中国线路可作为补充 | 免费额度不是每月重置；域名/DNS/信誉配置更多；频控需自行实现 | 中国投递或量增大后作为第二通道 |

公开依据：

- Supabase SMTP 与限额：<https://supabase.com/docs/guides/auth/auth-smtp>、<https://supabase.com/docs/guides/auth/rate-limits>
- Resend 价格与 Supabase SMTP：<https://resend.com/pricing>、<https://resend.com/docs/send-with-supabase-smtp>
- Resend 事件与签名校验：<https://resend.com/docs/webhooks/introduction>、<https://resend.com/docs/webhooks/verify-webhooks-requests>
- 阿里云邮件推送计费与限制：<https://www.alibabacloud.com/help/en/direct-mail/billing-methods>、<https://www.alibabacloud.com/help/en/direct-mail/product-overview/limits>

价格与免费额度会变化，启用或升级前必须重新核对服务商页面。

## 推荐生产配置

1. 使用自有根域名，例如 `mindgrow.example`，创建发信子域名 `auth.mindgrow.example`；不要尝试验证 `yunzhixu620-stack.github.io`，它不是项目可控制的根域名。
2. 在 Resend 验证该子域名，按其页面配置 SPF 与 DKIM；DMARC 初始使用监控策略，确认无误后再逐步收紧。
3. 创建仅用于 Supabase Auth 的 API key；不与阿里云模型、数据库或其他服务共用。
4. Supabase Authentication → Emails → SMTP Settings：开启自定义 SMTP；主机 `smtp.resend.com`，端口 `465`，用户名 `resend`，密码为专用 API key，Sender 使用已验证子域名地址。
5. Authentication → Rate Limits 初始设为每小时 25 封。注册/重发单用户继续保留 60 秒冷却；观察一周后再按真实注册量调高。
6. 依次测试 Gmail、Outlook/Hotmail、QQ 邮箱：注册、重发、只认最新链接、过期链接恢复、垃圾箱提示。测试期间不要反复向同一地址发送。

## 退信、投诉与频控

首发阶段以 Resend Emails/Logs 事件面板为投递真源，每日查看 `bounced`、`complained`、`delivery_delayed`、`failed`：

- hard bounce 或 complaint：立即停止向该地址继续发送；投诉率异常按 SEV1 处理。
- 软退信或 delayed：24 小时内不主动重发，先观察服务商重试。
- 单小时发送量超过日常基线 3 倍：检查注册滥用、机器人与 Supabase Auth 日志。
- 退信率连续 30 分钟超过 5%：暂停注册重发入口并按 SEV1 排查域名、DNS 与发件信誉。
- 任一服务商密钥出现在浏览器、日志、截图或提交中：立即轮换，按 SEV0 处理。

当日均发送超过 50 封或团队开始正式 on-call 后，增加签名 Webhook 自动告警。Webhook 必须校验原始请求体与 `svix-*` 签名、按 `svix-id` 去重，数据库默认只保存收件人哈希和事件元数据，不保存邮件正文。本轮不在没有真实 Webhook secret 和测试事件的情况下自制签名校验器。

## 2026-07-23 线上发布证据

- 实体悬停稳定性修复经 PR #60 合并；邮件投递防护经 PR #61 合并，当前产品源码为 `main@3ca16f50529ebbb45284f5a52a48c4b00b3e9438`。
- 阿里云函数已发布 API `10.18.0`，`/health` 返回精确源码提交、`status=ok`、`authRequired=true`、`deploymentIdentity=ready`；公网后端 smoke 7/7 通过。
- GitHub Pages 已发布 `gh-pages@74bf462ff3bb6af9b0849afe497dab2018a3eb99`，Pages workflow `29980120639` 通过；公网前端 E2E 8/8 通过。
- production fact workflow `29980184041` 已精确核对线上前端与后端均来自上述 `main` 提交，API 版本与鉴权状态一致。
- Supabase custom SMTP 仍为关闭状态；以上发布完成的是产品侧防误触与恢复体验，不代表第三方生产邮件通道已经激活。

## 明日需要 Owner 完成/提供

这些步骤无法由现有 Supabase/阿里云登录状态代替：

1. 确认一个自己拥有并可修改 DNS 的域名；若没有，先购买低成本域名。
2. 注册或登录 Resend，并创建发信子域名；完成 SPF/DKIM 验证。
3. 在 Resend 创建 Supabase 专用 API key。**只粘贴到 Supabase SMTP 密码框，不发到聊天、不写入仓库。**
4. 回到 Supabase SMTP 页面完成 Sender name/email、host、port、username、password 后保存。
5. 告知 Codex“SMTP 已保存”，再执行跨邮箱真实投递、退信事件和频控验收。

## 回滚

若新 SMTP 造成大面积失败，先关闭注册/重发入口，再在 Supabase 关闭 custom SMTP 回到内置测试通道；不要在未验证的情况下反复开关。产品内 60 秒冷却可以单独回滚，不改变 Supabase Auth 数据和登录令牌。

## 边界与影响

- 本任务不改变 Supabase 登录令牌、workspace token、租户隔离、RAG 引用或 GraphRAG。
- 未新增第三方前端依赖，也未把邮件服务密钥放入浏览器。
- Resend 激活前，真实投递能力仍受 Supabase 内置通道限制，不能宣称生产邮件已完成切换。
