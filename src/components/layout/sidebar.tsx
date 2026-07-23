"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useMindGrowStore } from "@/store/mindgrow-store";
import type { MindMap } from "@/types";
import { apiFetch } from "@/lib/client-api";
import { Category } from "@/types";
import { TemplateBrowser } from "@/components/template/template-browser";
import { MODE_LIBRARY_CONFIG, isMapForMode, modeLibraryDescription } from "@/lib/mode-libraries";
import Link from "next/link";
import { OrganizeLibraryDialog } from "@/components/layout/organize-library-dialog";
import { COMMAND_PALETTE_OPEN_EVENT } from "@/lib/command-search";
import { useAuth } from "@/components/auth/auth-provider";
import { needsLibraryOrganization } from "@/lib/knowledge-organizer";
import { useLocale } from "@/components/i18n/locale-provider";

// ============================================================
// Category header (collapsible folder)
// ============================================================
function CategorySection({
  category,
  maps,
  currentMapId,
  onSwitch,
  onContextMenu,
  onDeleteMap,
  onDeleteCategory,
  onRenameCategory,
  defaultExpanded = true,
}: {
  category: Category | null; // null = uncategorized
  maps: MindMap[];
  currentMapId: string;
  onSwitch: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, map: MindMap) => void;
  onDeleteMap: (map: MindMap) => void;
  onDeleteCategory?: (catId: string) => void;
  onRenameCategory?: (catId: string, name: string) => void;
  defaultExpanded?: boolean;
}) {
  const { locale } = useLocale();
  const english = locale === "en";
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

  const title = category ? category.name : (english ? "Uncategorized" : "未分类");

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
              title={english ? "Rename" : "重命名"}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
            </button>
            {onDeleteCategory && (
              <button
                onClick={(e) => { e.stopPropagation(); onDeleteCategory(category.id); }}
                className="w-5 h-5 flex items-center justify-center rounded hover:bg-red-500/10 text-red-400 cursor-pointer"
                title={english ? "Delete folder" : "删除文件夹"}
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
              {english ? "Nothing here yet" : "空空如也"}
            </div>
          )}
          {maps.map((map) => (
            <MapItem
              key={map.id}
              map={map}
              isActive={map.id === currentMapId}
              onSwitch={onSwitch}
              onContextMenu={onContextMenu}
              onDelete={onDeleteMap}
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
  onDelete,
}: {
  map: MindMap;
  isActive: boolean;
  onSwitch: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, map: MindMap) => void;
  onDelete: (map: MindMap) => void;
}) {
  return (
    <div className="group relative my-0.5 w-full">
      <button
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", map.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onClick={() => onSwitch(map.id)}
        onContextMenu={(e) => onContextMenu(e, map)}
        aria-label={`打开知识库 ${map.name}`}
        className={`w-full px-2.5 py-2 pr-9 flex items-center gap-2 text-left transition-colors cursor-pointer rounded-md ${
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
      {!map.isDefault && (
        <button
          type="button"
          onClick={(event) => { event.stopPropagation(); onDelete(map); }}
          aria-label={`删除知识库 ${map.name}`}
          title="删除知识库"
          className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-[var(--muted-foreground)] opacity-100 transition-all hover:bg-red-500/10 hover:text-red-400 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v5M14 11v5" /></svg>
        </button>
      )}
    </div>
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
interface SidebarProps {
  onSwitchMap: (mapId: string) => void;
  onMapCreated: (mapId: string) => Promise<void>;
}

export function Sidebar({ onSwitchMap, onMapCreated }: SidebarProps) {
  const { locale } = useLocale();
  const english = locale === "en";
  const { user, currentWorkspace } = useAuth();
  const {
    maps,
    currentMapId,
    sidebarOpen,
    setSidebarOpen,
    categories,
    setCategories,
    setSearchResults,
    setHighlightedNodeId,
    currentMode,
    setNodes,
    setEdges,
  } = useMindGrowStore();

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    map: MindMap;
  } | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<MindMap | null>(null);
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
  const [showOrganizer, setShowOrganizer] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const createRef = useRef<HTMLInputElement>(null);
  const catCreateRef = useRef<HTMLInputElement>(null);

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
          mode: currentMode,
          name: newName.trim(),
          color: newColor,
          categoryId: currentMode === "knowledge" ? newCategoryId : null,
          description: currentMode === "knowledge" ? "" : modeLibraryDescription(currentMode),
        }),
      });
      if (res.ok) {
        const { map } = await res.json();
        await onMapCreated(map.id);
        setNewName("");
        setIsCreating(false);
        setNewCategoryId(null);
      }
    } catch (e) {
      console.error("Failed to create map:", e);
    }
  }, [newName, newColor, newCategoryId, currentMode, onMapCreated]);

  const handleSwitch = useCallback((mapId: string) => {
    if (mapId === currentMapId) return;
    onSwitchMap(mapId);
    setContextMenu(null);
    setSearchResults([]);
    setHighlightedNodeId(null);
  }, [currentMapId, onSwitchMap, setSearchResults, setHighlightedNodeId]);

  const handleDeleteMap = useCallback(async (map: MindMap) => {
    if (map.isDefault) return;
    try {
      const deletion = await apiFetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        writeForMapId: map.id,
        body: JSON.stringify({ action: "deleteMap", mapId: map.id }),
      });
      if (!deletion.ok) throw new Error("删除知识库失败");
      const mapsRes = await apiFetch("/api/knowledge?action=maps");
      if (mapsRes.ok) {
        const { maps: allMaps } = await mapsRes.json();
        useMindGrowStore.getState().setMaps(allMaps);
        if (map.id === currentMapId) {
          const fallback = allMaps.find((candidate: MindMap) => candidate.id !== map.id && isMapForMode(candidate, currentMode));
          if (fallback) handleSwitch(fallback.id);
          else { setNodes([]); setEdges([]); }
        }
      }
    } catch (e) {
      console.error("Failed to delete map:", e);
    }
    setDeleteCandidate(null);
    setContextMenu(null);
  }, [currentMapId, handleSwitch, currentMode, setNodes, setEdges]);

  const handleDelete = useCallback(() => {
    if (!contextMenu?.map || contextMenu.map.isDefault) return;
    setDeleteCandidate(contextMenu.map);
    setContextMenu(null);
  }, [contextMenu]);

  const handleClear = useCallback(async () => {
    if (!contextMenu) return;
    const { map } = contextMenu;
    if (map.isDefault) return;
    try {
      await apiFetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        writeForMapId: map.id,
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
        writeForMapId: editingId,
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
        writeForMapId: mapId,
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

  const reloadOrganization = useCallback(async () => {
    const [mapsRes, catsRes] = await Promise.all([
      apiFetch("/api/knowledge?action=maps"),
      apiFetch("/api/knowledge?action=categories"),
    ]);
    if (mapsRes.ok) {
      const { maps: allMaps } = await mapsRes.json();
      useMindGrowStore.getState().setMaps(allMaps || []);
    }
    if (catsRes.ok) {
      const { categories: allCategories } = await catsRes.json();
      setCategories(allCategories || []);
    }
  }, [setCategories]);

  // Each product board only exposes its own libraries. This prevents a click
  // on an article/meeting card from racing the mode switch back to knowledge.
  const visibleMaps = maps.filter((map) => isMapForMode(map, currentMode));
  const uncategorizedMaps = visibleMaps.filter((m) => !m.categoryId);
  const categorizedMaps = (currentMode === "knowledge" ? categories : []).map((cat) => ({
    category: cat,
    maps: visibleMaps.filter((m) => m.categoryId === cat.id),
  }));
  const needsOrganizing = currentMode === "knowledge" && needsLibraryOrganization(visibleMaps.length, uncategorizedMaps.length, categories.length);
  const organizerScopeKey = user?.id && currentWorkspace?.id
    ? `${user.id}:${currentWorkspace.id}`
    : "local-user:local-workspace";

  const MAP_COLORS = ["#22d3a7", "#38bdf8", "#818cf8", "#f472b6", "#fb923c", "#a3e635", "#e879f9", "#f87171"];

  if (!sidebarOpen) {
    return (
      <button
        onClick={() => setSidebarOpen(true)}
        className="w-10 h-10 flex items-center justify-center bg-[var(--card)] border border-[var(--border)] rounded-xl hover:bg-[var(--muted)] transition-colors cursor-pointer"
        title={english ? "Expand sidebar" : "展开侧边栏"}
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
        <span className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">{english ? ({ knowledge: "Knowledge libraries", article: "Article libraries", meeting: "Meeting libraries" } as const)[currentMode] : MODE_LIBRARY_CONFIG[currentMode].defaultName}</span>
        <div className="flex gap-1">
          {/* Prominent New Map button */}
          <button
            onClick={() => { setIsCreating(true); setNewCategoryId(null); }}
            className="w-7 h-7 flex items-center justify-center rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90 transition-opacity cursor-pointer"
            title={english ? "New library" : "新建知识库"}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          {currentMode === "knowledge" && <button
            onClick={() => setShowOrganizer(true)}
            data-testid="open-library-organizer"
            className="relative flex h-7 w-7 items-center justify-center rounded-lg text-emerald-300 transition-colors hover:bg-emerald-300/10"
            title={english ? "Organize libraries" : "一键整理知识库"}
            aria-label={english ? "Organize libraries" : "一键整理知识库"}
          >
            ✨
            {needsOrganizing && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-[var(--card)] bg-amber-400" />}
          </button>}
          {/* New Category button */}
          {currentMode === "knowledge" && <button
            onClick={() => setIsCreatingCategory(true)}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[var(--muted)] text-[var(--muted-foreground)] transition-colors cursor-pointer"
            title={english ? "New folder" : "新建文件夹"}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /><line x1="12" y1="11" x2="12" y2="17" /><line x1="9" y1="14" x2="15" y2="14" />
            </svg>
          </button>}
          {/* Template Center button */}
          {currentMode === "knowledge" && <button
            onClick={() => setShowTemplates(true)}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[var(--muted)] text-[var(--muted-foreground)] transition-colors cursor-pointer"
            title={english ? "Template center" : "模板中心"}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
          </button>}
          <button
            onClick={() => setSidebarOpen(false)}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[var(--muted)] text-[var(--muted-foreground)] transition-colors cursor-pointer"
            title={english ? "Collapse" : "收起"}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
        </div>
      </div>

      <div className="border-b border-[var(--border)] px-3 py-2.5">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event(COMMAND_PALETTE_OPEN_EVENT))}
          aria-label={english ? "Search the entire workspace" : "搜索整个工作区"}
          data-testid="command-palette-open"
          className="flex w-full items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-base)] px-2.5 py-2 text-left text-xs text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)]"
        >
          <svg className="shrink-0 text-[var(--muted-foreground)]" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
          <span className="min-w-0 flex-1 truncate">{english ? "Search entire workspace…" : "搜索整个工作区…"}</span>
          <kbd className="shrink-0 rounded border border-[var(--border)] px-1 py-0.5 text-[8px] text-[var(--muted-foreground)]">Ctrl/⌘ K</kbd>
        </button>
        <Link
          href={`/universe?mode=${currentMode}`}
          data-testid="mode-universe-link"
          className="mt-2 flex items-center justify-between rounded-lg border border-[var(--primary-border)] bg-[var(--primary-subtle)] px-3 py-2 text-[10px] text-[var(--primary-hover)] no-underline hover:border-[var(--primary)]"
        >
          <span>{english ? "🌱 Explore connections across libraries" : `🌱 查看${MODE_LIBRARY_CONFIG[currentMode].shortLabel}库之间的生长关系`}</span>
          <span aria-hidden="true">→</span>
        </Link>
        {needsOrganizing && <button type="button" onClick={() => setShowOrganizer(true)} className="mt-2 w-full rounded-lg border border-amber-300/20 bg-amber-300/5 px-3 py-2 text-left text-[10px] leading-4 text-amber-200 hover:border-amber-300/35" data-testid="organize-reminder">
          {english ? `✨ ${uncategorizedMaps.length} libraries are uncategorized; organize when ready` : `✨ ${uncategorizedMaps.length} 个知识库尚未归类，可按需一键整理`}
        </button>}
      </div>

      {/* Map List grouped by category */}
      <div className="flex-1 overflow-y-auto py-2 space-y-0.5">
        {/* Categorized maps */}
        {categorizedMaps.map(({ category, maps: catMaps }) => (
          <CategorySection
            key={category.id}
            category={category}
            maps={catMaps}
            currentMapId={currentMapId}
            onSwitch={handleSwitch}
            onContextMenu={handleContextMenu}
            onDeleteMap={setDeleteCandidate}
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
          onDeleteMap={setDeleteCandidate}
        />

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
              placeholder={english ? "Library name…" : "知识库名称..."}
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
            {currentMode === "knowledge" && categories.length > 0 && (
              <select
                value={newCategoryId || ""}
                onChange={(e) => setNewCategoryId(e.target.value || null)}
                className="w-full bg-[var(--bg-base)] border border-[var(--border)] rounded-lg px-2.5 py-1 text-xs text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
              >
                <option value="">{english ? "Uncategorized" : "未分类"}</option>
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
                {english ? "Create" : "创建"}
              </button>
              <button
                onClick={() => { setIsCreating(false); setNewName(""); setNewCategoryId(null); }}
                className="flex-1 py-1.5 bg-[var(--border)] text-[var(--foreground)] rounded-lg text-xs hover:opacity-80 transition-opacity cursor-pointer"
              >
                {english ? "Cancel" : "取消"}
              </button>
            </div>
          </div>
        )}

        {/* Create new category inline */}
        {currentMode === "knowledge" && isCreatingCategory && (
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
                placeholder={english ? "Folder name…" : "文件夹名称..."}
                className="flex-1 bg-[var(--bg-base)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] outline-none focus:border-[var(--primary)]"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleCreateCategory}
                disabled={!newCategoryName.trim()}
                className="flex-1 py-1.5 bg-[var(--primary)] text-[var(--primary-foreground)] rounded-lg text-xs font-medium hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-40"
              >
                {english ? "Create" : "创建"}
              </button>
              <button
                onClick={() => { setIsCreatingCategory(false); setNewCategoryName(""); setNewCategoryIcon("📁"); }}
                className="flex-1 py-1.5 bg-[var(--border)] text-[var(--foreground)] rounded-lg text-xs hover:opacity-80 transition-opacity cursor-pointer"
              >
                {english ? "Cancel" : "取消"}
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

      {deleteCandidate && (
        <div className="fixed inset-0 z-[260] flex items-center justify-center bg-black/55 px-4" onClick={() => setDeleteCandidate(null)}>
          <div role="dialog" aria-modal="true" aria-labelledby="delete-library-title" className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-red-500/10 text-red-400">🗑️</div>
            <h3 id="delete-library-title" className="text-sm font-semibold text-[var(--foreground)]">删除“{deleteCandidate.name}”？</h3>
            <p className="mt-2 text-xs leading-6 text-[var(--muted-foreground)]">该知识库中的节点、关系和引用将一起删除，无法撤销。其他板块的知识库不会受影响。</p>
            <div className="mt-5 flex gap-2">
              <button type="button" onClick={() => setDeleteCandidate(null)} className="flex-1 rounded-xl border border-[var(--border)] px-4 py-2.5 text-xs text-[var(--foreground)] hover:bg-[var(--bg-hover)]">取消</button>
              <button type="button" onClick={() => void handleDeleteMap(deleteCandidate)} className="flex-1 rounded-xl bg-red-500 px-4 py-2.5 text-xs font-semibold text-white hover:bg-red-400">确认删除</button>
            </div>
          </div>
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
      {currentMode === "knowledge" && showTemplates && (
        <TemplateBrowser
          onSelect={async (template) => {
            setShowTemplates(false);
            try {
              const res = await apiFetch("/api/knowledge", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: "createFromTemplate",
                  mode: "knowledge",
                  name: template.mindMap.root,
                  description: template.mindMap.rootDesc || template.description,
                  color: "#22d3a7",
                  template: template.mindMap,
                }),
              });
              if (res.ok) {
                const { map } = await res.json();
                await onMapCreated(map.id);
              }
            } catch (e) { console.error("Failed to create from template:", e); }
          }}
          onClose={() => setShowTemplates(false)}
        />
      )}
      {currentMode === "knowledge" && showOrganizer && (
        <OrganizeLibraryDialog
          maps={visibleMaps}
          categories={categories}
          organizerScopeKey={organizerScopeKey}
          onClose={() => setShowOrganizer(false)}
          onDone={reloadOrganization}
        />
      )}
    </div>
  );
}
