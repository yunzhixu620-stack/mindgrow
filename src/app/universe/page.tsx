import Link from "next/link";
import type { Metadata } from "next";
import { UniverseView } from "@/components/universe/universe-view";

export const metadata: Metadata = {
  title: "MindGrow — 知识宇宙",
};

export default function UniversePage() {
  return (
    <main className="relative h-full w-full overflow-hidden bg-[var(--background)]">
      <UniverseView />
      {/* The global MainLayout already renders the application header. */}
      <Link
        href="/"
        className="absolute top-4 left-4 z-50 flex items-center gap-2 px-4 py-2 bg-[var(--card)] border border-[var(--border)] rounded-xl text-xs text-[var(--foreground)] hover:bg-[var(--bg-hover)] transition-all shadow-lg no-underline"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 12H5" /><path d="M12 19l-7-7 7-7" />
        </svg>
        返回当前知识库
      </Link>
    </main>
  );
}
