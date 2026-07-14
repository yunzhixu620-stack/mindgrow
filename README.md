# MindGrow

MindGrow 是一个本地优先、证据优先的 AI 知识助手：把碎片信息整理成可编辑知识导图，在提问时先检索当前知识库，并对证据不足的问题明确拒答。

## 当前产品形态（V8）

- **本地模式（默认）**：无需账号或密钥，数据保存在当前浏览器；创建知识库、知识结构、检索问答、引用、反馈、编辑、移动和导出均可使用。
- **云端模式**：邮箱登录、私有工作区和多租户隔离；静态前端调用阿里云函数，阿里云函数再访问通义千问与 Supabase。任何模型或数据库密钥都只能放在服务端。
- **静态部署**：Next.js 构建为 GitHub Pages 可部署文件，生产路径为 `/mindgrow`。
- **来源解析**：会议记录、公开网页、粘贴正文和 PDF 可生成带逐字引用的知识导图；PDF 在浏览器本地提取文字和页码。
- **Audio Overview**：双角色引用脚本；优先 CosyVoice MP3，失败时浏览器朗读降级。

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

- `test:e2e:local` 覆盖真实两页 PDF、页码引用、Audio Overview、会议助手、知识问答、大图渐进展示与移动端等 11 条完整路径。
- `test:e2e:public` 覆盖生产登录、匿名拒绝、健康状态、移动端和 SEO。
- `test:backend` 默认执行不需要账号的安全冒烟；设置 `MINDGROW_ACCESS_TOKEN`（可选 `MINDGROW_WORKSPACE_ID`）后会创建并删除带引用的临时知识库，验证生产租户写入。

## 云端架构

```text
Browser / GitHub Pages
        │ Supabase Auth token + workspace id
        ▼
Alibaba Cloud Function Compute (fc-proxy/index.js)
        ├── DashScope / Qwen（结构、回答、Audio 脚本）
        ├── DashScope / CosyVoice（临时 MP3）
        └── Supabase Auth + REST（租户、知识、来源、引用）
```

阿里云函数需要以下环境变量：

```text
MINDGROW_API_KEY=<DashScope key>
SUPABASE_URL=<project URL>
SUPABASE_KEY=<server-only service-role/secret key>
ALLOWED_ORIGINS=https://yunzhixu620-stack.github.io
AUTH_REQUIRED=true
```

前端只需要公开配置：

```text
NEXT_PUBLIC_API_BASE_URL=https://<your-function>.fcapp.run
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<public publishable key>
```

新 Supabase 项目使用 `supabase-schema.sql` 初始化；V7 项目再执行 `supabase-v8-citations-migration.sql`。该架构不允许浏览器匿名直写数据库。

## 关键目录

- `src/lib/client-api.ts`：本地模式与云端模式适配层。
- `src/components/chat/`：知识输入、检索回答、引用与反馈。
- `src/components/mindmap/`：知识图谱展示、编辑和导出。
- `fc-proxy/index.js`：阿里云函数后端、健康检查、模型与知识库代理。
- `supabase-schema.sql`：服务端专用、关闭匿名访问的数据库结构。
- `src/lib/pdf-text.ts`：浏览器本地 PDF 文字与页码提取。
- `docs/product-and-technology-overview.md`：产品定位、信息压缩策略和完整技术栈概览。
- `docs/competitive-analysis-v8.md`：国际竞品、SaaS 场景与公平评测方案。
- `scripts/`：端到端和线上后端冒烟测试。
- `docs/`：产品、评测、SEO、On-call 与上线说明。

## 安全原则

1. 不在浏览器变量、源码、README、截图或日志中保存任何真实密钥。
2. Supabase 使用服务端 secret/service-role key；浏览器只访问阿里云函数。
3. 已经提交到 Git 历史的密钥必须在供应商控制台轮换；仅删除文件不能使旧密钥失效。
4. 上线前必须让 `/health` 返回 `200`，并让 `npm run test:backend` 全部通过。
