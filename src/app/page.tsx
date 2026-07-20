"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { MindMapPanel } from "@/components/mindmap/mind-map-panel";
import { ChatPanel } from "@/components/chat/chat-panel";
import { Sidebar } from "@/components/layout/sidebar";
import { useMindGrowStore, type AppMode } from "@/store/mindgrow-store";
import type { MindMap } from "@/types";
import { apiFetch } from "@/lib/client-api";
import { TemplateBrowser } from "@/components/template/template-browser";
import { useAuth } from "@/components/auth/auth-provider";
import { WorkspaceMenu } from "@/components/auth/workspace-menu";
import { MeetingAssistant } from "@/components/modes/meeting-assistant";
import { ArticleParser } from "@/components/modes/article-parser";
import { IS_LOCAL_MODE } from "@/lib/client-api";
import { MODE_LIBRARY_CONFIG, isMapForMode, modeLibraryDescription } from "@/lib/mode-libraries";

export default function Home() {
  const { currentWorkspace } = useAuth();
  const currentWorkspaceId = currentWorkspace?.id;
  const currentWorkspaceDefaultMapId = currentWorkspace?.defaultMapId;
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
    currentMode,
    setCurrentMode,
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
  const [showTemplates, setShowTemplates] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [showUncategorized, setShowUncategorized] = useState(true);
  const [contextMenu, setContextMenu] = useState<{ map: MindMap } | null>(null);
  const [actionSheet, setActionSheet] = useState<"none" | "map-actions" | "move-to">("none");
  const [modeLibraryBusy, setModeLibraryBusy] = useState(false);
  const [modeLibraryError, setModeLibraryError] = useState("");
  const [mapCatalogReady, setMapCatalogReady] = useState(false);
  const createRef = useRef<HTMLInputElement>(null);
  const catCreateRef = useRef<HTMLInputElement>(null);
  const activeModeRef = useRef<AppMode>("knowledge");
  const lastMapByModeRef = useRef<Partial<Record<AppMode, string>>>({ knowledge: "map_default" });
  const provisioningModeRef = useRef<AppMode | null>(null);
  const mapLoadRequestRef = useRef(0);

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
    if (!IS_LOCAL_MODE && !currentWorkspaceId) return;
    Promise.all([
      apiFetch("/api/knowledge?action=maps").then((r) => r.json()),
      apiFetch("/api/knowledge?action=categories").then((r) => r.json()),
    ])
      .then(([{ maps }, { categories }]) => {
        setMaps(maps || []);
        setCategories(categories || []);
        setMapCatalogReady(true);
      })
      .catch(() => setMapCatalogReady(true));
  }, [setMaps, setCategories, currentWorkspaceId]);

  useEffect(() => {
    if (!currentWorkspaceDefaultMapId) return;
    setMaps([]);
    setCategories([]);
    setMapCatalogReady(false);
    setNodes([]);
    setEdges([]);
    setCurrentMapId(currentWorkspaceDefaultMapId);
  }, [currentWorkspaceId, currentWorkspaceDefaultMapId, setMaps, setCategories, setNodes, setEdges, setCurrentMapId]);

  const reloadAll = useCallback(async (): Promise<MindMap[]> => {
    let allMaps: MindMap[] = [];
    try {
      const [mapsRes, catsRes] = await Promise.all([
        apiFetch("/api/knowledge?action=maps"),
        apiFetch("/api/knowledge?action=categories"),
      ]);
      if (mapsRes.ok) {
        const data = await mapsRes.json();
        allMaps = data.maps || [];
        setMaps(allMaps);
      }
      if (catsRes.ok) {
        const { categories: allCats } = await catsRes.json();
        setCategories(allCats);
      }
      setMapCatalogReady(true);
    } catch (e) { console.error(e); }
    return allMaps;
  }, [setMaps, setCategories]);

  const handleSwitchMap = useCallback((mapId: string) => {
    if (mapId === currentMapId) { setDrawerOpen(false); return; }
    // Invalidate any response that belongs to the previous library. The only
    // code that fetches graph data is the currentMapId effect below.
    ++mapLoadRequestRef.current;
    saveChatHistory();
    setCurrentMapId(mapId);
    loadChatHistory(mapId);
    setDrawerOpen(false);
  }, [currentMapId, setCurrentMapId, saveChatHistory, loadChatHistory]);

  // Switching product boards also switches to a board-owned knowledge library.
  // Meeting and article libraries are provisioned once, then reused on later visits.
  useEffect(() => {
    if (!mapCatalogReady) return;

    const previousMode = activeModeRef.current;
    const modeChanged = previousMode !== currentMode;
    if (modeChanged) {
      lastMapByModeRef.current[previousMode] = currentMapId;
      activeModeRef.current = currentMode;
      setModeLibraryError("");
      setModeLibraryBusy(true);
    } else if (modeLibraryError) {
      return;
    }

    const currentMap = maps.find((map) => map.id === currentMapId);
    if (currentMap && isMapForMode(currentMap, currentMode)) {
      lastMapByModeRef.current[currentMode] = currentMap.id;
      setModeLibraryBusy(false);
      return;
    }

    const rememberedId = lastMapByModeRef.current[currentMode];
    const target = maps.find((map) => map.id === rememberedId && isMapForMode(map, currentMode))
      || maps.find((map) => isMapForMode(map, currentMode));

    if (target) {
      setModeLibraryBusy(true);
      handleSwitchMap(target.id);
      return;
    }

    if (currentMode === "knowledge" || provisioningModeRef.current === currentMode) return;

    let cancelled = false;
    provisioningModeRef.current = currentMode;
    setModeLibraryBusy(true);
    const config = MODE_LIBRARY_CONFIG[currentMode];
    void apiFetch("/api/knowledge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "createMap",
        name: config.defaultName,
        description: modeLibraryDescription(currentMode),
        color: currentMode === "meeting" ? "#38bdf8" : "#a78bfa",
      }),
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || !data.map?.id) throw new Error(data.error || `无法创建${config.defaultName}`);
        if (cancelled) return;
        lastMapByModeRef.current[currentMode] = data.map.id;
        // Select first, then publish the refreshed catalog. Reversing this
        // order lets the mode effect issue a duplicate switch that invalidates
        // the sole graph request and leaves the board in a permanent spinner.
        handleSwitchMap(data.map.id);
        await reloadAll();
      })
      .catch((error) => {
        if (!cancelled) setModeLibraryError(error instanceof Error ? error.message : "知识库准备失败");
      })
      .finally(() => {
        if (provisioningModeRef.current === currentMode) provisioningModeRef.current = null;
        if (!cancelled) setModeLibraryBusy(false);
      });

    return () => { cancelled = true; };
  }, [currentMode, currentMapId, maps, mapCatalogReady, modeLibraryError, handleSwitchMap, reloadAll]);

  const handleCreateMap = useCallback(async () => {
    if (!newName.trim()) { setIsCreating(false); setNewName(""); return; }
    try {
      const res = await apiFetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "createMap",
          name: newName.trim(),
          categoryId: currentMode === "knowledge" ? newCategoryId : null,
          description: currentMode === "knowledge" ? "" : modeLibraryDescription(currentMode),
        }),
      });
      if (res.ok) {
        const { map } = await res.json();
        await reloadAll();
        handleSwitchMap(map.id);
      }
    } catch (e) { console.error(e); }
    setIsCreating(false);
    setNewName("");
    setNewCategoryId(null);
    setDrawerOpen(false);
  }, [newName, newCategoryId, currentMode, handleSwitchMap, reloadAll]);

  const handleDeleteMap = useCallback(async (map: MindMap) => {
    if (map.isDefault) return;
    try {
      await apiFetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deleteMap", mapId: map.id }),
      });
      const allMaps = await reloadAll();
      if (map.id === currentMapId) {
        const fallback = allMaps.find((item) => item.id !== map.id && isMapForMode(item, currentMode));
        if (fallback) handleSwitchMap(fallback.id);
        else {
          ++mapLoadRequestRef.current;
          setNodes([]);
          setEdges([]);
        }
      }
    } catch (e) { console.error(e); }
    setActionSheet("none");
    setContextMenu(null);
  }, [currentMapId, currentMode, handleSwitchMap, reloadAll, setNodes, setEdges]);

  const handleCreateCategory = useCallback(async () => {
    if (!newCategoryName.trim()) { setIsCreatingCategory(false); return; }
    try {
      await apiFetch("/api/knowledge", {
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
      await apiFetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "moveMapToCategory", mapId, categoryId }),
      });
      await reloadAll();
    } catch (e) { console.error(e); }
    setActionSheet("none");
    setContextMenu(null);
  }, [reloadAll]);

  // One authoritative graph loader for desktop, mobile and top-tab switches.
  // It validates both the map id and product mode before committing a response.
  useEffect(() => {
    if (!mapCatalogReady) return;
    const selectedMap = maps.find((map) => map.id === currentMapId);
    if (!selectedMap || !isMapForMode(selectedMap, currentMode)) return;
    const requestId = ++mapLoadRequestRef.current;
    const requestedMode = currentMode;
    setModeLibraryBusy(true);
    apiFetch(`/api/knowledge?mapId=${currentMapId}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("知识图谱加载失败");
        return response.json();
      })
      .then((data) => {
        if (requestId !== mapLoadRequestRef.current) return;
        const latest = useMindGrowStore.getState();
        if (latest.currentMapId !== currentMapId || latest.currentMode !== requestedMode) return;
        setNodes(data.nodes || []);
        setEdges(data.edges || []);
        setModeLibraryError("");
      })
      .catch((error) => {
        if (requestId === mapLoadRequestRef.current) setModeLibraryError(error instanceof Error ? error.message : "知识图谱加载失败");
      })
      .finally(() => {
        if (requestId === mapLoadRequestRef.current) setModeLibraryBusy(false);
      });
    loadChatHistory(currentMapId);
  }, [currentMapId, currentMode, maps, mapCatalogReady, setNodes, setEdges, loadChatHistory]);

  // Each product board owns a separate set of knowledge libraries.
  const visibleMaps = maps.filter((map) => isMapForMode(map, currentMode));
  const uncategorizedMaps = visibleMaps.filter((m) => !m.categoryId);
  const categorizedMaps = (currentMode === "knowledge" ? categories : []).map((cat) => ({
    category: cat,
    maps: visibleMaps.filter((m) => m.categoryId === cat.id),
  }));

  const FOLDER_ICONS = ["📁", "📂", "📚", "🎯", "💡", "🔬", "🎨", "💼", "🏠", "🧪", "📖", "🌍", "💻", "🧠", "🎮", "📝"];
  const modeConfig = MODE_LIBRARY_CONFIG[currentMode];
  const activeModePanel = currentMode !== "knowledge" && (modeLibraryBusy || modeLibraryError)
    ? (
      <div className="flex h-full w-full items-center justify-center bg-[var(--background)] px-6" data-testid="mode-library-state">
        <div className="max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 text-center shadow-xl">
          <div className="mb-3 text-3xl">{modeConfig.emoji}</div>
          <h2 className="text-base font-semibold text-[var(--foreground)]">{modeLibraryError ? `${modeConfig.defaultName}暂时不可用` : `正在进入${modeConfig.defaultName}`}</h2>
          <p className="mt-2 text-xs leading-6 text-[var(--muted-foreground)]">{modeLibraryError || "首次进入会自动创建独立知识库，后续将直接恢复上次内容。"}</p>
          {modeLibraryError && <button type="button" onClick={() => { setModeLibraryError(""); ++mapLoadRequestRef.current; setMapCatalogReady(false); void reloadAll(); }} className="mt-4 rounded-xl bg-[var(--primary)] px-4 py-2 text-xs font-semibold text-black">重新尝试</button>}
        </div>
      </div>
    )
    : currentMode === "meeting"
      ? <MeetingAssistant key={`meeting:${currentMapId}`} />
      : currentMode === "article"
        ? <ArticleParser key={`article:${currentMapId}`} />
        : <ChatPanel key={`knowledge:${currentMapId}`} />;

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

          {(["knowledge", "meeting", "article"] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => { setCurrentMode(mode); setMobileTab("chat"); }}
            className={`flex-1 py-3 text-xs font-medium transition-all cursor-pointer ${
              mobileTab === "chat" && currentMode === mode ? "text-[var(--primary)] border-b-2 border-[var(--primary)]" : "text-[var(--muted-foreground)]"
            }`}
          >
            {MODE_LIBRARY_CONFIG[mode].emoji} {MODE_LIBRARY_CONFIG[mode].shortLabel}
          </button>
          ))}
          <button
              onClick={() => setMobileTab("map")}
              className={`flex-1 py-3 text-xs font-medium transition-all cursor-pointer ${
                mobileTab === "map" ? "text-[var(--primary)] border-b-2 border-[var(--primary)]" : "text-[var(--muted-foreground)]"
              }`}
            >
              🌐 图谱
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
                <span className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">{modeConfig.defaultName}</span>
                <WorkspaceMenu compact />
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
                  {currentMode === "knowledge" && <button
                    onClick={() => setIsCreatingCategory(true)}
                    className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[var(--bg-hover)] text-[var(--muted-foreground)] cursor-pointer"
                    title="新建文件夹"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /><line x1="12" y1="11" x2="12" y2="17" /><line x1="9" y1="14" x2="15" y2="14" />
                    </svg>
                  </button>}
                  {currentMode === "knowledge" && <button
                    onClick={() => setShowTemplates(true)}
                    className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[var(--bg-hover)] text-[var(--muted-foreground)] cursor-pointer"
                    title="模板中心"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
                    </svg>
                  </button>}
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
                            <div key={map.id} className={`flex w-full items-center transition-colors ${currentMapId === map.id ? "bg-[var(--primary)]/10 border-l-2 border-[var(--primary)]" : "hover:bg-[var(--bg-hover)] border-l-2 border-transparent"}`}>
                              <button
                                onClick={() => handleSwitchMap(map.id)}
                                onContextMenu={(e) => { e.preventDefault(); setContextMenu({ map }); setActionSheet("map-actions"); }}
                                className="flex min-w-0 flex-1 items-center gap-3 px-4 py-2.5 text-left cursor-pointer"
                                aria-label={`打开知识库 ${map.name}`}
                              >
                                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: map.color }} />
                                <div className="flex-1 min-w-0">
                                  <div className={`text-xs font-medium truncate ${currentMapId === map.id ? "text-[var(--primary)]" : "text-[var(--text-primary)]"}`}>{map.name}</div>
                                  <div className="text-[10px] text-[var(--muted-foreground)]">{map.nodeCount || 0} 节点</div>
                                </div>
                              </button>
                              {!map.isDefault && <button type="button" onClick={() => { setContextMenu({ map }); setActionSheet("map-actions"); }} aria-label={`删除知识库 ${map.name}`} className="mr-2 flex h-9 w-9 items-center justify-center rounded-lg text-[var(--muted-foreground)] hover:bg-red-500/10 hover:text-red-400">🗑️</button>}
                            </div>
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
                          <div key={map.id} className={`flex w-full items-center transition-colors ${currentMapId === map.id ? "bg-[var(--primary)]/10 border-l-2 border-[var(--primary)]" : "hover:bg-[var(--bg-hover)] border-l-2 border-transparent"}`}>
                            <button
                              onClick={() => handleSwitchMap(map.id)}
                              onContextMenu={(e) => { e.preventDefault(); setContextMenu({ map }); setActionSheet("map-actions"); }}
                              className="flex min-w-0 flex-1 items-center gap-3 px-4 py-2.5 text-left cursor-pointer"
                              aria-label={`打开知识库 ${map.name}`}
                            >
                              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: map.color }} />
                              <div className="flex-1 min-w-0">
                                <div className={`text-xs font-medium truncate ${currentMapId === map.id ? "text-[var(--primary)]" : "text-[var(--text-primary)]"}`}>{map.name}</div>
                                <div className="text-[10px] text-[var(--muted-foreground)]">{map.nodeCount || 0} 节点</div>
                              </div>
                            </button>
                            {!map.isDefault && <button type="button" onClick={() => { setContextMenu({ map }); setActionSheet("map-actions"); }} aria-label={`删除知识库 ${map.name}`} className="mr-2 flex h-9 w-9 items-center justify-center rounded-lg text-[var(--muted-foreground)] hover:bg-red-500/10 hover:text-red-400">🗑️</button>}
                          </div>
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
                    {currentMode === "knowledge" && categories.length > 0 && (
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
            activeModePanel
          ) : (
            <MindMapPanel />
          )}
        </div>
        {/* Mobile Template Browser */}
        {showTemplates && (
          <TemplateBrowser
            onSelect={async (template) => {
              setShowTemplates(false);
              setDrawerOpen(false);
              try {
                const res = await apiFetch("/api/knowledge", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    action: "createFromTemplate",
                    name: template.mindMap.root,
                    description: template.mindMap.rootDesc || template.description,
                    color: "#22d3a7",
                    template: template.mindMap,
                  }),
                });
                if (res.ok) {
                  const { map } = await res.json();
                  saveChatHistory();
                  setCurrentMapId(map.id);
                  const dataRes = await apiFetch(`/api/knowledge?mapId=${map.id}`);
                  if (dataRes.ok) {
                    const { nodes, edges } = await dataRes.json();
                    setNodes(nodes || []);
                    setEdges(edges || []);
                  }
                  loadChatHistory(map.id);
                  await reloadAll();
                }
              } catch (e) { console.error(e); }
            }}
            onClose={() => setShowTemplates(false)}
          />
        )}
      </main>
    );
  }

  // All product boards share the same library → content → graph workspace.
  // Meeting and article keep isolated libraries but reuse the map interaction.
  return (
    <main className="flex h-full w-full overflow-hidden" data-testid={`${currentMode}-workspace`} data-current-map-id={currentMapId} data-library-busy={modeLibraryBusy ? "true" : "false"}>
      <Sidebar />
      <div className={currentMode === "knowledge" ? "flex h-full shrink-0" : "h-full w-[clamp(360px,36vw,520px)] shrink-0 border-r border-[var(--border)]"}>
        {activeModePanel}
      </div>
      <MindMapPanel />
    </main>
  );
}
