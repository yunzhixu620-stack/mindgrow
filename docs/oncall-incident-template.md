# MindGrow On-call 事件记录模板

## 基本信息

- 事件 ID：`MG-YYYYMMDD-NN`
- 级别：SEV0 / SEV1 / SEV2 / SEV3
- 当前状态：调查中 / 已缓解 / 已恢复 / 已关闭
- Incident Commander：
- Operations：
- Product Liaison：
- Scribe：
- 首次发现时间（含时区）：
- 首次响应时间：
- 影响模块与用户范围：

## 版本与证据

- 前端 `deployment.json` 完整 SHA：
- API `version`：
- API `gitSha`：
- `/health.status`、`authRequired` 与失败检查项：
- 脱敏 query/request ID：
- 禁止粘贴：访问令牌、service-role key、原始私有文档、个人身份信息。

## 时间线

| 时间 | 观察 / 操作 | 结果 | 负责人 |
|---|---|---|---|
| | | | |

## 处理与验证

- 根因：
- 缓解或回滚动作：
- 修复提交 / PR：
- 自动化回归命令与结果：
- 真实环境验证结果：
- 是否新增评测 case：是 / 否；编号：
- 数据、鉴权、SSRF、租户隔离、引用真实性影响：

## 用户闭环

- 首次状态通知：
- 恢复通知：
- 报告人回访时间与结果：
- 公开 changelog / 复盘链接：
- 未完成行动项、负责人、截止日：

只有在服务恢复、回归通过、行动项有负责人且报告人已回访后，事件才可标记“已关闭”。
