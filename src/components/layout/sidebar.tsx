"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useMindGrowStore } from "@/store/mindgrow-store";
import type { MindMap } from "@/lib/db/database";

export function Sidebar() {
  const {
    maps,
    currentMapId,
    setCurrentMapId,
    sidebarOpen,
    setSidebarOpen,
  } = useMindGrowStore();

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    map: MindMap;
  } | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const createRef = useRef<HTMLInputElement>(null);

  // Close context menu on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  // Auto-focus create input
  useEffect(() => {
    if (isCreating && createRef.current) {
      createRef.current.focus();
    }
  }, [isCreating]);

  const handleContextMenu = useCallback((e: React.MouseEvent, map: MindMap) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, map });
  }, []);

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) {
      setIsCreating(false);
      return;
    }
    try {
      const res = await fetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "createMap", name: newName.trim() }),
      });
      if (res.ok) {
        const { map } = await res.json();
        setCurrentMapId(map.id);
        setNewName("");
        setIsCreating(false);
        // Reload maps
        const mapsRes = await fetch("/api/knowledge?action=maps");
        if (mapsRes.ok) {
          const { maps: allMaps } = await mapsRes.json();
          useMindGrowStore.getState().setMaps(allMaps);
        }
        // Switch to the new map
        const dataRes = await fetch(`/api/knowledge?mapId=${map.id}`);
        if (dataRes.ok) {
          const { nodes, edges } = await dataRes.json();
          useMindGrowStore.getState().setNodes(nodes);
          useMindGrowStore.getState().setEdges(edges);
        }
      }
    } catch (e) {
      console.error("Failed to create map:", e);
    }
  }, [newName, setCurrentMapId]);

  const handleSwitch = useCallback(async (mapId: string) => {
    setCurrentMapId(mapId);
    setContextMenu(null);
    try {
      const res = await fetch(`/api/knowledge?mapId=${mapId}`);
      if (res.ok) {
        const { nodes, edges } = await res.json();
        useMindGrowStore.getState().setNodes(nodes);
        useMindGrowStore.getState().setEdges(edges);
      }
    } catch (e) {
      console.error("Failed to switch map:", e);
    }
  }, [setCurrentMapId]);

  const handleDelete = useCallback(async () => {
    if (!contextMenu) return;
    const { map } = contextMenu;
    if (map.isDefault) return;
    try {
      await fetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deleteMap", mapId: map.id }),
      });
      // Reload maps
      const mapsRes = await fetch("/api/knowledge?action=maps");
      if (mapsRes.ok) {
        const { maps: allMaps } = await mapsRes.json();
        useMindGrowStore.getState().setMaps(allMaps);
      }
      // Switch to default if we deleted the current map
      if (map.id === currentMapId) {
        handleSwitch("map_default");
      }
    } catch (e) {
      console.error("Failed to delete map:", e);
    }
    setContextMenu(null);
  }, [contextMenu, currentMapId, handleSwitch]);

  const handleClear = useCallback(async () => {
    if (!contextMenu) return;
    const { map } = contextMenu;
    if (map.isDefault) return;
    try {
      await fetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clearMap", mapId: map.id }),
      });
      if (map.id === currentMapId) {
        useMindGrowStore.getState().setNodes([]);
        useMindGrowStore.getState().setEdges([]);
      }
    } catch (e) {
      console.error("Failed to clear map:", e);
    }
    setContextMenu(null);
  }, [contextMenu, currentMapId]);

  const handleRename = useCallback(async () => {
    if (!editingId || !editName.trim()) {
      setEditingId(null);
      return;
    }
    try {
      await fetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "renameMap", mapId: editingId, name: editName.trim() }),
      });
      // Reload maps
      const mapsRes = await fetch("/api/knowledge?action=maps");
      if (mapsRes.ok) {
        const { maps: allMaps } = await mapsRes.json();
        useMindGrowStore.getState().setMaps(allMaps);
      }
    } catch (e) {
      console.error("Failed to rename:", e);
    }
    setEditingId(null);
  }, [editingId, editName]);

  if (!sidebarOpen) {
    return (
      <button
        onClick={() => setSidebarOpen(true)}
        className="w-10 h-10 flex items-center justify-center bg-[var(--card)] border border-[var(--border)] rounded-xl hover:bg-[var(--muted)] transition-colors cursor-pointer"
        title="展开侧边栏"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>
    );
  }

  return (
    <div className="w-[220px] min-w-[200px] border-r border-[var(--border)] bg-[var(--card)] flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-3 border-b border-[var(--border)] flex items-center justify-between">
        <span className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">知识库</span>
        <div className="flex gap-1">
          <button
            onClick={() => setSidebarOpen(false)}
            className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-[var(--muted)] text-[var(--muted-foreground)] transition-colors cursor-pointer"
            title="收起"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
        </div>
      </div>

      {/* Map List */}
      <div className="flex-1 overflow-y-auto py-1">
        {maps.map((map) => (
          <div key={map.id}>
            {editingId === map.id ? (
              <div className="px-3 py-1.5">
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRename();
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  onBlur={handleRename}
                  className="w-full bg-[var(--background)] border border-[var(--border)] rounded-lg px-2 py-1 text-xs text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
                  autoFocus
                />
              </div>
            ) : (
              <button
                onClick={() => handleSwitch(map.id)}
                onContextMenu={(e) => handleContextMenu(e, map)}
                className={`w-full px-3 py-2 flex items-center gap-2.5 text-left transition-colors cursor-pointer group ${
                  currentMapId === map.id
                    ? "bg-[var(--primary)] bg-opacity-10 border-l-2 border-[var(--primary)]"
                    : "hover:bg-[var(--muted)]"
                }`}
              >
                <div
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: map.color }}
                />
                <div className="flex-1 min-w-0">
                  <div className={`text-xs font-medium truncate ${
                    currentMapId === map.id ? "text-[var(--primary)]" : "text-[var(--foreground)]"
                  }`}>
                    {map.name}
                  </div>
                  <div className="text-[10px] text-[var(--muted-foreground)]">
                    {map.nodeCount || 0} 个节点
                  </div>
                </div>
                {!map.isDefault && (
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[var(--muted-foreground)]">
                      <circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" />
                    </svg>
                  </div>
                )}
              </button>
            )}
          </div>
        ))}

        {/* Create new map */}
        {isCreating ? (
          <div className="px-3 py-2">
            <input
              ref={createRef}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
                if (e.key === "Escape") { setIsCreating(false); setNewName(""); }
              }}
              onBlur={() => { if (!newName.trim()) { setIsCreating(false); setNewName(""); } }}
              placeholder="输入知识库名称..."
              className="w-full bg-[var(--background)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-xs text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] outline-none focus:border-[var(--primary)]"
            />
          </div>
        ) : (
          <button
            onClick={() => setIsCreating(true)}
            className="w-full px-3 py-2 flex items-center gap-2 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors cursor-pointer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            新建知识库
          </button>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-[200] bg-[var(--card)] border border-[var(--border)] rounded-xl shadow-xl py-1 min-w-[140px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {!contextMenu.map.isDefault && (
            <>
              <button
                onClick={() => {
                  setEditingId(contextMenu.map.id);
                  setEditName(contextMenu.map.name);
                  setContextMenu(null);
                }}
                className="w-full px-3 py-2 text-xs text-left text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors cursor-pointer flex items-center gap-2"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                重命名
              </button>
              <button
                onClick={handleClear}
                className="w-full px-3 py-2 text-xs text-left text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors cursor-pointer flex items-center gap-2"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                清空
              </button>
              <div className="mx-2 my-1 border-t border-[var(--border)]" />
              <button
                onClick={handleDelete}
                className="w-full px-3 py-2 text-xs text-left text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer flex items-center gap-2"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                删除
              </button>
            </>
          )}
          {contextMenu.map.isDefault && (
            <div className="px-3 py-2 text-[10px] text-[var(--muted-foreground)]">
              默认知识库不可操作
            </div>
          )}
        </div>
      )}
    </div>
  );
}
