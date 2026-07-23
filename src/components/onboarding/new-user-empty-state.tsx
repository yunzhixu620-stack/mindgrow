"use client";

import type { AppMode } from "@/store/mindgrow-store";
import type { MindMap } from "@/types";
import { useLocale } from "@/components/i18n/locale-provider";
import type { AppLocale } from "@/lib/i18n";

export type OnboardingState = "loading" | "pending" | "dismissed" | "completed";

export const PERSONAL_NOTES_TEMPLATE = {
  root: "我的个人笔记",
  rootDesc: "从三个入口开始记录，内容可以继续扩展为知识图谱。",
  children: [
    { topic: "学习目标", desc: "想掌握的知识、技能与阶段目标", items: [] as string[] },
    { topic: "灵感想法", desc: "值得保留、验证或继续展开的想法", items: [] as string[] },
    { topic: "待办事项", desc: "下一步行动与需要跟进的任务", items: [] as string[] },
  ],
};

export function personalNotesTemplate(locale: AppLocale) {
  if (locale !== "en") return PERSONAL_NOTES_TEMPLATE;
  return {
    root: "My personal notes",
    rootDesc: "Start with three useful areas and expand them into a knowledge graph.",
    children: [
      { topic: "Learning goals", desc: "Knowledge, skills, and milestones to pursue", items: [] as string[] },
      { topic: "Ideas", desc: "Ideas worth keeping, testing, or expanding", items: [] as string[] },
      { topic: "Next actions", desc: "Tasks and follow-ups to complete", items: [] as string[] },
    ],
  };
}

export function onboardingStorageKey(tenantKey: string) {
  return `mindgrow:onboarding:v1:${tenantKey}`;
}

export function shouldShowNewUserEmptyState({
  mapCatalogReady,
  modeLibraryBusy,
  currentGraphReady,
  currentMode,
  maps,
  currentMapId,
  defaultMapId,
  nodeCount,
  onboardingState,
}: {
  mapCatalogReady: boolean;
  modeLibraryBusy: boolean;
  currentGraphReady: boolean;
  currentMode: AppMode;
  maps: MindMap[];
  currentMapId: string | null;
  defaultMapId?: string | null;
  nodeCount: number;
  onboardingState: OnboardingState;
}) {
  if (!mapCatalogReady || modeLibraryBusy || !currentGraphReady || currentMode !== "knowledge" || onboardingState !== "pending") return false;
  if (maps.length !== 1 || nodeCount !== 0 || !currentMapId) return false;
  const currentMap = maps.find((map) => map.id === currentMapId);
  return Boolean(currentMap && (currentMap.isDefault || currentMap.id === defaultMapId));
}

const cards = [
  { id: "personal-notes", icon: "🗒️", title: ["个人笔记", "Personal notes"], description: ["创建学习目标、灵感想法和待办事项三个起点。", "Create starting points for learning goals, ideas, and next actions."], action: ["创建笔记", "Create notes"] },
  { id: "article-reading", icon: "📄", title: ["论文速读", "Read a paper"], description: ["进入文章解析，粘贴网址、正文或上传 PDF。", "Open Articles and add a URL, pasted text, or PDF."], action: ["解析论文", "Parse a paper"] },
  { id: "meeting-notes", icon: "🎯", title: ["会议纪要", "Meeting notes"], description: ["进入会议助手，提取决议、行动项与风险。", "Extract decisions, action items, and risks from a meeting."], action: ["整理会议", "Process meeting"] },
] as const;

export function NewUserEmptyState({
  busy,
  error,
  onPersonalNotes,
  onArticleReading,
  onMeetingNotes,
  onDismiss,
}: {
  busy: boolean;
  error?: string;
  onPersonalNotes: () => void;
  onArticleReading: () => void;
  onMeetingNotes: () => void;
  onDismiss: () => void;
}) {
  const { locale } = useLocale();
  const english = locale === "en";
  const copyIndex = english ? 1 : 0;
  const actions = {
    "personal-notes": onPersonalNotes,
    "article-reading": onArticleReading,
    "meeting-notes": onMeetingNotes,
  };

  return (
    <section className="relative flex h-full w-full overflow-y-auto bg-[var(--background)] px-5 py-8 md:items-center md:justify-center" data-testid="new-user-empty-state">
      <button type="button" onClick={onDismiss} disabled={busy} className="absolute right-4 top-4 rounded-lg px-3 py-2 text-xs text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--foreground)] disabled:opacity-40" aria-label={english ? "Close onboarding" : "关闭新用户引导"}>{english ? "Not now" : "暂不使用"}</button>
      <div className="mx-auto w-full max-w-4xl">
        <div className="text-center">
          <div className="text-4xl">🌱</div>
          <h1 className="mt-4 text-xl font-semibold text-[var(--foreground)]">{english ? "Start with one real task" : "从一件真实任务开始"}</h1>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[var(--text-secondary)]">{english ? "Choose an entry point. MindGrow keeps the content in the right area, and you can decide later if you are unsure." : "选择一个入口，MindGrow 会把内容放进对应板块；不确定时可以稍后再选。"}</p>
        </div>
        <div className="mt-7 grid gap-3 md:grid-cols-3">
          {cards.map((card) => (
            <button
              key={card.id}
              type="button"
              onClick={actions[card.id]}
              disabled={busy}
              data-testid={`onboarding-${card.id}`}
              className="group rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-[var(--primary-border)] hover:bg-[var(--bg-hover)] disabled:cursor-wait disabled:opacity-50"
            >
              <span className="text-3xl" aria-hidden="true">{card.icon}</span>
              <h2 className="mt-4 text-sm font-semibold text-[var(--foreground)]">{card.title[copyIndex]}</h2>
              <p className="mt-2 min-h-12 text-xs leading-5 text-[var(--text-secondary)]">{card.description[copyIndex]}</p>
              <span className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-[var(--primary-hover)]">{busy && card.id === "personal-notes" ? (english ? "Creating…" : "正在创建…") : card.action[copyIndex]}<span aria-hidden="true">→</span></span>
            </button>
          ))}
        </div>
        {error && <div role="alert" className="mx-auto mt-4 max-w-xl rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-center text-xs text-red-300">{error}</div>}
      </div>
    </section>
  );
}
