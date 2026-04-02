import { create } from "zustand";
import { KnowledgeNode, KnowledgeEdge, ChatMessage, AISuggestion, AIMindMap } from "@/types";
import type { MindMap as DBMindMap } from "@/lib/db/database";

export type AppMode = "knowledge" | "meeting" | "article";
export type LayoutDirection = "vertical" | "horizontal";

// ============================================================
// Undo/Redo system
// ============================================================
interface HistoryEntry {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  timestamp: number;
}

// ============================================================
// State interface
// ============================================================
interface MindGrowState {
  // Current map
  currentMapId: string;
  setCurrentMapId: (id: string) => void;

  // Maps list
  maps: DBMindMap[];
  setMaps: (maps: DBMindMap[]) => void;
  addMap: (map: DBMindMap) => void;

  // Nodes & Edges
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  setNodes: (nodes: KnowledgeNode[]) => void;
  addNode: (node: KnowledgeNode) => void;
  removeNode: (id: string) => void;
  setEdges: (edges: KnowledgeEdge[]) => void;
  addEdge: (edge: KnowledgeEdge) => void;

  // Undo/Redo
  history: HistoryEntry[];
  historyIndex: number;
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // Chat
  messages: ChatMessage[];
  isProcessing: boolean;
  addMessage: (message: ChatMessage) => void;
  setMessages: (messages: ChatMessage[]) => void;
  setProcessing: (processing: boolean) => void;

  // Pending suggestion
  pendingSuggestion: AISuggestion | null;
  setPendingSuggestion: (suggestion: AISuggestion | null) => void;

  // Pending AI mind map
  pendingMindMap: AIMindMap | null;
  setPendingMindMap: (mindMap: AIMindMap | null) => void;
  pendingPlacement: { targetTopic: string; confidence: number; reason: string } | null;
  setPendingPlacement: (placement: { targetTopic: string; confidence: number; reason: string } | null) => void;

  // Search
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  searchResults: string[];
  setSearchResults: (ids: string[]) => void;

  // Node editing
  editingNodeId: string | null;
  setEditingNodeId: (id: string | null) => void;

  // Context menu
  contextMenu: { nodeId: string; x: number; y: number } | null;
  setContextMenu: (menu: { nodeId: string; x: number; y: number } | null) => void;

  // Highlight
  highlightedNodeId: string | null;
  setHighlightedNodeId: (id: string | null) => void;

  // Collapsed nodes (for tree collapse/expand)
  collapsedNodes: Set<string>;
  toggleCollapse: (nodeId: string) => void;
  setCollapsedNodes: (ids: Set<string>) => void;

  // Sidebar
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;

  // UI state
  currentMode: AppMode;
  setCurrentMode: (mode: AppMode) => void;
  layoutDirection: LayoutDirection;
  setLayoutDirection: (dir: LayoutDirection) => void;

  // Help panel
  showHelp: boolean;
  setShowHelp: (show: boolean) => void;
}

// ============================================================
// Max history entries
// ============================================================
const MAX_HISTORY = 50;

export const useMindGrowStore = create<MindGrowState>((set, get) => ({
  currentMapId: "map_default",
  setCurrentMapId: (id) => set({ currentMapId: id }),

  maps: [],
  setMaps: (maps) => set({ maps }),
  addMap: (map) => set((state) => ({ maps: [map, ...state.maps] })),

  nodes: [],
  edges: [],
  setNodes: (nodes) => set({ nodes }),
  addNode: (node) => set((state) => ({ nodes: [...state.nodes, node] })),
  removeNode: (id) => set((state) => ({
    nodes: state.nodes.filter((n) => n.id !== id),
    edges: state.edges.filter((e) => e.sourceId !== id && e.targetId !== id),
  })),
  setEdges: (edges) => set({ edges }),
  addEdge: (edge) => set((state) => ({ edges: [...state.edges, edge] })),

  // Undo/Redo
  history: [],
  historyIndex: -1,
  pushHistory: () => set((state) => {
    const entry: HistoryEntry = {
      nodes: [...state.nodes],
      edges: [...state.edges],
      timestamp: Date.now(),
    };
    // Trim future history if we're not at the end
    const newHistory = state.history.slice(0, state.historyIndex + 1);
    newHistory.push(entry);
    // Limit history size
    if (newHistory.length > MAX_HISTORY) newHistory.shift();
    return {
      history: newHistory,
      historyIndex: Math.min(newHistory.length - 1, state.historyIndex + 1),
    };
  }),
  undo: () => set((state) => {
    if (state.historyIndex <= 0) return {};
    const prev = state.history[state.historyIndex - 1];
    return {
      nodes: prev ? [...prev.nodes] : state.nodes,
      edges: prev ? [...prev.edges] : state.edges,
      historyIndex: state.historyIndex - 1,
    };
  }),
  redo: () => set((state) => {
    if (state.historyIndex >= state.history.length - 1) return {};
    const next = state.history[state.historyIndex + 1];
    return {
      nodes: next ? [...next.nodes] : state.nodes,
      edges: next ? [...next.edges] : state.edges,
      historyIndex: state.historyIndex + 1,
    };
  }),
  canUndo: () => get().historyIndex > 0,
  canRedo: () => get().historyIndex < get().history.length - 1,

  messages: [],
  isProcessing: false,
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
  setMessages: (messages) => set({ messages }),
  setProcessing: (processing) => set({ isProcessing: processing }),

  pendingSuggestion: null,
  setPendingSuggestion: (suggestion) => set({ pendingSuggestion: suggestion }),

  pendingMindMap: null,
  setPendingMindMap: (mindMap) => set({ pendingMindMap: mindMap }),
  pendingPlacement: null,
  setPendingPlacement: (placement) => set({ pendingPlacement: placement }),

  searchQuery: "",
  setSearchQuery: (query) => set({ searchQuery: query }),
  searchResults: [],
  setSearchResults: (ids) => set({ searchResults: ids }),

  editingNodeId: null,
  setEditingNodeId: (id) => set({ editingNodeId: id }),

  contextMenu: null,
  setContextMenu: (menu) => set({ contextMenu: menu }),

  highlightedNodeId: null,
  setHighlightedNodeId: (id) => set({ highlightedNodeId: id }),

  collapsedNodes: new Set<string>(),
  toggleCollapse: (nodeId) => set((state) => {
    const newSet = new Set(state.collapsedNodes);
    if (newSet.has(nodeId)) newSet.delete(nodeId);
    else newSet.add(nodeId);
    return { collapsedNodes: newSet };
  }),
  setCollapsedNodes: (ids) => set({ collapsedNodes: ids }),

  sidebarOpen: true,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),

  currentMode: "knowledge",
  setCurrentMode: (mode) => set({ currentMode: mode }),
  layoutDirection: "vertical",
  setLayoutDirection: (dir) => set({ layoutDirection: dir }),

  showHelp: false,
  setShowHelp: (show) => set({ showHelp: show }),
}));
