"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useMindGrowStore } from "@/store/mindgrow-store";
import type { MindMap } from "@/types";
import { apiFetch } from "@/lib/client-api";
import { Category } from "@/types";
import { TemplateBrowser } from "@/components/template/template-browser";

interface LibrarySearchMatch {
  id: string;
  content: string;
  desc?: string;
  type: string;
}

interface LibrarySearchResult {
  map: MindMap;
  mapMatches: boolean;
  matches: LibrarySearchMatch[];
}

// ============================================================
// Category header (collapsible folder)
// ============================================================
function CategorySection({
  category,
  maps,
  currentMapId,
  onSwitch,
  onContextMenu,
  onDeleteCategory,
  onRenameCategory,
  defaultExpanded = true,
}: {
  category: Category | null; // null = uncategorized
  maps: MindMap[];
  currentMapId: string;
  onSwitch: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, map: MindMap) => void;
  onDeleteCategory?: (catId: string) => void;
  onRenameCategory?: (catId: string, name: string) => void;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(category?.name || "");
  const [dragOver, setDragOver] = useState(false);
  const editRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && editRef.current) editRef.current.focus();
  }, [editing]);

  const handleRename = useCallback(() => {
    if (!editing || !category) return;
    if (editName.trim() && onRenameCategory) {
      onRenameCategory(category.id, editName.trim());
    }
    setEditing(false);
  }, [editing, editName, category, onRenameCategory]);

  const title = category ? category.name : "未分类";

  return (
    <div
      className={`transition-colors rounded-lg ${dragOver ? "bg-[var(--primary)]/5" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); }}
    >
      {/* Category header */}
      <div
        className="flex items-center gap-1.5 px-2 py-1.5 cursor-pointer hover:bg-[var(--bg-hover)] rounded-lg transition-colors group"
        onClick={() => setExpanded(!expanded)}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          className={`text-[var(--muted-foreground)] transition-transform ${expanded ? "rotate-90" : ""}`}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        {category && (
          <span className="text-xs">{category.icon}</span>
        )}
        {editing ? (
          <input
            ref={editRef}
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRename();
              if (e.key === "Escape") { setEditing(false); setEditName(category?.name || ""); }
            }}
            onBlur={handleRename}
            className="flex-1 bg-[var(--bg-base)] border border-[var(--border)] rounded px-1.5 py-0.5 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--primary)] min-w-0"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="text-xs font-medium text-[var(--text-primary)] truncate flex-1">
            {title}
          </span>
        )}
        <span className="text-[10px] text-[var(--muted-foreground)]">{maps.length}</span>
        {category && !editing && (
          <div className="opacity-0 group-hover:opacity-100 flex gap-0.5 transition-opacity">
            <button
              onClick={(e) => { e.stopPropagation(); setEditing(true); setEditName(category.name); }}
              className="w-5 h-5 flex items-center justify-center rounded hover:bg-[var(--border)] text-[var(--muted-foreground)] cursor-pointer"
              title="重命名"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
            </button>
            {onDeleteCategory && (
              <button
                onClick={(e) => { e.stopPropagation(); onDeleteCategory(category.id); }}
                className="w-5 h-5 flex items-center justify-center rounded hover:bg-red-500/10 text-red-400 cursor-pointer"
                title="删除文件夹"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Maps in this category */}
      {expanded && (
        <div className="ml-2 border-l border-[var(--border)] pl-2">
          {maps.length === 0 && !category && (
            <div className="px-3 py-2 text-[10px] text-[var(--muted-foreground)] italic">
              空空如也
            </div>
          )}
          {maps.map((map) => (
            <MapItem
              key={map.id}
              map={map}
              isActive={map.id === currentMapId}
              onSwitch={onSwitch}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Single map item (draggable)
// ============================================================
function MapItem({
  map,
  isActive,
  onSwitch,
  onContextMenu,
}: {
  map: MindMap;
  isActive: boolean;
  onSwitch: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, map: MindMap) => void;
}) {
  return (
    <button
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", map.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={() => onSwitch(map.id)}
      onContextMenu={(e) => onContextMenu(e, map)}
      className={`w-full px-2.5 py-2 flex items-center gap-2 text-left transition-colors cursor-pointer group rounded-md my-0.5 ${
        isActive
          ? "bg-[var(--primary)]/10 border-l-2 border-[var(--primary)]"
          : "hover:bg-[var(--bg-hover)] border-l-2 border-transparent"
      }`}
    >
      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: map.color }} />
      <div className="flex-1 min-w-0">
        <div className={`text-xs font-medium truncate ${
          isActive ? "text-[var(--primary)]" : "text-[var(--text-primary)]"
        }`}>
          {map.name}
        </div>
        <div className="text-[10px] text-[var(--muted-foreground)]">
          {map.nodeCount || 0} 节点
        </div>
      </div>
    </button>
  );
}

// ============================================================
// Icon picker (simple emoji grid)
// ============================================================
const FOLDER_ICONS = ["📁", "📂", "📚", "🎯", "💡", "🔬", "🎨", "💼", "🏠", "🧪", "📖", "🌍", "💻", "🧠", "🎮", "📝"];

function IconPicker({ onSelect }: { onSelect: (icon: string) => void }) {
  return (
    <div className="absolute top-full left-0 mt-1 z-[300] bg-[var(--card)] border border-[var(--border)] rounded-xl shadow-xl p-2 grid grid-cols-4 gap-1 min-w-[140px]">
      {FOLDER_ICONS.map((icon) => (
        <button
          key={icon}
          onClick={() => onSelect(icon)}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[var(--bg-hover)] text-base cursor-pointer transition-colors"
        >
          {icon}
        </button>
      ))}
    </div>
  );
}

// ============================================================
// Main Sidebar component
// ============================================================
export function Sidebar() {
  const {
    maps,
    currentMapId,
    setCurrentMapId,
    sidebarOpen,
    setSidebarOpen,
    categories,
    setCategories,
    setSearchResults,
    setHighlightedNodeId,
  } = useMindGrowStore();

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    map: MindMap;
  } | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#22d3a7");
  const [newCategoryId, setNewCategoryId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryIcon, setNewCategoryIcon] = useState("📁");
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [librarySearch, setLibrarySearch] = useState("");
  const [librarySearchResults, setLibrarySearchResults] = useState<LibrarySearchResult[]>([]);
  const [isSearchingLibrary, setIsSearchingLibrary] = useState(false);
  const [librarySearchError, setLibrarySearchError] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const createRef = useRef<HTMLInputElement>(null);
  const catCreateRef = useRef<HTMLInputElement>(null);
  const librarySearchRef = useRef<HTMLInputElement>(null);
  const searchRequestRef = useRef(0);

  // Close context menu on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
      if (showIconPicker && !(e.target as HTMLElement).closest('.icon-picker-area')) {
        setShowIconPicker(false);
      }
    }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [showIconPicker]);

  // Auto-focus create input
  useEffect(() => {
    if (isCreating && createRef.current) createRef.current.focus();
    if (isCreatingCategory && catCreateRef.current) catCreateRef.current.focus();
  }, [isCreating, isCreatingCategory]);

  // Load categories on mount
  useEffect(() => {
    apiFetch("/api/knowledge?action=categories")
      .then((r) => r.json())
      .then((data) => setCategories(data.categories || []))
      .catch(() => {});
  }, [setCategories]);

  // Search map metadata and node content across the active local/cloud workspace.
  useEffect(() => {
    const query = librarySearch.trim();
    const requestId = ++searchRequestRef.current;
    if (!query) {
      setLibrarySearchResults([]);
      setLibrarySearchError("");
      setIsSearchingLibrary(false);
      return;
    }
    setIsSearchingLibrary(true);
    setLibrarySearchError("");
    const timer = window.setTimeout(async () => {
      try {
        const response = await apiFetch(`/api/knowledge?action=search&q=${encodeURIComponent(query)}`);
        if (!response.ok) throw new Error("Search failed");
        const data = await response.json();
        if (searchRequestRef.current !== requestId) return;
        setLibrarySearchResults(data.results || []);
      } catch {
        if (searchRequestRef.current !== requestId) return;
        setLibrarySearchResults([]);
        setLibrarySearchError("搜索暂时不可用，请稍后重试");
      } finally {
        if (searchRequestRef.current === requestId) setIsSearchingLibrary(false);
      }
    }, 220);
    return () => window.clearTimeout(timer);
  }, [librarySearch]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        setSidebarOpen(true);
        window.setTimeout(() => librarySearchRef.current?.focus(), 0);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [setSidebarOpen]);

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
      const res = await apiFetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "createMap",
          name: newName.trim(),
          color: newColor,
          categoryId: newCategoryId,
        }),
      });
      if (res.ok) {
        const { map } = await res.json();
        setCurrentMapId(map.id);
        setNewName("");
        setIsCreating(false);
        setNewCategoryId(null);
        // Reload maps and categories
        const [mapsRes, catsRes] = await Promise.all([
          apiFetch("/api/knowledge?action=maps"),
          apiFetch("/api/knowledge?action=categories"),
        ]);
        if (mapsRes.ok) {
          const { maps: allMaps } = await mapsRes.json();
          useMindGrowStore.getState().setMaps(allMaps);
        }
        if (catsRes.ok) {
          const { categories: allCats } = await catsRes.json();
          useMindGrowStore.getState().setCategories(allCats);
        }
        // Switch to the new map
        const dataRes = await apiFetch(`/api/knowledge?mapId=${map.id}`);
        if (dataRes.ok) {
          const { nodes, edges } = await dataRes.json();
          useMindGrowStore.getState().setNodes(nodes);
          useMindGrowStore.getState().setEdges(edges);
        }
      }
    } catch (e) {
      console.error("Failed to create map:", e);
    }
  }, [newName, newColor, newCategoryId, setCurrentMapId]);

  const handleSwitch = useCallback(async (mapId: string) => {
    setCurrentMapId(mapId);
    setContextMenu(null);
    setSearchResults([]);
    setHighlightedNodeId(null);
    try {
      const res = await apiFetch(`/api/knowledge?mapId=${mapId}`);
      if (res.ok) {
        const { nodes, edges } = await res.json();
        useMindGrowStore.getState().setNodes(nodes);
        useMindGrowStore.getState().setEdges(edges);
      }
    } catch (e) {
      console.error("Failed to switch map:", e);
    }
  }, [setCurrentMapId, setSearchResults, setHighlightedNodeId]);

  const handleSearchResultSelect = useCallback(async (result: LibrarySearchResult) => {
    await handleSwitch(result.map.id);
    const matchedNodeIds = result.matches.map((match) => match.id);
    setSearchResults(matchedNodeIds);
    setHighlightedNodeId(matchedNodeIds[0] || null);
    setLibrarySearch("");
  }, [handleSwitch, setSearchResults, setHighlightedNodeId]);

  const handleDelete = useCallback(async () => {
    if (!contextMenu) return;
    const { map } = contextMenu;
    if (map.isDefault) return;
    try {
      await apiFetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deleteMap", mapId: map.id }),
      });
      const mapsRes = await apiFetch("/api/knowledge?action=maps");
      if (mapsRes.ok) {
        const { maps: allMaps } = await mapsRes.json();
        useMindGrowStore.getState().setMaps(allMaps);
      }
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
      await apiFetch("/api/knowledge", {
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
      await apiFetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "renameMap", mapId: editingId, name: editName.trim() }),
      });
      const mapsRes = await apiFetch("/api/knowledge?action=maps");
      if (mapsRes.ok) {
        const { maps: allMaps } = await mapsRes.json();
        useMindGrowStore.getState().setMaps(allMaps);
      }
    } catch (e) {
      console.error("Failed to rename:", e);
    }
    setEditingId(null);
  }, [editingId, editName]);

  const handleCreateCategory = useCallback(async () => {
    if (!newCategoryName.trim()) {
      setIsCreatingCategory(false);
      return;
    }
    try {
      await apiFetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "createCategory",
          name: newCategoryName.trim(),
          icon: newCategoryIcon,
        }),
      });
      const catsRes = await apiFetch("/api/knowledge?action=categories");
      if (catsRes.ok) {
        const { categories: allCats } = await catsRes.json();
        setCategories(allCats);
      }
    } catch (e) {
      console.error("Failed to create category:", e);
    }
    setNewCategoryName("");
    setNewCategoryIcon("📁");
    setIsCreatingCategory(false);
  }, [newCategoryName, newCategoryIcon, setCategories]);

  const handleDeleteCategory = useCallback(async (catId: string) => {
    try {
      await apiFetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deleteCategory", categoryId: catId }),
      });
      const [mapsRes, catsRes] = await Promise.all([
        apiFetch("/api/knowledge?action=maps"),
        apiFetch("/api/knowledge?action=categories"),
      ]);
      if (mapsRes.ok) {
        const { maps: allMaps } = await mapsRes.json();
        useMindGrowStore.getState().setMaps(allMaps);
      }
      if (catsRes.ok) {
        const { categories: allCats } = await catsRes.json();
        setCategories(allCats);
      }
    } catch (e) {
      console.error("Failed to delete category:", e);
    }
  }, [setCategories]);

  const handleRenameCategory = useCallback(async (catId: string, name: string) => {
    try {
      await apiFetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "renameCategory", categoryId: catId, name }),
      });
      const catsRes = await apiFetch("/api/knowledge?action=categories");
      if (catsRes.ok) {
        const { categories: allCats } = await catsRes.json();
        setCategories(allCats);
      }
    } catch (e) {
      console.error("Failed to rename category:", e);
    }
  }, [setCategories]);

  const handleMoveMapToCategory = useCallback(async (mapId: string, categoryId: string | null) => {
    try {
      await apiFetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "moveMapToCategory", mapId, categoryId }),
      });
      const [mapsRes, catsRes] = await Promise.all([
        apiFetch("/api/knowledge?action=maps"),
        apiFetch("/api/knowledge?action=categories"),
      ]);
      if (mapsRes.ok) {
        const { maps: allMaps } = await mapsRes.json();
        useMindGrowStore.getState().setMaps(allMaps);
      }
      if (catsRes.ok) {
        const { categories: allCats } = await catsRes.json();
        setCategories(allCats);
      }
    } catch (e) {
      console.error("Failed to move map:", e);
    }
    setContextMenu(null);
  }, [setCategories]);

  // Group maps by category
  const uncategorizedMaps = maps.filter((m) => !m.categoryId);
  const categorizedMaps = categories.map((cat) => ({
    category: cat,
    maps: maps.filter((m) => m.categoryId === cat.id),
  }));

  const MAP_COLORS = ["#22d3a7", "#38bdf8", "#818cf8", "#f472b6", "#fb923c", "#a3e635", "#e879f9", "#f87171"];

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
    <div className="w-[240px] min-w-[220px] border-r border-[var(--border)] bg-[var(--card)] flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-3 border-b border-[var(--border)] flex items-center justify-between">
        <span className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">知识库</span>
        <div className="flex gap-1">
          {/* Prominent New Map button */}
          <button
            onClick={() => { setIsCreating(true); setNewCategoryId(null); }}
            className="w-7 h-7 flex items-center justify-center rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90 transition-opacity cursor-pointer"
            title="新建知识库"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          {/* New Category button */}
          <button
            onClick={() => setIsCreatingCategory(true)}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[var(--muted)] text-[var(--muted-foreground)] transition-colors cursor-pointer"
            title="新建文件夹"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /><line x1="12" y1="11" x2="12" y2="17" /><line x1="9" y1="14" x2="15" y2="14" />
            </svg>
          </button>
          {/* Template Center button */}
          <button
            onClick={() => setShowTemplates(true)}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[var(--muted)] text-[var(--muted-foreground)] transition-colors cursor-pointer"
            title="模板中心"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
          </button>
          <button
            onClick={() => setSidebarOpen(false)}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[var(--muted)] text-[var(--muted-foreground)] transition-colors cursor-pointer"
            title="收起"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
        </div>
      </div>

      <div className="border-b border-[var(--border)] px-3 py-2.5">
        <div className="relative">
          <svg className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            ref={librarySearchRef}
            value={librarySearch}
            onChange={(event) => setLibrarySearch(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Escape") setLibrarySearch(""); }}
            placeholder="搜索全部知识库..."
            aria-label="搜索全部知识库"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-base)] py-2 pl-8 pr-8 text-xs text-[var(--foreground)] outline-none transition-colors placeholder:text-[var(--muted-foreground)] focus:border-[var(--primary)]"
          />
          {librarySearch ? (
            <button
              onClick={() => setLibrarySearch("")}
              aria-label="清除知识库搜索"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer"
            >✕</button>
          ) : (
            <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-[var(--border)] px-1 py-0.5 text-[8px] text-[var(--muted-foreground)]">Ctrl K</kbd>
          )}
        </div>
      </div>

      {/* Map List grouped by category */}
      <div className="flex-1 overflow-y-auto py-2 space-y-0.5">
        {librarySearch.trim() ? (
          <div className="space-y-1 px-2">
            <div className="flex items-center justify-between px-1 pb-1 text-[10px] text-[var(--muted-foreground)]">
              <span>{isSearchingLibrary ? "正在搜索名称、描述和节点…" : `命中 ${librarySearchResults.length} 个知识库`}</span>
              {!isSearchingLibrary && librarySearchResults.length > 0 && <span>点击进入并高亮</span>}
            </div>
            {librarySearchError && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-[10px] text-red-400">{librarySearchError}</div>
            )}
            {!isSearchingLibrary && !librarySearchError && librarySearchResults.length === 0 && (
              <div className="rounded-lg border border-dashed border-[var(--border)] px-3 py-5 text-center text-[11px] text-[var(--muted-foreground)]">
                没有找到相关知识库或节点
              </div>
            )}
            {librarySearchResults.map((result) => (
              <button
                key={result.map.id}
                onClick={() => handleSearchResultSelect(result)}
                aria-label={`打开知识库 ${result.map.name}`}
                className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors cursor-pointer ${
                  result.map.id === currentMapId
                    ? "border-[var(--primary)]/40 bg-[var(--primary)]/10"
                    : "border-[var(--border)] bg-[var(--bg-base)] hover:border-[var(--primary)]/30 hover:bg-[var(--bg-hover)]"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: result.map.color }} />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--text-primary)]">{result.map.name}</span>
                  <span className="text-[9px] text-[var(--muted-foreground)]">{result.matches.length ? `${result.matches.length} 处命中` : "名称命中"}</span>
                </div>
                {result.matches.slice(0, 2).map((match) => (
                  <div key={match.id} className="mt-1.5 truncate border-l border-[var(--primary)]/40 pl-2 text-[10px] text-[var(--muted-foreground)]" title={match.content}>
                    {match.content}
                  </div>
                ))}
                {result.mapMatches && result.matches.length === 0 && result.map.description && (
                  <div className="mt-1.5 line-clamp-2 text-[10px] text-[var(--muted-foreground)]">{result.map.description}</div>
                )}
              </button>
            ))}
          </div>
        ) : (
          <>
            {/* Categorized maps */}
            {categorizedMaps.map(({ category, maps: catMaps }) => (
              <CategorySection
                key={category.id}
                category={category}
                maps={catMaps}
                currentMapId={currentMapId}
                onSwitch={handleSwitch}
                onContextMenu={handleContextMenu}
                onDeleteCategory={handleDeleteCategory}
                onRenameCategory={handleRenameCategory}
              />
            ))}

            {/* Uncategorized */}
            <CategorySection
              category={null}
              maps={uncategorizedMaps}
              currentMapId={currentMapId}
              onSwitch={handleSwitch}
              onContextMenu={handleContextMenu}
            />
          </>
        )}

        {/* Create new map inline */}
        {isCreating && (
          <div className="px-3 py-2 space-y-2 border-t border-[var(--border)] mt-1 pt-2">
            <input
              ref={createRef}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
                if (e.key === "Escape") { setIsCreating(false); setNewName(""); setNewCategoryId(null); }
              }}
              placeholder="知识库名称..."
              className="w-full bg-[var(--bg-base)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] outline-none focus:border-[var(--primary)]"
            />
            {/* Color picker */}
            <div className="flex gap-1.5">
              {MAP_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setNewColor(c)}
                  className={`w-5 h-5 rounded-full border-2 cursor-pointer transition-transform ${newColor === c ? "border-[var(--text-primary)] scale-110" : "border-transparent"}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            {/* Category picker */}
            {categories.length > 0 && (
              <select
                value={newCategoryId || ""}
                onChange={(e) => setNewCategoryId(e.target.value || null)}
                className="w-full bg-[var(--bg-base)] border border-[var(--border)] rounded-lg px-2.5 py-1 text-xs text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
              >
                <option value="">未分类</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.icon} {cat.name}</option>
                ))}
              </select>
            )}
            <div className="flex gap-2">
              <button
                onClick={handleCreate}
                disabled={!newName.trim()}
                className="flex-1 py-1.5 bg-[var(--primary)] text-[var(--primary-foreground)] rounded-lg text-xs font-medium hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-40"
              >
                创建
              </button>
              <button
                onClick={() => { setIsCreating(false); setNewName(""); setNewCategoryId(null); }}
                className="flex-1 py-1.5 bg-[var(--border)] text-[var(--foreground)] rounded-lg text-xs hover:opacity-80 transition-opacity cursor-pointer"
              >
                取消
              </button>
            </div>
          </div>
        )}

        {/* Create new category inline */}
        {isCreatingCategory && (
          <div className="px-3 py-2 space-y-2 border-t border-[var(--border)] mt-1 pt-2">
            <div className="flex items-center gap-2">
              <div className="relative icon-picker-area">
                <button
                  onClick={() => setShowIconPicker(!showIconPicker)}
                  className="w-7 h-7 flex items-center justify-center rounded-lg bg-[var(--bg-base)] border border-[var(--border)] text-sm cursor-pointer hover:bg-[var(--bg-hover)] transition-colors"
                >
                  {newCategoryIcon}
                </button>
                {showIconPicker && (
                  <IconPicker
                    onSelect={(icon) => { setNewCategoryIcon(icon); setShowIconPicker(false); }}
                  />
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
                className="flex-1 bg-[var(--bg-base)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] outline-none focus:border-[var(--primary)]"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleCreateCategory}
                disabled={!newCategoryName.trim()}
                className="flex-1 py-1.5 bg-[var(--primary)] text-[var(--primary-foreground)] rounded-lg text-xs font-medium hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-40"
              >
                创建
              </button>
              <button
                onClick={() => { setIsCreatingCategory(false); setNewCategoryName(""); setNewCategoryIcon("📁"); }}
                className="flex-1 py-1.5 bg-[var(--border)] text-[var(--foreground)] rounded-lg text-xs hover:opacity-80 transition-opacity cursor-pointer"
              >
                取消
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-[200] bg-[var(--card)] border border-[var(--border)] rounded-xl shadow-xl py-1 min-w-[160px]"
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
              {/* Move to category */}
              <div className="px-3 py-1.5 text-[10px] text-[var(--muted-foreground)] font-medium">移动到</div>
              <button
                onClick={() => handleMoveMapToCategory(contextMenu.map.id, null)}
                className="w-full px-3 py-2 text-xs text-left text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors cursor-pointer flex items-center gap-2"
              >
                <span className="text-sm">📂</span> 未分类
              </button>
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => handleMoveMapToCategory(contextMenu.map.id, cat.id)}
                  className={`w-full px-3 py-2 text-xs text-left hover:bg-[var(--muted)] transition-colors cursor-pointer flex items-center gap-2 ${
                    contextMenu.map.categoryId === cat.id ? "text-[var(--primary)]" : "text-[var(--foreground)]"
                  }`}
                >
                  <span className="text-sm">{cat.icon}</span> {cat.name}
                  {contextMenu.map.categoryId === cat.id && (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                  )}
                </button>
              ))}
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

      {/* Editing map name inline */}
      {editingId && (
        <div className="fixed inset-0 z-[250] flex items-center justify-center bg-black/30" onClick={() => setEditingId(null)}>
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 min-w-[240px] shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="text-xs font-medium text-[var(--text-primary)] mb-2">重命名知识库</div>
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRename();
                if (e.key === "Escape") setEditingId(null);
              }}
              className="w-full bg-[var(--bg-base)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--foreground)] outline-none focus:border-[var(--primary)] mb-3"
              autoFocus
            />
            <div className="flex gap-2">
              <button onClick={handleRename} disabled={!editName.trim()} className="flex-1 py-1.5 bg-[var(--primary)] text-[var(--primary-foreground)] rounded-lg text-xs font-medium hover:opacity-90 cursor-pointer disabled:opacity-40">确认</button>
              <button onClick={() => setEditingId(null)} className="flex-1 py-1.5 bg-[var(--border)] text-[var(--foreground)] rounded-lg text-xs cursor-pointer">取消</button>
            </div>
          </div>
        </div>
      )}
      {/* Template Browser */}
      {showTemplates && (
        <TemplateBrowser
          onSelect={async (template) => {
            setShowTemplates(false);
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
                setCurrentMapId(map.id);
                const [mapsRes, catsRes] = await Promise.all([
                  apiFetch("/api/knowledge?action=maps"),
                  apiFetch("/api/knowledge?action=categories"),
                ]);
                if (mapsRes.ok) {
                  const { maps: allMaps } = await mapsRes.json();
                  useMindGrowStore.getState().setMaps(allMaps);
                }
                if (catsRes.ok) {
                  const { categories: allCats } = await catsRes.json();
                  useMindGrowStore.getState().setCategories(allCats);
                }
                const dataRes = await apiFetch(`/api/knowledge?mapId=${map.id}`);
                if (dataRes.ok) {
                  const { nodes, edges } = await dataRes.json();
                  useMindGrowStore.getState().setNodes(nodes || []);
                  useMindGrowStore.getState().setEdges(edges || []);
                }
              }
            } catch (e) { console.error("Failed to create from template:", e); }
          }}
          onClose={() => setShowTemplates(false)}
        />
      )}
    </div>
  );
}
