import { create } from "zustand";
import { KnowledgeNode, KnowledgeEdge, ChatMessage, AISuggestion, AIMindMap, Category, MindMap, EntityGraph } from "@/types";

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
  maps: MindMap[];
  setMaps: (maps: MindMap[]) => void;
  addMap: (map: MindMap) => void;

  // Categories
  categories: Category[];
  setCategories: (cats: Category[]) => void;
  addCategory: (cat: Category) => void;

  // Nodes & Edges
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  setNodes: (nodes: KnowledgeNode[]) => void;
  addNode: (node: KnowledgeNode) => void;
  removeNode: (id: string) => void;
  setEdges: (edges: KnowledgeEdge[]) => void;
  addEdge: (edge: KnowledgeEdge) => void;
  entityGraph: EntityGraph;
  setEntityGraph: (graph: EntityGraph) => void;

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
  chatHistory: Record<string, ChatMessage[]>;
  messageMapId: string | null;
  isProcessing: boolean;
  addMessage: (message: ChatMessage) => void;
  setMessages: (messages: ChatMessage[]) => void;
  saveChatHistory: () => void;
  loadChatHistory: (mapId: string) => void;
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
  setCurrentMapId: (id) => set((state) => state.currentMapId === id ? {} : ({
    currentMapId: id,
    // A map id and its graph must change atomically. Clearing here prevents
    // the previous library from flashing while the next request is in flight.
    nodes: [],
    edges: [],
    entityGraph: { entities: [], relations: [] },
    searchResults: [],
    highlightedNodeId: null,
    collapsedNodes: new Set<string>(),
    contextMenu: null,
    pendingSuggestion: null,
    pendingMindMap: null,
    pendingPlacement: null,
    messages: [],
    messageMapId: null,
    isProcessing: false,
  })),

  maps: [],
  setMaps: (maps) => set({ maps }),
  addMap: (map) => set((state) => ({ maps: [map, ...state.maps] })),

  categories: [],
  setCategories: (cats) => set({ categories: cats }),
  addCategory: (cat) => set((state) => ({ categories: [...state.categories, cat] })),

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
  entityGraph: { entities: [], relations: [] },
  setEntityGraph: (entityGraph) => set({ entityGraph }),

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
  chatHistory: {},
  messageMapId: null,
  isProcessing: false,
  addMessage: (message) => set((state) => ({
    messages: [...state.messages, message],
    messageMapId: state.messageMapId || state.currentMapId,
  })),
  setMessages: (messages) => set((state) => ({ messages, messageMapId: state.currentMapId })),
  saveChatHistory: () => set((state) => {
    const mapId = state.messageMapId;
    if (!mapId) return {};
    if (state.messages.length > 0) {
      return {
        chatHistory: { ...state.chatHistory, [mapId]: [...state.messages] },
      };
    }
    return {};
  }),
  loadChatHistory: (mapId) => set((state) => {
    const saved = state.chatHistory[mapId];
    if (saved && saved.length > 0) {
      return { messages: [...saved], messageMapId: mapId };
    }
    return {
      messageMapId: mapId,
      messages: [
        {
          id: `welcome_${mapId}`,
          role: "assistant" as const,
          content: "🌱 欢迎！在下方输入你的碎片想法，我来帮你整理成思维导图。\n\n试试输入一个知识点，比如「深度学习」或「产品设计」",
          timestamp: new Date().toISOString(),
        },
      ],
    };
  }),
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
  setCurrentMode: (mode) => set((state) => {
    if (state.currentMode === mode) return {};
    const chatHistory = state.messageMapId && state.messages.length > 0
      ? { ...state.chatHistory, [state.messageMapId]: [...state.messages] }
      : state.chatHistory;
    return {
      currentMode: mode,
      // Product-board switches must never render cached graph, draft or
      // response state from the previous board. The page controller selects
      // and reloads the board-owned library after this atomic reset.
      nodes: [],
      edges: [],
      entityGraph: { entities: [], relations: [] },
      messages: [],
      messageMapId: null,
      chatHistory,
      isProcessing: false,
      searchResults: [],
      highlightedNodeId: null,
      collapsedNodes: new Set<string>(),
      contextMenu: null,
      pendingSuggestion: null,
      pendingMindMap: null,
      pendingPlacement: null,
    };
  }),
  layoutDirection: "vertical",
  setLayoutDirection: (dir) => set({ layoutDirection: dir }),

  showHelp: false,
  setShowHelp: (show) => set({ showHelp: show }),
}));
