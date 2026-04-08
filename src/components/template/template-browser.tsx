"use client";

import { useState } from "react";
import { OFFICIAL_TEMPLATES, TEMPLATE_CATEGORIES, type Template } from "@/data/templates";

interface TemplateBrowserProps {
  onSelect: (template: Template) => void;
  onClose: () => void;
}

export function TemplateBrowser({ onSelect, onClose }: TemplateBrowserProps) {
  const [category, setCategory] = useState("全部");
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<Template | null>(null);

  const filtered = OFFICIAL_TEMPLATES.filter((t) => {
    if (category !== "全部" && t.category !== category) return false;
    if (search && !t.name.includes(search) && !t.description.includes(search) && !t.tags.some((tag) => tag.includes(search))) return false;
    return true;
  });

  return (
    <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-[var(--card)] border border-[var(--border)] rounded-2xl w-[90vw] max-w-[480px] max-h-[85vh] flex flex-col shadow-2xl"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 16px)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 pt-4 pb-3 border-b border-[var(--border)] shrink-0">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">模板中心</h2>
            <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[var(--bg-hover)] text-[var(--muted-foreground)] cursor-pointer">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
          </div>
          {/* Search */}
          <div className="relative mb-2">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索模板..."
              className="w-full bg-[var(--bg-base)] border border-[var(--border)] rounded-lg pl-8 pr-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--muted-foreground)] outline-none focus:border-[var(--primary)]"
            />
          </div>
          {/* Category tabs */}
          <div className="flex gap-1.5 overflow-x-auto">
            {TEMPLATE_CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                className={`px-3 py-1 rounded-full text-[10px] font-medium whitespace-nowrap cursor-pointer transition-colors ${
                  category === cat
                    ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                    : "bg-[var(--bg-base)] text-[var(--muted-foreground)] hover:text-[var(--text-primary)]"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Template list or preview */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {preview ? (
            /* Preview mode */
            <div>
              <button
                onClick={() => setPreview(null)}
                className="flex items-center gap-1 text-xs text-[var(--primary)] mb-3 cursor-pointer"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
                返回列表
              </button>
              <div className="text-center mb-4">
                <span className="text-3xl">{preview.icon}</span>
                <h3 className="text-sm font-semibold text-[var(--text-primary)] mt-2">{preview.name}</h3>
                <p className="text-xs text-[var(--muted-foreground)] mt-1">{preview.description}</p>
                <div className="flex gap-1.5 justify-center mt-2 flex-wrap">
                  {preview.tags.map((tag) => (
                    <span key={tag} className="px-2 py-0.5 rounded-full bg-[var(--bg-base)] text-[10px] text-[var(--muted-foreground)]">{tag}</span>
                  ))}
                </div>
              </div>
              {/* Preview tree */}
              <div className="bg-[var(--bg-base)] rounded-xl p-3 border border-[var(--border)]">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-3 h-3 rounded-full bg-[var(--primary)]" />
                  <span className="text-xs font-semibold text-[var(--text-primary)]">{preview.mindMap.root}</span>
                </div>
                {preview.mindMap.rootDesc && (
                  <div className="text-[10px] text-[var(--muted-foreground)] ml-5 mb-2">{preview.mindMap.rootDesc}</div>
                )}
                <div className="ml-2 border-l border-[var(--border)] pl-2 space-y-1.5">
                  {preview.mindMap.children.map((child, ci) => (
                    <div key={ci}>
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-[var(--primary)]/60" />
                        <span className="text-[11px] font-medium text-[var(--text-primary)]">{child.topic}</span>
                        <span className="text-[10px] text-[var(--muted-foreground)]">{child.items.length} 项</span>
                      </div>
                      {child.desc && (
                        <div className="text-[10px] text-[var(--muted-foreground)] ml-4">{child.desc}</div>
                      )}
                      <div className="ml-4 mt-0.5 space-y-0.5">
                        {child.items.map((item, ii) => (
                          <div key={ii} className="text-[10px] text-[var(--muted-foreground)] flex items-center gap-1.5">
                            <div className="w-1 h-1 rounded-full bg-[var(--border)]" />
                            {item}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <button
                onClick={() => onSelect(preview)}
                className="w-full mt-4 py-2.5 bg-[var(--primary)] text-[var(--primary-foreground)] rounded-xl text-xs font-semibold cursor-pointer hover:opacity-90 transition-opacity"
              >
                使用此模板创建知识库
              </button>
            </div>
          ) : (
            /* List mode */
            <div className="space-y-2">
              {filtered.length === 0 && (
                <div className="text-center py-8 text-xs text-[var(--muted-foreground)]">没有找到匹配的模板</div>
              )}
              {filtered.map((tpl) => (
                <button
                  key={tpl.id}
                  onClick={() => setPreview(tpl)}
                  className="w-full text-left p-3 rounded-xl border border-[var(--border)] hover:bg-[var(--bg-hover)] hover:border-[var(--primary)]/30 transition-colors cursor-pointer"
                >
                  <div className="flex items-start gap-3">
                    <span className="text-xl mt-0.5">{tpl.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-[var(--text-primary)]">{tpl.name}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-base)] text-[var(--muted-foreground)]">{tpl.category}</span>
                      </div>
                      <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5 line-clamp-2">{tpl.description}</p>
                      <div className="flex gap-1 mt-1.5">
                        {tpl.tags.slice(0, 3).map((tag) => (
                          <span key={tag} className="text-[9px] text-[var(--muted-foreground)]">#{tag}</span>
                        ))}
                      </div>
                    </div>
                    <svg className="text-[var(--muted-foreground)] shrink-0 mt-1" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
