import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "产品说明、技术架构与隐私",
  description: "MindGrow 产品定位、三类知识工作流、GraphRAG 技术选型、隐私边界、当前价格与适用场景说明。",
  alternates: { canonical: "https://yunzhixu620-stack.github.io/mindgrow/product/" },
  openGraph: {
    type: "article",
    url: "https://yunzhixu620-stack.github.io/mindgrow/product/",
    title: "MindGrow 产品说明与技术架构",
    description: "面向研究、会议和碎片知识的可追溯 AI 知识工作区。",
  },
};

const modules = [
  ["知识碎片", "短文本直接拓展；长文本先压缩为层级导图；网页读取失败时拒绝基于网址猜测。", "随手想法、产品洞察、研究笔记"],
  ["文章解析", "支持网页、PDF 与正文，回答带引用；可生成 Audio Overview，并把实体关系并入知识宇宙。", "论文阅读、报告拆解、跨文档比较"],
  ["会议助手", "抽取结论、行动项、负责人、期限与风险；会议结果经用户确认后才进入长期知识库。", "项目会议、访谈、复盘与决策记录"],
];

const stack = [
  ["Next.js 15 + React", "静态导出适合 GitHub Pages，公开说明页可被搜索引擎索引；交互工作区仍保持组件化。"],
  ["Supabase Auth + Postgres + RLS", "统一登录、自动续期与关系型知识数据；RLS 和服务端成员校验承担租户隔离。"],
  ["阿里云函数计算", "承载鉴权、文章抓取、RAG 与模型编排，密钥不进入浏览器；中国网络与按量成本更可控。"],
  ["DashScope 大模型", "用于结构化整理、回答与实体关系抽取；失败时保留证据驱动的确定性降级路径。"],
  ["混合检索 + GraphRAG", "词法、语义、实体与路径共同召回，解决只靠相似度容易命中同义但错误内容的问题。"],
  ["React Flow + PDF.js", "用渐进展开的导图/网状图控制信息密度，并把 PDF 引用定位回页码和原文。"],
];

const boundaries = [
  "浏览器只使用 Supabase 的可公开项目配置；模型、数据库服务角色和邮件服务密钥只存在服务端或供应商控制台。",
  "普通用户只输入邮箱和密码。登录令牌自动续期，当前工作区自动附加到请求；界面不要求复制 token。",
  "工作区 ID 是路由上下文，不是授权凭证。后端仍以登录用户身份和成员关系做权限判断。",
  "回答引用必须来自实际保存的来源片段；证据不足、网页不可读或表格结构丢失时应明确拒答或降级。",
  "云端数据不以“本地优先”宣传；浏览器本地模式仅用于开发与演示，生产环境使用私有云工作区。",
];

const scenarios = [
  ["研究与论文", "连续导入论文，按实体、方法、指标和引用建立跨文档关系，再追问差异。"],
  ["产品团队", "连接访谈、竞品、需求、会议决策与上线反馈，保留每个结论的来源。"],
  ["客户支持", "从已审核文档回答问题；没有证据时拒答，降低幻觉带来的错误承诺。"],
  ["咨询与专业服务", "把多份材料整理为可审计的主题结构，快速定位事实、责任人和时间线。"],
];

