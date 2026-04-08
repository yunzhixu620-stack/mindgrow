"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { MindMapPanel } from "@/components/mindmap/mind-map-panel";
import { ChatPanel } from "@/components/chat/chat-panel";
import { Sidebar } from "@/components/layout/sidebar";
import { useMindGrowStore } from "@/store/mindgrow-store";
import type { MindMap } from "@/lib/db/database";
import { Category } from "@/types";

export default function Home() {
  const {
    currentMapId,
    setCurrentMapId,
    setMaps,
    setNodes,
    setEdges,
    saveChatHistory,
    loadChatHistory,
    maps,
    categories,
    setCategories,
  } = useMindGrowStore();
  const [mobileTab, setMobileTab] = useState<"chat" | "map">("chat");
  const [isMobile, setIsMobile] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCategoryId, setNewCategoryId] = useState<string | null>(null);
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryIcon, setNewCategoryIcon] = useState("📁");
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [showUncategorized, setShowUncategorized] = useState(true);
  const [contextMenu, setContextMenu] = useState<{ map: MindMap } | null>(null);
  const [actionSheet, setActionSheet] = useState<"none" | "map-actions" | "move-to">("none");
  const createRef = useRef<HTMLInputElement>(null);
  const catCreateRef = useRef<HTMLInputElement>(null);

  // Detect mobile
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Auto-focus create input
  useEffect(() => {
    if (isCreating && createRef.current) createRef.current.focus();
    if (isCreatingCategory && catCreateRef.current) catCreateRef.current.focus();
  }, [isCreating, isCreatingCategory]);

  // Fix iOS virtual keyboard not restoring viewport
  useEffect(() => {
    if (!isMobile) return;
    const visualViewport = window.visualViewport;
    if (!visualViewport) return;
    let prevHeight = visualViewport.height;
    const onResize = () => {
      if (visualViewport.height > prevHeight) {
        window.scrollTo(0, 0);
        document.documentElement.style.setProperty("--vh", `${visualViewport.height}px`);
      }
      prevHeight = visualViewport.height;
    };
    visualViewport.addEventListener("resize", onResize);
    return () => visualViewport.removeEventListener("resize", onResize);
  }, [isMobile]);

  // Close drawer on outside click (mobile)
  useEffect(() => {
    if (!drawerOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('.mobile-drawer-panel') || target.closest('.drawer-toggle-btn')) return;
      setDrawerOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [drawerOpen]);

  // Load maps & categories on mount
  useEffect(() => {
    Promise.all([
      fetch("/api/knowledge?action=maps").then((r) => r.json()),
      fetch("/api/knowledge?action=categories").then((r) => r.json()),
    ])
      .then(([{ maps }, { categories }]) => {
        setMaps(maps || []);
        setCategories(categories || []);
      })
      .catch(() => {});
  }, [setMaps, setCategories]);

  const reloadAll = useCallback(async () => {
    try {
      const [mapsRes, catsRes] = await Promise.all([
        fetch("/api/knowledge?action=maps"),
        fetch("/api/knowledge?action=categories"),
      ]);
      if (mapsRes.ok) {
        const { maps: allMaps } = await mapsRes.json();
        setMaps(allMaps);
      }
      if (catsRes.ok) {
        const { categories: allCats } = await catsRes.json();
        setCategories(allCats);
      }
    } catch (e) { console.error(e); }
  }, [setMaps, setCategories]);

  const handleSwitchMap = useCallback(async (mapId: string) => {
    if (mapId === currentMapId) { setDrawerOpen(false); return; }
    saveChatHistory();
    setCurrentMapId(mapId);
    setDrawerOpen(false);
    try {
      const res = await fetch(`/api/knowledge?mapId=${mapId}`);
      if (res.ok) {
        const { nodes, edges } = await res.json();
        setNodes(nodes || []);
        setEdges(edges || []);
      }
    } catch (e) { console.error(e); }
    loadChatHistory(mapId);
  }, [currentMapId, setCurrentMapId, setNodes, setEdges, saveChatHistory, loadChatHistory]);

  const handleCreateMap = useCallback(async () => {
    if (!newName.trim()) { setIsCreating(false); setNewName(""); return; }
    try {
      const res = await fetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "createMap", name: newName.trim(), categoryId: newCategoryId }),
      });
      if (res.ok) {
        const { map } = await res.json();
        saveChatHistory();
        setCurrentMapId(map.id);
        const dataRes = await fetch(`/api/knowledge?mapId=${map.id}`);
        if (dataRes.ok) {
          const { nodes, edges } = await dataRes.json();
          setNodes(nodes || []);
          setEdges(edges || []);
        }
        loadChatHistory(map.id);
        await reloadAll();
      }
    } catch (e) { console.error(e); }
    setIsCreating(false);
    setNewName("");
    setNewCategoryId(null);
    setDrawerOpen(false);
  }, [newName, newCategoryId, setCurrentMapId, setMaps, setNodes, setEdges, saveChatHistory, loadChatHistory, reloadAll]);

  const handleDeleteMap = useCallback(async (map: MindMap) => {
    if (map.isDefault) return;
    try {
      await fetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deleteMap", mapId: map.id }),
      });
      await reloadAll();
      if (map.id === currentMapId) handleSwitchMap("map_default");
    } catch (e) { console.error(e); }
    setActionSheet("none");
    setContextMenu(null);
  }, [currentMapId, handleSwitchMap, reloadAll]);

  const handleCreateCategory = useCallback(async () => {
    if (!newCategoryName.trim()) { setIsCreatingCategory(false); return; }
    try {
      await fetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "createCategory", name: newCategoryName.trim(), icon: newCategoryIcon }),
      });
      await reloadAll();
    } catch (e) { console.error(e); }
    setNewCategoryName("");
    setNewCategoryIcon("📁");
    setIsCreatingCategory(false);
  }, [newCategoryName, newCategoryIcon, reloadAll]);

  const handleMoveMap = useCallback(async (mapId: string, categoryId: string | null) => {
    try {
      await fetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "moveMapToCategory", mapId, categoryId }),
      });
      await reloadAll();
    } catch (e) { console.error(e); }
    setActionSheet("none");
    setContextMenu(null);
  }, [reloadAll]);

  // Load data when map changes (desktop only, mobile handles in handleSwitchMap)
  useEffect(() => {
    if (isMobile) return;
    fetch(`/api/knowledge?mapId=${currentMapId}`)
      .then((r) => r.json())
      .then((data) => {
        setNodes(data.nodes || []);
        setEdges(data.edges || []);
      })
      .catch(() => {});
    loadChatHistory(currentMapId);
  }, [isMobile, currentMapId, setNodes, setEdges, loadChatHistory]);

  // Group maps by category
  const uncategorizedMaps = maps.filter((m) => !m.categoryId);
  const categorizedMaps = categories.map((cat) => ({
    category: cat,
    maps: maps.filter((m) => m.categoryId === cat.id),
  }));

  const FOLDER_ICONS = ["📁", "📂", "📚", "🎯", "💡", "🔬", "🎨", "💼", "🏠", "🧪", "📖", "🌍", "💻", "🧠", "🎮", "📝"];

  // Mobile layout
  if (isMobile) {
    return (
      <main className="flex flex-col h-full w-full overflow-hidden bg-[var(--bg-base)]">
        {/* Mobile tab bar */}
        <div
          className="flex items-center border-b border-[var(--border)] bg-[var(--card)] shrink-0"
          style={{
            paddingTop: "max(env(safe-area-inset-top), 20px)",
          }}
        >
          {/* Map list toggle */}
          <button
            onClick={() => setDrawerOpen(!drawerOpen)}
            className={`drawer-toggle-btn flex items-center justify-center w-11 shrink-0 h-full transition-colors cursor-pointer ${
              drawerOpen ? "text-[var(--primary)]" : "text-[var(--muted-foreground)]"
            }`}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>

          <button
            onClick={() => setMobileTab("chat")}
            className={`flex-1 py-3 text-xs font-medium transition-all cursor-pointer ${
              mobileTab === "chat" ? "text-[var(--primary)] border-b-2 border-[var(--primary)]" : "text-[var(--muted-foreground)]"
            }`}
          >
            💬 对话
          </button>
          <button
            onClick={() => setMobileTab("map")}
            className={`flex-1 py-3 text-xs font-medium transition-all cursor-pointer ${
              mobileTab === "map" ? "text-[var(--primary)] border-b-2 border-[var(--primary)]" : "text-[var(--muted-foreground)]"
            }`}
          >
            🌿 导图
          </button>
        </div>

        {/* Drawer backdrop + panel */}
        {drawerOpen && (
          <div className="fixed inset-0 z-[200] flex">
            <div className="flex-1 bg-black/30" onClick={() => setDrawerOpen(false)} />
            <div
              className="mobile-drawer-panel w-[280px] bg-[var(--card)] border-r border-[var(--border)] flex flex-col shrink-0 animate-[slideIn_0.2s_ease]"
              style={{ paddingTop: "env(safe-area-inset-top)" }}
            >
              {/* Drawer header */}
              <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between shrink-0">
                <span className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">知识库</span>
                <div className="flex gap-1">
                  {/* Prominent create buttons */}
                  <button
                    onClick={() => { setIsCreating(true); setNewCategoryId(null); }}
                    className="w-7 h-7 flex items-center justify-center rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] cursor-pointer"
                    title="新建知识库"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setIsCreatingCategory(true)}
                    className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[var(--bg-hover)] text-[var(--muted-foreground)] cursor-pointer"
                    title="新建文件夹"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /><line x1="12" y1="11" x2="12" y2="17" /><line x1="9" y1="14" x2="15" y2="14" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setDrawerOpen(false)}
                    className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[var(--bg-hover)] text-[var(--muted-foreground)] transition-colors cursor-pointer"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
                  </button>
                </div>
              </div>

              {/* Map list grouped by category */}
              <div className="flex-1 overflow-y-auto py-2">
                {/* Categorized sections */}
                {categorizedMaps.map(({ category, maps: catMaps }) => {
                  const isExpanded = expandedCategories.has(category.id) || catMaps.length > 0;
                  return (
                    <div key={category.id}>
                      {/* Category header */}
                      <button
                        onClick={() => {
                          const newSet = new Set(expandedCategories);
                          if (newSet.has(category.id)) newSet.delete(category.id);
                          else newSet.add(category.id);
                          setExpandedCategories(newSet);
                        }}
                        className="w-full px-4 py-2.5 flex items-center gap-2 text-left hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                      >
                        <svg
                          width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                          className={`text-[var(--muted-foreground)] transition-transform ${isExpanded ? "rotate-90" : ""}`}
                        >
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                        <span className="text-xs">{category.icon}</span>
                        <span className="text-xs font-medium text-[var(--text-primary)] flex-1 truncate">{category.name}</span>
                        <span className="text-[10px] text-[var(--muted-foreground)]">{catMaps.length}</span>
                      </button>

                      {/* Maps in category */}
                      {isExpanded && (
                        <div className="ml-3 border-l border-[var(--border)]">
                          {catMaps.map((map) => (
                            <button
                              key={map.id}
                              onClick={() => handleSwitchMap(map.id)}
                              onContextMenu={(e) => { e.preventDefault(); setContextMenu({ map }); setActionSheet("map-actions"); }}
                              className={`w-full px-4 py-2.5 flex items-center gap-3 text-left transition-colors cursor-pointer ${
                                currentMapId === map.id
                                  ? "bg-[var(--primary)]/10 border-l-2 border-[var(--primary)]"
                                  : "hover:bg-[var(--bg-hover)] border-l-2 border-transparent"
                              }`}
                            >
                              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: map.color }} />
                              <div className="flex-1 min-w-0">
                                <div className={`text-xs font-medium truncate ${
                                  currentMapId === map.id ? "text-[var(--primary)]" : "text-[var(--text-primary)]"
                                }`}>{map.name}</div>
                                <div className="text-[10px] text-[var(--muted-foreground)]">{map.nodeCount || 0} 节点</div>
                              </div>
                            </button>
                          ))}
                          {catMaps.length === 0 && (
                            <div className="px-4 py-2 text-[10px] text-[var(--muted-foreground)] italic">空文件夹</div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Uncategorized */}
                {uncategorizedMaps.length > 0 && (
                  <div>
                    <button
                      onClick={() => setShowUncategorized(!showUncategorized)}
                      className="w-full px-4 py-2.5 flex items-center gap-2 text-left hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={`text-[var(--muted-foreground)] transition-transform ${showUncategorized ? "rotate-90" : ""}`}>
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                      <span className="text-xs font-medium text-[var(--muted-foreground)] flex-1">未分类</span>
                      <span className="text-[10px] text-[var(--muted-foreground)]">{uncategorizedMaps.length}</span>
                    </button>
                    {showUncategorized && (
                      <div className="ml-3 border-l border-[var(--border)]">
                        {uncategorizedMaps.map((map) => (
                          <button
                            key={map.id}
                            onClick={() => handleSwitchMap(map.id)}
                            onContextMenu={(e) => { e.preventDefault(); setContextMenu({ map }); setActionSheet("map-actions"); }}
                            className={`w-full px-4 py-2.5 flex items-center gap-3 text-left transition-colors cursor-pointer ${
                              currentMapId === map.id
                                ? "bg-[var(--primary)]/10 border-l-2 border-[var(--primary)]"
                                : "hover:bg-[var(--bg-hover)] border-l-2 border-transparent"
                            }`}
                          >
                            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: map.color }} />
                            <div className="flex-1 min-w-0">
                              <div className={`text-xs font-medium truncate ${
                                currentMapId === map.id ? "text-[var(--primary)]" : "text-[var(--text-primary)]"
                              }`}>{map.name}</div>
                              <div className="text-[10px] text-[var(--muted-foreground)]">{map.nodeCount || 0} 节点</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Create new map inline */}
                {isCreating && (
                  <div className="px-4 py-3 space-y-2 border-t border-[var(--border)] mt-2 pt-3">
                    <input
                      ref={createRef}
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleCreateMap();
                        if (e.key === "Escape") { setIsCreating(false); setNewName(""); setNewCategoryId(null); }
                      }}
                      placeholder="知识库名称..."
                      className="w-full bg-[var(--bg-base)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--muted-foreground)] outline-none focus:border-[var(--primary)]"
                    />
                    {/* Category picker */}
                    {categories.length > 0 && (
                      <select
                        value={newCategoryId || ""}
                        onChange={(e) => setNewCategoryId(e.target.value || null)}
                        className="w-full bg-[var(--bg-base)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-xs text-[var(--text-primary)] outline-none"
                      >
                        <option value="">未分类</option>
                        {categories.map((cat) => (
                          <option key={cat.id} value={cat.id}>{cat.icon} {cat.name}</option>
                        ))}
                      </select>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={handleCreateMap}
                        disabled={!newName.trim()}
                        className="flex-1 py-2 bg-[var(--primary)] text-[var(--primary-foreground)] rounded-lg text-xs font-medium cursor-pointer disabled:opacity-40"
                      >
                        创建
                      </button>
                      <button
                        onClick={() => { setIsCreating(false); setNewName(""); setNewCategoryId(null); }}
                        className="flex-1 py-2 bg-[var(--border)] text-[var(--text-primary)] rounded-lg text-xs cursor-pointer"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                )}

                {/* Create new category inline */}
                {isCreatingCategory && (
                  <div className="px-4 py-3 space-y-2 border-t border-[var(--border)] mt-2 pt-3">
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <button
                          onClick={() => setShowIconPicker(!showIconPicker)}
                          className="w-8 h-8 flex items-center justify-center rounded-lg bg-[var(--bg-base)] border border-[var(--border)] text-sm cursor-pointer"
                        >
                          {newCategoryIcon}
                        </button>
                        {showIconPicker && (
                          <div className="absolute top-full left-0 mt-1 z-[300] bg-[var(--card)] border border-[var(--border)] rounded-xl shadow-xl p-2 grid grid-cols-4 gap-1 min-w-[140px]">
                            {FOLDER_ICONS.map((icon) => (
                              <button
                                key={icon}
                                onClick={() => { setNewCategoryIcon(icon); setShowIconPicker(false); }}
                                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[var(--bg-hover)] text-base cursor-pointer"
                              >
                                {icon}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <input
                        ref={catCreateRef}
                        value={newCategoryName}
                        onChange={(e) => setNewCategoryName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleCreateCategory();
                          if (e.key === "Escape") { setIsCreatingCategory(false); setNewCategoryName(""); }
                        }}
                        placeholder="文件夹名称..."
                        className="flex-1 bg-[var(--bg-base)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--muted-foreground)] outline-none focus:border-[var(--primary)]"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={handleCreateCategory}
                        disabled={!newCategoryName.trim()}
                        className="flex-1 py-2 bg-[var(--primary)] text-[var(--primary-foreground)] rounded-lg text-xs font-medium cursor-pointer disabled:opacity-40"
                      >
                        创建
                      </button>
                      <button
                        onClick={() => { setIsCreatingCategory(false); setNewCategoryName(""); setNewCategoryIcon("📁"); }}
                        className="flex-1 py-2 bg-[var(--border)] text-[var(--text-primary)] rounded-lg text-xs cursor-pointer"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Mobile action sheet (context menu replacement) */}
        {actionSheet !== "none" && contextMenu && (
          <div className="fixed inset-0 z-[300] flex items-end" onClick={() => { setActionSheet("none"); setContextMenu(null); }}>
            <div className="flex-1 bg-black/30" />
            <div
              className="bg-[var(--card)] rounded-t-2xl w-full max-w-[400px] mx-auto p-4 pb-8 border-t border-[var(--border)]"
              style={{ paddingBottom: "max(env(safe-area-inset-bottom), 32px)" }}
              onClick={(e) => e.stopPropagation()}
            >
              {actionSheet === "map-actions" && (
                <>
                  <div className="text-xs font-semibold text-[var(--text-primary)] mb-3 px-1">{contextMenu.map.name}</div>
                  {!contextMenu.map.isDefault && (
                    <div className="space-y-1">
                      <button
                        onClick={() => { setActionSheet("move-to"); }}
                        className="w-full py-3 px-4 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded-xl cursor-pointer transition-colors"
                      >
                        📂 移动到文件夹
                      </button>
                      <button
                        onClick={() => handleDeleteMap(contextMenu.map)}
                        className="w-full py-3 px-4 text-left text-xs text-red-400 hover:bg-red-500/10 rounded-xl cursor-pointer transition-colors"
                      >
                        🗑️ 删除
                      </button>
                    </div>
                  )}
                  {contextMenu.map.isDefault && (
                    <div className="text-xs text-[var(--muted-foreground)] px-1">默认知识库不可操作</div>
                  )}
                  <button
                    onClick={() => { setActionSheet("none"); setContextMenu(null); }}
                    className="w-full mt-2 py-3 text-center text-xs text-[var(--muted-foreground)] cursor-pointer"
                  >
                    取消
                  </button>
                </>
              )}
              {actionSheet === "move-to" && contextMenu && (
                <>
                  <div className="text-xs font-semibold text-[var(--text-primary)] mb-3 px-1">移动到</div>
                  <div className="space-y-1">
                    <button
                      onClick={() => handleMoveMap(contextMenu.map.id, null)}
                      className="w-full py-3 px-4 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded-xl cursor-pointer transition-colors"
                    >
                      📂 未分类
                    </button>
                    {categories.map((cat) => (
                      <button
                        key={cat.id}
                        onClick={() => handleMoveMap(contextMenu.map.id, cat.id)}
                        className={`w-full py-3 px-4 text-left text-xs hover:bg-[var(--bg-hover)] rounded-xl cursor-pointer transition-colors ${
                          contextMenu.map.categoryId === cat.id ? "text-[var(--primary)] font-medium" : "text-[var(--text-primary)]"
                        }`}
                      >
                        {cat.icon} {cat.name}
                        {contextMenu.map.categoryId === cat.id && " ✓"}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => { setActionSheet("none"); setContextMenu(null); }}
                    className="w-full mt-2 py-3 text-center text-xs text-[var(--muted-foreground)] cursor-pointer"
                  >
                    取消
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {mobileTab === "chat" ? (
            <ChatPanel />
          ) : (
            <MindMapPanel />
          )}
        </div>
      </main>
    );
  }

  // Desktop layout
  return (
    <main className="flex h-full w-full overflow-hidden">
      <div className="flex h-full">
        <Sidebar />
        <ChatPanel />
      </div>
      <MindMapPanel />
    </main>
  );
}
