import { create } from "zustand";
import { enableMapSet, produce } from "immer";
import { KnowledgeNode, KnowledgeEdge, ChatMessage, AISuggestion, AIMindMap, Category, MindMap, EntityGraph, NodeLayout, WhiteboardGroup } from "@/types";
import {
  tenantCache,
  tenantMapKey,
  type CacheReadToken,
  type GraphSnapshot,
  type LocalOverlayToken,
  type TenantScope,
} from "@/lib/tenant-cache";

enableMapSet();

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
export type HydrateGraphResult = "applied" | "rejected-stale-request" | "rejected-local-dirty";

export interface WriteRequestToken {
  requestId: string;
  mapId: string;
  scope: TenantScope;
  localEditVersionAtStart: number;
  localOverlayToken?: LocalOverlayToken;
}

export interface WriteErrorState {
  code?: string;
  message: string;
  at: number;
}

export type WriteResult =
  | { ok: true }
  | { ok: false; cancelled?: false; code?: string; message: string }
  | { ok: false; cancelled: true };

export type EndWriteResult = "confirmed" | "preserved-local" | "failed" | "cancelled" | "ignored-stale-write";

export interface MindGrowState {
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
  layouts: NodeLayout[];
  setLayouts: (layouts: NodeLayout[]) => void;
  whiteboardGroups: WhiteboardGroup[];
  setWhiteboardGroups: (groups: WhiteboardGroup[]) => void;

  // Server hydration and local editing are separate causal channels. These
  // counters reject stale work; cache.localOverlay is the only dirty source.
  hydrationEpochByMap: Record<string, number>;
  localEditVersionByMap: Record<string, number>;
  localOverlayTokenByMap: Record<string, LocalOverlayToken>;
  getHydrationEpoch: (mapId: string) => number;
  getLocalEditVersion: (mapId: string) => number;
  hydrateGraphFromServer: (
    mapId: string,
    snapshot: GraphSnapshot,
    baseHydrationEpoch: number,
    scope: TenantScope,
    cacheReadToken: CacheReadToken,
  ) => HydrateGraphResult;
  mutateGraphLocally: (
    mapId: string,
    scope: TenantScope,
    recipe: (draft: GraphSnapshot) => void,
  ) => LocalOverlayToken | null;
  rollbackGraphLocally: (mapId: string, scope: TenantScope, snapshot: GraphSnapshot) => boolean;
  resetTenantContext: () => void;

