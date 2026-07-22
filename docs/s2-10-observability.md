# S2.10 观测与 On-call 发布说明

## 用户与运维可见变化

- `/health` 新增 `gitSha`，用于识别生产 API 实际运行的源码提交。
- `/health.checks.deploymentIdentity` 在生产环境必须为 `ready`；缺失或非法 SHA 时健康状态降级，阻止“版本号正确但代码来源不明”的发布。
- 生产部署校验同时支持前端 SHA 与 API SHA 两个独立断言；前后端不需要来自同一提交，但都必须精确可追溯。
- On-call 形成事件 ID、分级、唯一 IC、时间线、恢复、回归、评测集、回访与复盘的完整闭环。

## 阿里云发布要求

1. 待发布后端源码必须先推送到 GitHub。
2. 将阿里云 `MINDGROW_GIT_SHA` 设置为该源码提交的完整 40 位 SHA。
3. 再部署同一提交中的 `fc-proxy/index.js`。
4. 运行公网 backend smoke，确认 API 版本、`gitSha`、部署身份、鉴权和依赖均通过。
5. 运行 `Deployment fact` workflow，并分别填写前端与 API 的完整 SHA。

## 生产验证记录（2026-07-23）

- 后端源码提交：`5ee87d450af8dc4a75fde169064ef5e2d5c96fd8`；阿里云 `MINDGROW_GIT_SHA` 与该提交完全一致。
- 阿里云运行环境已显式设置为 `NODE_ENV=production`，避免生产环境缺失部署身份时被误判为可用。
- 公网 `/health` 返回 `status=ok`、`version=10.11.0`、`gitSha=5ee87d450af8dc4a75fde169064ef5e2d5c96fd8`、`authRequired=true`、`nodeEnv=production`、`deploymentIdentity=ready`。
- 公网 backend smoke 7/7 通过：CORS、依赖、版本与部署身份正常；匿名 bootstrap、知识库、PATCH、workspace 与 Audio Overview 均被应用鉴权拒绝。
- 本次发布未修改数据库、RLS、用户知识内容、外部依赖或网络出口。

## 回滚

- 代码回滚：部署上一版 `fc-proxy/index.js`，同步把 `MINDGROW_GIT_SHA` 改回上一版实际源码提交，并恢复对应 `API_VERSION`。
- 断言回滚：若 CI 误配，只回滚 workflow / 校验脚本；不得通过伪造 `gitSha` 让不明代码通过。
- 本任务没有数据库迁移、外部依赖、对外网络出口或鉴权逻辑变更。

## 验收门禁

- `npm run check:api-version`
- `npm run test:backend:identity`
- `npm run test:backend:local`
- `npm run test:backend:public`
- `npm run test:unit`
- `npm run lint`
- `npm run build`
- `npm run check:deployment:production`，并传入精确前端/API SHA
