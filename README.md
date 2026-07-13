# MindGrow

MindGrow 是一个本地优先、证据优先的 AI 知识助手：把碎片信息整理成可编辑知识导图，在提问时先检索当前知识库，并对证据不足的问题明确拒答。

## 当前产品形态

- **本地模式（默认）**：无需账号或密钥，数据保存在当前浏览器；创建知识库、知识结构、检索问答、引用、反馈、编辑、移动和导出均可使用。
- **云端模式（可选）**：静态前端调用阿里云函数，阿里云函数再访问通义千问与 Supabase。任何模型或数据库密钥都只能放在服务端。
- **静态部署**：Next.js 构建为 GitHub Pages 可部署文件，生产路径为 `/mindgrow`。

## 本地运行

```bash
npm install
npm run dev
```

打开 `http://127.0.0.1:3000`。若 `NEXT_PUBLIC_API_BASE_URL` 为空，产品自动使用本地模式。

## 验证

```bash
npm run lint
npm run build
npm run test:e2e:local
npm run test:backend
```

- `test:e2e:local` 覆盖知识库首屏、证据检索与引用、回答反馈、知识结构创建、持久化、移动端布局、SEO 指南、robots 与 sitemap。
- `test:backend` 对线上阿里云入口执行健康检查及可逆 CRUD；仅当读取链路健康时才创建临时数据，并在结束时删除。
- 如需额外执行一次会产生模型费用的知识生成检查：`MINDGROW_RUN_BILLABLE_AI=1 npm run test:backend`。

## 云端架构

```text
Browser / GitHub Pages
        │ HTTPS
        ▼
Alibaba Cloud Function Compute (fc-proxy/index.js)
        ├── DashScope / Qwen（知识结构生成）
        └── Supabase REST（知识库持久化）
```

阿里云函数需要以下环境变量：

```text
MINDGROW_API_KEY=<DashScope key>
SUPABASE_URL=<project URL>
SUPABASE_KEY=<server-only service-role/secret key>
ALLOWED_ORIGINS=https://yunzhixu620-stack.github.io
```

前端只需要：

```text
NEXT_PUBLIC_API_BASE_URL=https://<your-function>.fcapp.run
```

新 Supabase 项目使用 `supabase-schema.sql` 初始化。该架构不允许浏览器匿名直写数据库。

## 关键目录

- `src/lib/client-api.ts`：本地模式与云端模式适配层。
- `src/components/chat/`：知识输入、检索回答、引用与反馈。
- `src/components/mindmap/`：知识图谱展示、编辑和导出。
- `fc-proxy/index.js`：阿里云函数后端、健康检查、模型与知识库代理。
- `supabase-schema.sql`：服务端专用、关闭匿名访问的数据库结构。
- `scripts/`：端到端和线上后端冒烟测试。
- `docs/`：产品、评测、SEO、On-call 与上线说明。

## 安全原则

1. 不在浏览器变量、源码、README、截图或日志中保存任何真实密钥。
2. Supabase 使用服务端 secret/service-role key；浏览器只访问阿里云函数。
3. 已经提交到 Git 历史的密钥必须在供应商控制台轮换；仅删除文件不能使旧密钥失效。
4. 上线前必须让 `/health` 返回 `200`，并让 `npm run test:backend` 全部通过。