  // Map-scoped write lifecycle. Reads and model-only requests never enter it.
  pendingWritesByMap: Record<string, number>;
  activeWriteRequests: Record<string, WriteRequestToken>;
  lastWriteSucceededAtByMap: Record<string, number>;
  lastWriteErrorByMap: Record<string, WriteErrorState>;
  networkOnline: boolean;
  beginWrite: (mapId: string, scope: TenantScope) => WriteRequestToken;
  endWrite: (token: WriteRequestToken, result: WriteResult) => EndWriteResult;
  setNetworkOnline: (online: boolean) => void;
  isMapDirty: (mapId: string) => boolean;

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
let writeRequestSequence = 0;

export const useMindGrowStore = create<MindGrowState>((set, get) => ({
  currentMapId: "map_default",
  setCurrentMapId: (id) => set((state) => state.currentMapId === id ? {} : ({
    currentMapId: id,
    // A map id and its graph must change atomically. Clearing here prevents
    // the previous library from flashing while the next request is in flight.
    nodes: [],
    edges: [],
    entityGraph: { entities: [], relations: [] },
    layouts: [],
    whiteboardGroups: [],
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
    layouts: state.layouts.filter((layout) => layout.nodeId !== id),
  })),
  setEdges: (edges) => set({ edges }),
  addEdge: (edge) => set((state) => ({ edges: [...state.edges, edge] })),
  entityGraph: { entities: [], relations: [] },
  setEntityGraph: (entityGraph) => set({ entityGraph }),
  layouts: [],
  setLayouts: (layouts) => set({ layouts }),
  whiteboardGroups: [],
  setWhiteboardGroups: (whiteboardGroups) => set({ whiteboardGroups }),

  hydrationEpochByMap: {},
  localEditVersionByMap: {},
  localOverlayTokenByMap: {},
  getHydrationEpoch: (mapId) => get().hydrationEpochByMap[mapId] ?? 0,
  getLocalEditVersion: (mapId) => get().localEditVersionByMap[mapId] ?? 0,
  hydrateGraphFromServer: (mapId, snapshot, baseHydrationEpoch, scope, cacheReadToken) => {
    const state = get();
    const currentHydrationEpoch = state.hydrationEpochByMap[mapId] ?? 0;
    if (state.currentMapId !== mapId || currentHydrationEpoch !== baseHydrationEpoch) {
      return "rejected-stale-request";
    }
    if (cacheReadToken.key !== tenantMapKey(scope, mapId)) return "rejected-stale-request";
    if (!tenantCache.commitServerSnapshot(cacheReadToken, snapshot)) return "rejected-stale-request";

    const cached = tenantCache.getCachedMapGraph(scope, mapId);
    if (!cached?.serverSnapshot) return "rejected-stale-request";
    const serverSnapshot = cached.serverSnapshot;
    const hasLocalOverlay = cached.localOverlay !== undefined;
    set(produce((draft: MindGrowState) => {
      draft.hydrationEpochByMap[mapId] = currentHydrationEpoch + 1;
      if (hasLocalOverlay) return;
      draft.nodes = serverSnapshot.nodes;
      draft.edges = serverSnapshot.edges;
      draft.entityGraph = serverSnapshot.entityGraph;
      draft.layouts = serverSnapshot.layouts;
      draft.whiteboardGroups = serverSnapshot.whiteboardGroups;
    }));
    return hasLocalOverlay ? "rejected-local-dirty" : "applied";
  },
  mutateGraphLocally: (mapId, scope, recipe) => {
    const state = get();
    if (state.currentMapId !== mapId) return null;
    // Validate the complete tenant key before changing either Store or cache.
    tenantMapKey(scope, mapId);
    const base: GraphSnapshot = {
      nodes: state.nodes,
      edges: state.edges,
      entityGraph: state.entityGraph,
      layouts: state.layouts,
      whiteboardGroups: state.whiteboardGroups,
    };
    const next = produce(base, recipe);
    const overlayToken = tenantCache.setLocalOverlay(scope, mapId, next);
    set(produce((draft: MindGrowState) => {
      draft.nodes = next.nodes;
      draft.edges = next.edges;
      draft.entityGraph = next.entityGraph;
      draft.layouts = next.layouts;
      draft.whiteboardGroups = next.whiteboardGroups;
      draft.localEditVersionByMap[mapId] = (draft.localEditVersionByMap[mapId] ?? 0) + 1;
      draft.localOverlayTokenByMap[mapId] = overlayToken;
    }));
    return overlayToken;
  },
  rollbackGraphLocally: (mapId, scope, snapshot) => {
    const state = get();
    if (state.currentMapId !== mapId) return false;
    tenantMapKey(scope, mapId);
    const overlayToken = state.localOverlayTokenByMap[mapId];
    if (overlayToken && !tenantCache.discardLocalOverlay(overlayToken)) return false;
    set(produce((draft: MindGrowState) => {
      draft.nodes = snapshot.nodes;
      draft.edges = snapshot.edges;
      draft.entityGraph = snapshot.entityGraph;
      draft.layouts = snapshot.layouts;
      draft.whiteboardGroups = snapshot.whiteboardGroups;
      draft.localEditVersionByMap[mapId] = (draft.localEditVersionByMap[mapId] ?? 0) + 1;
      delete draft.localOverlayTokenByMap[mapId];
    }));
    return true;
  },
  pendingWritesByMap: {},
  activeWriteRequests: {},
  lastWriteSucceededAtByMap: {},
  lastWriteErrorByMap: {},
  networkOnline: true,
  beginWrite: (mapId, scope) => {
    tenantMapKey(scope, mapId);
    const state = get();
    const token: WriteRequestToken = {
      requestId: `write_${++writeRequestSequence}`,
      mapId,
      scope,
      localEditVersionAtStart: state.localEditVersionByMap[mapId] ?? 0,
      localOverlayToken: state.localOverlayTokenByMap[mapId],
    };
    set(produce((draft: MindGrowState) => {
      draft.pendingWritesByMap[mapId] = (draft.pendingWritesByMap[mapId] ?? 0) + 1;
      draft.activeWriteRequests[token.requestId] = token;
    }));
    return token;
  },
  endWrite: (token, result) => {
    const state = get();
    const active = state.activeWriteRequests[token.requestId];
    if (!active || active.mapId !== token.mapId || tenantMapKey(active.scope, active.mapId) !== tenantMapKey(token.scope, token.mapId)) {
      return "ignored-stale-write";
    }

    const versionUnchanged = (state.localEditVersionByMap[token.mapId] ?? 0) === token.localEditVersionAtStart;
    const confirmed = Boolean(
      result.ok
      && versionUnchanged
      && token.localOverlayToken
      && tenantCache.confirmLocalOverlay(token.localOverlayToken),
    );
    const completedAt = Date.now();
    set(produce((draft: MindGrowState) => {
      delete draft.activeWriteRequests[token.requestId];
      const pending = Math.max(0, (draft.pendingWritesByMap[token.mapId] ?? 1) - 1);
      if (pending) draft.pendingWritesByMap[token.mapId] = pending;
      else delete draft.pendingWritesByMap[token.mapId];

      if (result.ok) {
        draft.lastWriteSucceededAtByMap[token.mapId] = completedAt;
        delete draft.lastWriteErrorByMap[token.mapId];
        if (confirmed) delete draft.localOverlayTokenByMap[token.mapId];
      } else if (result.cancelled) {
        // Navigation and tenant resets may cancel writes. Keep local data but
        // do not present a user-actionable server error.
      } else {
        draft.lastWriteErrorByMap[token.mapId] = {
          code: result.code,
          message: result.message,
          at: completedAt,
        };
      }
    }));

    if (result.ok) return confirmed || !token.localOverlayToken ? "confirmed" : "preserved-local";
    return result.cancelled ? "cancelled" : "failed";
  },
  setNetworkOnline: (networkOnline) => set({ networkOnline }),
  isMapDirty: (mapId) => {
    const token = get().localOverlayTokenByMap[mapId];
    return Boolean(token && tenantCache.isLocalOverlayCurrent(token));
  },
  resetTenantContext: () => set(produce((draft: MindGrowState) => {
    draft.currentMapId = "map_default";
    draft.maps = [];
    draft.categories = [];
    draft.nodes = [];
    draft.edges = [];
    draft.entityGraph = { entities: [], relations: [] };
    draft.layouts = [];
    draft.whiteboardGroups = [];
    draft.history = [];
    draft.historyIndex = -1;
    draft.messages = [];
    draft.chatHistory = {};
    draft.messageMapId = null;
    draft.isProcessing = false;
    draft.pendingSuggestion = null;
    draft.pendingMindMap = null;
    draft.pendingPlacement = null;
    draft.searchQuery = "";
    draft.searchResults = [];
    draft.editingNodeId = null;
    draft.contextMenu = null;
    draft.highlightedNodeId = null;
    draft.collapsedNodes.clear();
    draft.hydrationEpochByMap = {};
    draft.localEditVersionByMap = {};
    draft.localOverlayTokenByMap = {};
    draft.pendingWritesByMap = {};
    draft.activeWriteRequests = {};
    draft.lastWriteSucceededAtByMap = {};
    draft.lastWriteErrorByMap = {};
    draft.currentMode = "knowledge";
  })),

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
      layouts: [],
      whiteboardGroups: [],
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
