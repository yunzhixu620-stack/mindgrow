import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "AI 知识助手使用指南与场景",
  description: "了解如何用 MindGrow 采集知识、检索证据、生成可追溯回答，并把知识沉淀为可编辑导图。",
  alternates: { canonical: "https://yunzhixu620-stack.github.io/mindgrow/guide/" },
};

const capabilities = [
  ["低摩擦采集", "输入一个想法或粘贴一段资料，系统先生成可勾选的结构，确认后再写入知识库。"],
  ["证据优先检索", "提问时只从当前知识库召回相关节点，并在回答中展示编号引用；证据不足会明确说明。"],
  ["可编辑知识网络", "每次整理都会形成主题、概念和细节节点，可搜索、移动、编辑、折叠和导出。"],
  ["本地优先", "默认数据保存在当前浏览器，无需注册或配置密钥；连接云端后可切换为团队持久化。"],
];

const useCases = [
  "个人第二大脑：沉淀读书笔记、研究材料和长期兴趣主题",
  "产品与用户研究：连接访谈证据、竞品洞察、需求与决策",
  "会议知识库：把讨论、结论、负责人和行动项组织成可追溯结构",
  "客户支持：检索产品文档与历史案例，减少无依据回答",
  "学习与培训：构建课程知识图谱、复习问题和概念间关系",
  "专业服务：为咨询、法律、财务与医疗信息建立来源清晰的内部助手",
];

export default function GuidePage() {
  const faq = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      { "@type": "Question", name: "MindGrow 是否必须配置 AI 密钥？", acceptedAnswer: { "@type": "Answer", text: "不需要。默认本地模式可完成知识库创建、结构化整理、检索问答与导出；配置云端模型后可获得更丰富的语义整理能力。" } },
      { "@type": "Question", name: "回答是否会引用知识来源？", acceptedAnswer: { "@type": "Answer", text: "会。问题模式会先检索当前知识库，并在回答中列出匹配节点；没有依据时会明确提示知识缺口。" } },
      { "@type": "Question", name: "本地数据保存在哪里？", acceptedAnswer: { "@type": "Answer", text: "本地模式的数据保存在当前浏览器的本地存储中。清除浏览器数据前建议导出 Markdown、PNG 或 PDF。" } },
    ],
  };

  return (
    <main className="min-h-screen text-[var(--text-primary)]">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faq) }} />
      <nav className="sticky top-0 z-20 border-b border-[var(--border)] bg-[rgba(9,9,11,0.9)] backdrop-blur-xl">
        <div className="max-w-5xl mx-auto px-5 h-16 flex items-center justify-between">
          <Link href="/" className="font-semibold text-sm text-white no-underline">MindGrow</Link>
          <Link href="/" className="text-xs font-semibold rounded-lg px-4 py-2 bg-[var(--primary)] text-[var(--primary-foreground)] no-underline">立即体验</Link>
        </div>
      </nav>

      <article className="max-w-5xl mx-auto px-5 py-16 md:py-24">
        <header className="max-w-3xl mb-20">
          <div className="text-xs uppercase tracking-[0.18em] text-[var(--primary)] mb-5">AI Knowledge Assistant</div>
          <h1 className="text-4xl md:text-6xl font-semibold leading-tight tracking-tight mb-6">把碎片信息，变成可追溯的知识网络</h1>
          <p className="text-lg md:text-xl leading-relaxed text-[var(--text-secondary)]">MindGrow 是一款本地优先的 AI 知识助手。它先检索证据，再组织回答，并把对话结果沉淀为可编辑的知识导图。</p>
        </header>

        <section className="mb-20" aria-labelledby="capability-title">
          <h2 id="capability-title" className="text-2xl font-semibold mb-8">核心能力</h2>
          <div className="grid md:grid-cols-2 gap-4">
            {capabilities.map(([title, description]) => (
              <div key={title} className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-6">
                <h3 className="text-base font-semibold mb-3 text-[var(--primary-hover)]">{title}</h3>
                <p className="text-sm leading-7 text-[var(--text-secondary)]">{description}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-20" aria-labelledby="workflow-title">
          <h2 id="workflow-title" className="text-2xl font-semibold mb-8">三步完成知识闭环</h2>
          <ol className="grid md:grid-cols-3 gap-4 list-none">
            {[
              ["01", "记录", "输入知识、文章片段或一个问题。"],
              ["02", "核对", "检查结构与引用，删掉不需要的分支。"],
              ["03", "沉淀", "保存为知识节点，并继续检索、连接和导出。"],
            ].map(([number, title, description]) => (
              <li key={number} className="rounded-2xl bg-[var(--bg-elevated)] p-6">
                <div className="text-xs text-[var(--text-tertiary)] mb-6">{number}</div>
                <h3 className="text-lg font-semibold mb-2">{title}</h3>
                <p className="text-sm leading-7 text-[var(--text-secondary)]">{description}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="mb-20" aria-labelledby="scenes-title">
          <h2 id="scenes-title" className="text-2xl font-semibold mb-8">适用场景</h2>
          <ul className="grid md:grid-cols-2 gap-x-10 gap-y-4">
            {useCases.map((item) => <li key={item} className="text-sm leading-7 text-[var(--text-secondary)] border-b border-[var(--border-subtle)] pb-4">{item}</li>)}
          </ul>
        </section>

        <section className="mb-20" aria-labelledby="faq-title">
          <h2 id="faq-title" className="text-2xl font-semibold mb-8">常见问题</h2>
          <div className="space-y-4">
            {faq.mainEntity.map((item) => (
              <details key={item.name} className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-5">
                <summary className="cursor-pointer font-medium text-sm">{item.name}</summary>
                <p className="pt-4 text-sm leading-7 text-[var(--text-secondary)]">{item.acceptedAnswer.text}</p>
              </details>
            ))}
          </div>
        </section>

        <footer className="rounded-3xl border border-[var(--primary-border)] bg-[var(--primary-subtle)] p-8 md:p-12 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div>
            <h2 className="text-2xl font-semibold mb-2">从一条知识开始</h2>
            <p className="text-sm text-[var(--text-secondary)]">无需注册，数据默认保存在当前浏览器。</p>
          </div>
          <Link href="/" className="inline-flex justify-center text-sm font-semibold rounded-xl px-6 py-3 bg-[var(--primary)] text-[var(--primary-foreground)] no-underline">打开 MindGrow</Link>
        </footer>
      </article>
    </main>
  );
}