export default function ProductPage() {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: "MindGrow 产品说明、技术架构与隐私",
    about: ["AI knowledge assistant", "GraphRAG", "knowledge graph", "meeting assistant", "document AI"],
    author: { "@type": "Organization", name: "MindGrow" },
    mainEntityOfPage: "https://yunzhixu620-stack.github.io/mindgrow/product/",
  };

  return (
    <main className="min-h-screen text-[var(--text-primary)]">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      <nav className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--nav-glass)] backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Link href="/" className="text-sm font-semibold no-underline">MindGrow</Link>
          <div className="flex items-center gap-4">
            <Link href="/guide/" className="text-xs font-medium text-[var(--text-secondary)] no-underline hover:text-[var(--text-primary)]">使用指南</Link>
            <Link href="/" className="rounded-lg bg-[var(--primary)] px-4 py-2 text-xs font-semibold text-[var(--primary-foreground)] no-underline">打开工作区</Link>
          </div>
        </div>
      </nav>

      <article className="mx-auto max-w-6xl px-5 py-16 md:py-24">
        <header className="mb-16 max-w-4xl">
          <div className="mb-5 text-xs uppercase tracking-[0.18em] text-[var(--primary)]">Product & Technology</div>
          <h1 className="mb-6 text-4xl font-semibold leading-tight tracking-tight md:text-6xl">面向证据的 AI 知识工作区</h1>
          <p className="text-lg leading-8 text-[var(--text-secondary)]">MindGrow 的定位不是通用文档编辑器，而是 Heptabase 式可视化知识组织、Mem 式低摩擦采集，加上独立的文章解析与会议工作流。核心承诺是：先定位证据，再回答，再把结果沉淀为可编辑知识。</p>
        </header>

        <section className="mb-16" aria-labelledby="positioning">
          <h2 id="positioning" className="mb-6 text-2xl font-semibold">产品定位</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {modules.map(([title, description, scene]) => (
              <div key={title} className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-6">
                <h3 className="mb-3 font-semibold text-[var(--primary-hover)]">{title}</h3>
                <p className="mb-5 text-sm leading-7 text-[var(--text-secondary)]">{description}</p>
                <p className="text-xs text-[var(--text-tertiary)]">适合：{scene}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-16" aria-labelledby="scenarios">
          <h2 id="scenarios" className="mb-6 text-2xl font-semibold">具体场景</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {scenarios.map(([title, description]) => (
              <div key={title} className="rounded-xl border border-[var(--border-subtle)] p-5">
                <h3 className="mb-2 text-sm font-semibold">{title}</h3>
                <p className="text-sm leading-7 text-[var(--text-secondary)]">{description}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-16" aria-labelledby="technology">
          <h2 id="technology" className="mb-3 text-2xl font-semibold">技术选型</h2>
          <p className="mb-7 max-w-3xl text-sm leading-7 text-[var(--text-secondary)]">选型优先级是证据真实性、租户隔离、可渐进迭代和早期成本，而不是为了堆技术名词。</p>
          <div className="overflow-x-auto rounded-2xl border border-[var(--border)]">
            <table className="w-full min-w-[680px] border-collapse text-left text-sm">
              <thead className="bg-[var(--bg-elevated)] text-[var(--text-primary)]"><tr><th className="w-52 px-5 py-4">技术</th><th className="px-5 py-4">选择原因</th></tr></thead>
              <tbody>{stack.map(([name, reason]) => <tr key={name} className="border-t border-[var(--border-subtle)]"><td className="px-5 py-4 font-medium">{name}</td><td className="px-5 py-4 leading-7 text-[var(--text-secondary)]">{reason}</td></tr>)}</tbody>
            </table>
          </div>
        </section>

        <section className="mb-16" aria-labelledby="privacy">
          <h2 id="privacy" className="mb-6 text-2xl font-semibold">隐私与安全</h2>
          <ul className="space-y-3">{boundaries.map((item) => <li key={item} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-5 py-4 text-sm leading-7 text-[var(--text-secondary)]">{item}</li>)}</ul>
        </section>

        <section className="mb-16 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-6">
            <h2 className="mb-3 text-xl font-semibold">价格说明</h2>
            <p className="text-sm leading-7 text-[var(--text-secondary)]">当前公开体验版为 0 元，正式商业价格尚未发布。这不是永久免费的承诺；后续计费应优先按 AI 用量、存储与团队席位拆分，并在收费前公开变更。</p>
          </div>
          <div className="rounded-2xl border border-[var(--primary-border)] bg-[var(--primary-subtle)] p-6">
            <h2 className="mb-3 text-xl font-semibold">当前边界</h2>
            <p className="text-sm leading-7 text-[var(--text-secondary)]">产品仍处于早期阶段。复杂表格、受登录保护的网页和极长文档可能降级；自定义生产 SMTP 尚待自有域名完成验证。</p>
          </div>
        </section>

        <footer className="flex flex-col gap-5 rounded-3xl border border-[var(--primary-border)] bg-[var(--primary-subtle)] p-8 md:flex-row md:items-center md:justify-between md:p-10">
          <div><h2 className="mb-2 text-2xl font-semibold">从可核验的知识开始</h2><p className="text-sm text-[var(--text-secondary)]">查看一分钟指南，或进入私有工作区。</p></div>
          <div className="flex gap-3"><Link href="/guide/" className="rounded-xl border border-[var(--border)] px-5 py-3 text-sm font-semibold no-underline">使用指南</Link><Link href="/" className="rounded-xl bg-[var(--primary)] px-5 py-3 text-sm font-semibold text-[var(--primary-foreground)] no-underline">开始使用</Link></div>
        </footer>
      </article>
    </main>
  );
}
