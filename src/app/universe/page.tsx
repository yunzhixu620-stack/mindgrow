import Link from "next/link";
import type { Metadata } from "next";
import { UniverseView } from "@/components/universe/universe-view";
import { Header } from "@/components/layout/header";

export const metadata: Metadata = {
  title: "MindGrow — 知识宇宙",
};

export default function UniversePage() {
  return (
    <main className="flex flex-col h-screen w-screen overflow-hidden bg-[var(--background)]">
      <Header />
      <div className="flex-1 relative">
        <UniverseView />
        {/* Back to home button - floating */}
        <Link
          href="/"
          className="absolute top-4 left-4 z-50 flex items-center gap-2 px-4 py-2 bg-[var(--card)] border border-[var(--border)] rounded-xl text-xs text-[var(--foreground)] hover:bg-[var(--bg-hover)] transition-all shadow-lg no-underline"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5" /><path d="M12 19l-7-7 7-7" />
          </svg>
          返回知识导图
        </Link>
      </div>
    </main>
  );
}
