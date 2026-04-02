"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { MindMapPanel } from "@/components/mindmap/mind-map-panel";
import { ChatPanel } from "@/components/chat/chat-panel";
import { Sidebar } from "@/components/layout/sidebar";
import { useMindGrowStore } from "@/store/mindgrow-store";
import type { MindMap } from "@/lib/db/database";

export default function Home() {
  const { currentMapId, setCurrentMapId, setMaps, setNodes, setEdges, saveChatHistory, loadChatHistory, maps } = useMindGrowStore();
  const [mobileTab, setMobileTab] = useState<"chat" | "map">("chat");
  const [isMobile, setIsMobile] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const createRef = useRef<HTMLInputElement>(null);

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
  }, [isCreating]);

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

  // Load maps on mount
  useEffect(() => {
    fetch("/api/knowledge?action=maps")
      .then((r) => r.json())
      .then((data) => setMaps(data.maps || []))
      .catch(() => {});
  }, [setMaps]);

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
        body: JSON.stringify({ action: "createMap", name: newName.trim() }),
      });
      if (res.ok) {
        const { map } = await res.json();
        const mapsRes = await fetch("/api/knowledge?action=maps");
        if (mapsRes.ok) {
          const { maps: allMaps } = await mapsRes.json();
          setMaps(allMaps);
        }
        saveChatHistory();
        setCurrentMapId(map.id);
        const dataRes = await fetch(`/api/knowledge?mapId=${map.id}`);
        if (dataRes.ok) {
          const { nodes, edges } = await dataRes.json();
          setNodes(nodes || []);
          setEdges(edges || []);
        }
        loadChatHistory(map.id);
      }
    } catch (e) { console.error(e); }
    setIsCreating(false);
    setNewName("");
    setDrawerOpen(false);
  }, [newName, setCurrentMapId, setMaps, setNodes, setEdges, saveChatHistory, loadChatHistory]);

  const handleDeleteMap = useCallback(async (map: MindMap) => {
    if (map.isDefault) return;
    try {
      await fetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deleteMap", mapId: map.id }),
      });
      const mapsRes = await fetch("/api/knowledge?action=maps");
      if (mapsRes.ok) {
        const { maps: allMaps } = await mapsRes.json();
        setMaps(allMaps);
      }
      if (map.id === currentMapId) handleSwitchMap("map_default");
    } catch (e) { console.error(e); }
  }, [currentMapId, handleSwitchMap, setMaps]);

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
            <div className="flex-1 bg-black/30" />
            <div
              className="mobile-drawer-panel w-[260px] bg-[var(--card)] border-r border-[var(--border)] flex flex-col shrink-0 animate-[slideIn_0.2s_ease]"
              style={{ paddingTop: "env(safe-area-inset-top)" }}
            >
              {/* Drawer header */}
              <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between shrink-0">
                <span className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">知识库</span>
                <button
                  onClick={() => setDrawerOpen(false)}
                  className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[var(--bg-hover)] text-[var(--muted-foreground)] transition-colors cursor-pointer"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
                </button>
              </div>

              {/* Map list */}
              <div className="flex-1 overflow-y-auto py-1">
                {maps.map((map) => (
                  <button
                    key={map.id}
                    onClick={() => handleSwitchMap(map.id)}
                    className={`w-full px-4 py-3 flex items-center gap-3 text-left transition-colors cursor-pointer ${
                      currentMapId === map.id
                        ? "bg-[var(--primary)]/10 border-l-2 border-[var(--primary)]"
                        : "hover:bg-[var(--bg-hover)] border-l-2 border-transparent"
                    }`}
                  >
                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: map.color }} />
                    <div className="flex-1 min-w-0">
                      <div className={`text-xs font-medium truncate ${
                        currentMapId === map.id ? "text-[var(--primary)]" : "text-[var(--text-primary)]"
                      }`}>
                        {map.name}
                      </div>
                      <div className="text-[10px] text-[var(--muted-foreground)]">
                        {map.nodeCount || 0} 节点
                      </div>
                    </div>
                    {!map.isDefault && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteMap(map); }}
                        className="opacity-40 hover:opacity-100 p-1 transition-opacity"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-400">
                          <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    )}
                  </button>
                ))}

                {/* Create new */}
                {isCreating ? (
                  <div className="px-4 py-2">
                    <input
                      ref={createRef}
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleCreateMap();
                        if (e.key === "Escape") { setIsCreating(false); setNewName(""); }
                      }}
                      onBlur={() => { if (!newName.trim()) { setIsCreating(false); setNewName(""); } }}
                      placeholder="输入知识库名称..."
                      className="w-full bg-[var(--bg-base)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--muted-foreground)] outline-none focus:border-[var(--primary)]"
                    />
                  </div>
                ) : (
                  <button
                    onClick={() => setIsCreating(true)}
                    className="w-full px-4 py-3 flex items-center gap-2 text-xs text-[var(--muted-foreground)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    新建知识库
                  </button>
                )}
              </div>
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
