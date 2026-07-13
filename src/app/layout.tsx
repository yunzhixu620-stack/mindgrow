import type { Metadata, Viewport } from "next";
import "./globals.css";
import { MainLayout } from "@/components/layout/main-layout";

export const metadata: Metadata = {
  metadataBase: new URL("https://yunzhixu620-stack.github.io/mindgrow/"),
  title: {
    default: "MindGrow AI 知识助手 — 可追溯的知识导图与本地知识库",
    template: "%s | MindGrow",
  },
  description: "MindGrow 是本地优先的 AI 知识助手，把碎片想法、文章和问题整理为可检索、可追溯、可编辑的知识导图。无需注册即可体验。",
  keywords: ["AI 知识助手", "知识库", "知识导图", "知识管理", "RAG", "第二大脑", "AI knowledge assistant", "knowledge graph"],
  alternates: { canonical: "https://yunzhixu620-stack.github.io/mindgrow/" },
  openGraph: {
    type: "website",
    locale: "zh_CN",
    url: "https://yunzhixu620-stack.github.io/mindgrow/",
    siteName: "MindGrow",
    title: "MindGrow AI 知识助手",
    description: "先检索证据，再组织回答；把每次对话沉淀为可编辑知识网络。",
  },
  twitter: {
    card: "summary",
    title: "MindGrow AI 知识助手",
    description: "本地优先、引用可追溯的知识导图助手。",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "SoftwareApplication",
              name: "MindGrow",
              applicationCategory: "ProductivityApplication",
              operatingSystem: "Web",
              url: "https://yunzhixu620-stack.github.io/mindgrow/",
              description: "本地优先、回答引用可追溯的 AI 知识助手。",
              offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
            }),
          }}
        />
        <MainLayout>{children}</MainLayout>
      </body>
    </html>
  );
}
