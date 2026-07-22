# S2.3 部署事实校验

## 目标

让“代码已合并”“静态前端已发布”“生产 API 是预期版本”成为三个可机器核验的事实，避免只凭控制台成功提示判断发布完成。

## 构建事实

`npm run build` 会在构建前生成 `public/deployment.json`，Next.js 静态导出后得到 `out/deployment.json`。清单包含：

- 完整前端 Git SHA；
- 构建时间；
- `docs/api-version.txt` 中的预期 API 版本；
- 生产 `/health` 地址。

源目录里的生成文件会在构建后清理且已加入 `.gitignore`；发布产物中的清单保留。

## 校验命令

```bash
npm run check:deployment-artifact
npm run check:deployment:production
```

生产校验同时断言：

1. 前端清单结构有效；
2. 前端清单的 API 版本等于 `docs/api-version.txt`；
3. 线上 `/health.status === "ok"`；
4. 线上 `/health.authRequired === true`；
5. 线上 `/health.version` 与前端清单一致；
6. 设置 `MINDGROW_EXPECTED_FRONTEND_SHA` 时，线上前端提交号必须完全匹配。
7. 线上 `/health.gitSha` 必须是完整 40 位提交号，且 `checks.deploymentIdentity === "ready"`；设置 `MINDGROW_EXPECTED_API_GIT_SHA` 时必须精确匹配后端源码提交。

## CI

- PR / main push：构建静态站点并校验本地产物；
- 每小时两次：校验线上前端清单和 API health 的对应关系；
- 手动发版验收：运行 `Deployment fact` workflow，输入本次前端发布的完整 main SHA，并输入本次后端源码提交的完整 SHA。

后端 `/health.gitSha` 已在 S2.10 接入；阿里云环境变量 `MINDGROW_GIT_SHA` 必须指向实际部署源码的完整提交号。前端与后端可来自不同提交，两个输入分别校验，不把版本号或镜像文件冒充源码身份。
