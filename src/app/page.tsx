"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
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
import { MODE_LIBRARY_CONFIG, getMapMode, isMapForMode, modeLibraryDescription } from "@/lib/mode-libraries";
import { tenantCache, tenantMapKey, tenantScopeKey, type TenantScope } from "@/lib/tenant-cache";
import { commitPageGraphResponse, graphSnapshotFromResponse, type PageGraphRequest } from "@/app/page-loader";
import {
  NewUserEmptyState,
  PERSONAL_NOTES_TEMPLATE,
  onboardingStorageKey,
  shouldShowNewUserEmptyState,
  type OnboardingState,
} from "@/components/onboarding/new-user-empty-state";
import { MobileBottomNav } from "@/components/mobile/bottom-nav";
import { COMMAND_ENTITY_FOCUS_EVENT, COMMAND_NAVIGATE_EVENT, type CommandSearchResult } from "@/lib/command-search";
import { matchesBootstrapTenant } from "@/lib/bootstrap";

const LOCAL_TENANT_SCOPE: TenantScope = { userId: "local-user", workspaceId: "local-workspace" };

export default function Home() {
  const { currentWorkspace, user, bootstrap } = useAuth();
  const currentWorkspaceId = currentWorkspace?.id;
  const currentWorkspaceDefaultMapId = currentWorkspace?.defaultMapId;
  const bootstrapForTenant = useMemo(() => (
    matchesBootstrapTenant(bootstrap, user?.id, currentWorkspaceId) ? bootstrap : null
  ), [bootstrap, currentWorkspaceId, user?.id]);
  const tenantScope = useMemo<TenantScope | null>(() => {
    if (IS_LOCAL_MODE) return LOCAL_TENANT_SCOPE;
    if (!user?.id || !currentWorkspaceId) return null;
    return { userId: user.id, workspaceId: currentWorkspaceId };
  }, [currentWorkspaceId, user?.id]);
  const activeTenantScopeKey = tenantScope ? tenantScopeKey(tenantScope) : null;
  const {
    currentMapId,
    setCurrentMapId,
    setMaps,
    setNodes,
    setEdges,
    setEntityGraph,
    saveChatHistory,
    loadChatHistory,
    maps,
    categories,
    setCategories,
    currentMode,
    setCurrentMode,
    nodes,
    entityGraph,
    setSearchResults,
    setHighlightedNodeId,
  } = useMindGrowStore();
  const mapsSignature = useMemo(() => maps.map((map) => `${map.id}:${map.updatedAt}`).join("|"), [maps]);
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
  const [confirmedGraphKey, setConfirmedGraphKey] = useState<string | null>(null);
  const [onboardingState, setOnboardingState] = useState<OnboardingState>("loading");
  const [onboardingBusy, setOnboardingBusy] = useState(false);
  const [onboardingError, setOnboardingError] = useState("");
  const [onboardingFocusTarget, setOnboardingFocusTarget] = useState<"article" | null>(null);
  const createRef = useRef<HTMLInputElement>(null);
  const catCreateRef = useRef<HTMLInputElement>(null);
  const activeModeRef = useRef<AppMode>("knowledge");
  const lastMapByModeRef = useRef<Partial<Record<AppMode, string>>>({ knowledge: "map_default" });
  const provisioningModeRef = useRef<AppMode | null>(null);
  const mapLoadRequestRef = useRef(0);
  const mapLoadAbortRef = useRef<AbortController | null>(null);
  const prefetchAbortRef = useRef<AbortController | null>(null);
  const prefetchedMapKeysRef = useRef(new Set<string>());
  const bootstrapFreshGraphKeyRef = useRef<string | null>(null);
  const pendingCommandNavigationRef = useRef<CommandSearchResult | null>(null);
  const activeTenantScopeKeyRef = useRef<string | null>(activeTenantScopeKey);
  activeTenantScopeKeyRef.current = activeTenantScopeKey;

  const persistOnboardingState = useCallback((next: "dismissed" | "completed") => {
    if (activeTenantScopeKey) {
      try { window.localStorage.setItem(onboardingStorageKey(activeTenantScopeKey), next); } catch { /* Local preference persistence is best effort. */ }
    }
    setOnboardingState(next);
  }, [activeTenantScopeKey]);

  useEffect(() => {
    setOnboardingBusy(false);
    setOnboardingError("");
    setOnboardingFocusTarget(null);
    if (!activeTenantScopeKey) {
      setOnboardingState("loading");
      return;
    }
    let stored: string | null = null;
    try { stored = window.localStorage.getItem(onboardingStorageKey(activeTenantScopeKey)); } catch { /* Treat unavailable storage as a pending onboarding. */ }
    setOnboardingState(stored === "completed" || stored === "dismissed" ? stored : "pending");
  }, [activeTenantScopeKey]);

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
    if (!tenantScope) return;
    if (bootstrapForTenant) return;
    const requestedScopeKey = tenantScopeKey(tenantScope);
    const controller = new AbortController();
    Promise.all([
      apiFetch("/api/knowledge?action=maps", { signal: controller.signal }).then((response) => {
        if (!response.ok) throw new Error("知识库目录加载失败");
        return response.json();
      }),
      apiFetch("/api/knowledge?action=categories", { signal: controller.signal }).then((response) => {
        if (!response.ok) throw new Error("知识库分类加载失败");
        return response.json();
      }),
    ])
      .then(([{ maps }, { categories }]) => {
        if (requestedScopeKey !== activeTenantScopeKeyRef.current) return;
        setMaps(maps || []);
        setCategories(categories || []);
        setMapCatalogReady(true);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (requestedScopeKey === activeTenantScopeKeyRef.current) setMapCatalogReady(true);
      });
    return () => controller.abort();
  }, [activeTenantScopeKey, bootstrapForTenant, setMaps, setCategories, tenantScope]);

  useEffect(() => {
    if (!currentWorkspaceDefaultMapId || !tenantScope) return;
    ++mapLoadRequestRef.current;
    mapLoadAbortRef.current?.abort();
    prefetchAbortRef.current?.abort();
    prefetchedMapKeysRef.current.clear();
    useMindGrowStore.getState().resetTenantContext();
    activeModeRef.current = "knowledge";
    lastMapByModeRef.current = { knowledge: currentWorkspaceDefaultMapId };
    setMapCatalogReady(false);
    setConfirmedGraphKey(null);
    setModeLibraryBusy(false);
    setModeLibraryError("");
    setCurrentMapId(currentWorkspaceDefaultMapId);
    bootstrapFreshGraphKeyRef.current = null;

    if (!bootstrapForTenant) return;
    setMaps(bootstrapForTenant.maps || []);
    setCategories(bootstrapForTenant.categories || []);
    setMapCatalogReady(true);
    const defaultMap = bootstrapForTenant.defaultMap;
    if (!defaultMap || defaultMap.map.id !== currentWorkspaceDefaultMapId) return;
    const graphKey = tenantMapKey(tenantScope, currentWorkspaceDefaultMapId);
    const cacheReadToken = tenantCache.beginMapRead(tenantScope, currentWorkspaceDefaultMapId);
    const result = useMindGrowStore.getState().hydrateGraphFromServer(
      currentWorkspaceDefaultMapId,
      graphSnapshotFromResponse(defaultMap),
      0,
      tenantScope,
      cacheReadToken,
    );
    if (result === "applied" || result === "rejected-local-dirty") {
      bootstrapFreshGraphKeyRef.current = graphKey;
      setConfirmedGraphKey(graphKey);
    }
  }, [activeTenantScopeKey, bootstrapForTenant, currentWorkspaceDefaultMapId, setCategories, setCurrentMapId, setMaps, tenantScope]);

  useEffect(() => tenantCache.subscribe((event) => {
    if (event.type === "tenant-cleared") prefetchedMapKeysRef.current.clear();
  }), []);

  const reloadAll = useCallback(async (): Promise<MindMap[]> => {
    if (!tenantScope) return [];
    const requestedScopeKey = tenantScopeKey(tenantScope);
    let allMaps: MindMap[] = [];
    try {
      const [mapsRes, catsRes] = await Promise.all([
        apiFetch("/api/knowledge?action=maps"),
        apiFetch("/api/knowledge?action=categories"),
      ]);
      if (requestedScopeKey !== activeTenantScopeKeyRef.current) return [];
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
  }, [setMaps, setCategories, tenantScope]);

  const handleSwitchMap = useCallback((mapId: string) => {
    if (mapId === currentMapId) { setDrawerOpen(false); return; }
    // Invalidate any response that belongs to the previous library. The only
    // code that fetches graph data is the currentMapId effect below.
    ++mapLoadRequestRef.current;
    mapLoadAbortRef.current?.abort();
    saveChatHistory();
    setCurrentMapId(mapId);
    const cached = tenantScope ? tenantCache.getMapGraph(tenantScope, mapId) : undefined;
    if (cached) {
      setNodes(cached.snapshot.nodes);
      setEdges(cached.snapshot.edges);
      setEntityGraph(cached.snapshot.entityGraph);
      setModeLibraryBusy(false);
    } else {
      setModeLibraryBusy(true);
    }
    loadChatHistory(mapId);
    setDrawerOpen(false);
  }, [currentMapId, tenantScope, setCurrentMapId, setNodes, setEdges, setEntityGraph, saveChatHistory, loadChatHistory]);

  useEffect(() => {
    const handleCommandNavigation = (event: Event) => {
      const result = (event as CustomEvent<CommandSearchResult>).detail;
      if (!result) return;

      if (result.kind === "map" || result.kind === "document") {
        const target = maps.find((map) => map.id === (result.kind === "map" ? result.targetId : result.mapId));
        if (!target) return;
        const targetMode = getMapMode(target);
        setMobileTab(result.kind === "document" ? "map" : "chat");
        if (targetMode !== currentMode) {
          lastMapByModeRef.current[targetMode] = target.id;
          setCurrentMode(targetMode);
        } else {
          handleSwitchMap(target.id);
        }
        return;
      }

      if (result.mapId && result.mapId !== currentMapId) {
        const target = maps.find((map) => map.id === result.mapId);
        if (!target) return;
        pendingCommandNavigationRef.current = result;
        setMobileTab("map");
        const targetMode = getMapMode(target);
        if (targetMode !== currentMode) {
          lastMapByModeRef.current[targetMode] = target.id;
          setCurrentMode(targetMode);
        } else {
          handleSwitchMap(target.id);
        }
        return;
      }

      if (result.kind === "node") {
        setMobileTab("map");
        setSearchResults([result.targetId]);
        setHighlightedNodeId(result.targetId);
        return;
      }

      if (result.kind === "entity") {
        setMobileTab("map");
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
          window.dispatchEvent(new CustomEvent(COMMAND_ENTITY_FOCUS_EVENT, { detail: { entityId: result.targetId } }));
        }));
        return;
      }

      setMobileTab("chat");
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        const message = Array.from(document.querySelectorAll<HTMLElement>("[data-chat-message-id]"))
          .find((element) => element.dataset.chatMessageId === result.targetId);
        message?.scrollIntoView({ block: "center", behavior: "smooth" });
      }));
    };
    window.addEventListener(COMMAND_NAVIGATE_EVENT, handleCommandNavigation);
    return () => window.removeEventListener(COMMAND_NAVIGATE_EVENT, handleCommandNavigation);
  }, [currentMapId, currentMode, handleSwitchMap, maps, setCurrentMode, setHighlightedNodeId, setSearchResults]);

  useEffect(() => {
    const result = pendingCommandNavigationRef.current;
    if (!result || result.mapId !== currentMapId) return;
    if (result.kind === "node") {
      if (!nodes.some((node) => node.id === result.targetId)) return;
      pendingCommandNavigationRef.current = null;
      setSearchResults([result.targetId]);
      setHighlightedNodeId(result.targetId);
      return;
    }
    if (result.kind === "entity") {
      if (!entityGraph.entities.some((entity) => entity.id === result.targetId)) return;
      pendingCommandNavigationRef.current = null;
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        window.dispatchEvent(new CustomEvent(COMMAND_ENTITY_FOCUS_EVENT, { detail: { entityId: result.targetId } }));
      }));
    }
  }, [currentMapId, entityGraph.entities, nodes, setHighlightedNodeId, setSearchResults]);

  const handleCreatedMap = useCallback(async (mapId: string) => {
    // Keep catalog prefetch from racing the explicit navigation while the new
    // map first appears in `maps`. The authoritative loader still performs the
    // one graph request after handleSwitchMap selects the target.
    const prefetchKey = tenantScope ? tenantMapKey(tenantScope, mapId) : null;
    if (prefetchKey) prefetchedMapKeysRef.current.add(prefetchKey);
    try {
      await reloadAll();
      handleSwitchMap(mapId);
    } finally {
      if (prefetchKey) prefetchedMapKeysRef.current.delete(prefetchKey);
    }
  }, [handleSwitchMap, reloadAll, tenantScope]);

  const createPersonalNotes = useCallback(async () => {
    if (onboardingBusy) return;
    setOnboardingBusy(true);
    setOnboardingError("");
    try {
      const response = await apiFetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "createFromTemplate",
          mode: "knowledge",
          name: PERSONAL_NOTES_TEMPLATE.root,
          description: PERSONAL_NOTES_TEMPLATE.rootDesc,
          color: "#22d3a7",
          template: PERSONAL_NOTES_TEMPLATE,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.map?.id) throw new Error(data.error || "个人笔记创建失败");
      await handleCreatedMap(data.map.id);
      persistOnboardingState("completed");
    } catch (error) {
      setOnboardingError(error instanceof Error ? error.message : "个人笔记创建失败，请稍后重试。");
    } finally {
      setOnboardingBusy(false);
    }
  }, [handleCreatedMap, onboardingBusy, persistOnboardingState]);

  const enterOnboardingMode = useCallback((mode: "article" | "meeting") => {
    persistOnboardingState("completed");
    setOnboardingError("");
    setOnboardingFocusTarget(mode === "article" ? "article" : null);
    setCurrentMode(mode);
    setMobileTab("chat");
  }, [persistOnboardingState, setCurrentMode]);

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
        mode: currentMode,
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
          mode: currentMode,
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
        writeForMapId: map.id,
        body: JSON.stringify({ action: "deleteMap", mapId: map.id }),
      });
      const allMaps = await reloadAll();
      if (map.id === currentMapId) {
        if (tenantScope) tenantCache.clearMap(tenantScope, map.id);
        const fallback = allMaps.find((item) => item.id !== map.id && isMapForMode(item, currentMode));
        if (fallback) handleSwitchMap(fallback.id);
        else {
          ++mapLoadRequestRef.current;
          setNodes([]);
          setEdges([]);
          setEntityGraph({ entities: [], relations: [] });
        }
      }
    } catch (e) { console.error(e); }
    setActionSheet("none");
    setContextMenu(null);
  }, [currentMapId, currentMode, tenantScope, handleSwitchMap, reloadAll, setNodes, setEdges, setEntityGraph]);

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
        writeForMapId: mapId,
        body: JSON.stringify({ action: "moveMapToCategory", mapId, categoryId }),
      });
      await reloadAll();
    } catch (e) { console.error(e); }
    setActionSheet("none");
    setContextMenu(null);
  }, [reloadAll]);

  // One authoritative graph loader for desktop, mobile and top-tab switches.
  // It validates request, tenant, map and mode before committing a response.
  useEffect(() => {
    if (!mapCatalogReady || !tenantScope) return;
    const selectedMap = useMindGrowStore.getState().maps.find((map) => map.id === currentMapId);
    if (!selectedMap || !isMapForMode(selectedMap, currentMode)) return;
    const requestId = ++mapLoadRequestRef.current;
    const request: PageGraphRequest = {
      requestId,
      scope: tenantScope,
      mapId: currentMapId,
      mode: currentMode,
      baseHydrationEpoch: useMindGrowStore.getState().getHydrationEpoch(currentMapId),
      cacheReadToken: tenantCache.beginMapRead(tenantScope, currentMapId),
    };
    const graphKey = tenantMapKey(tenantScope, currentMapId);
    const cached = tenantCache.getMapGraph(tenantScope, currentMapId);
    if (cached) {
      setNodes(cached.snapshot.nodes);
      setEdges(cached.snapshot.edges);
      setEntityGraph(cached.snapshot.entityGraph);
      setModeLibraryBusy(false);
      setConfirmedGraphKey(graphKey);
    } else {
      setModeLibraryBusy(true);
      setConfirmedGraphKey(null);
    }
    if (bootstrapFreshGraphKeyRef.current === graphKey) {
      bootstrapFreshGraphKeyRef.current = null;
      setModeLibraryError("");
      setModeLibraryBusy(false);
      setConfirmedGraphKey(graphKey);
      loadChatHistory(currentMapId);
      return;
    }
    mapLoadAbortRef.current?.abort();
    const controller = new AbortController();
    mapLoadAbortRef.current = controller;
    apiFetch(`/api/knowledge?mapId=${currentMapId}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("知识图谱加载失败");
        return response.json();
      })
      .then((data) => {
        const graph = graphSnapshotFromResponse(data);
        const latest = useMindGrowStore.getState();
        const result = commitPageGraphResponse(request, {
          requestId: mapLoadRequestRef.current,
          scopeKey: activeTenantScopeKeyRef.current,
          mapId: latest.currentMapId,
          mode: latest.currentMode,
        }, graph);
        if (result === "applied" || result === "rejected-local-dirty") {
          setModeLibraryError("");
          setConfirmedGraphKey(graphKey);
        }
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (requestId === mapLoadRequestRef.current && activeTenantScopeKeyRef.current === tenantScopeKey(tenantScope) && !cached) {
          setModeLibraryError(error instanceof Error ? error.message : "知识图谱加载失败");
        }
      })
      .finally(() => {
        if (requestId === mapLoadRequestRef.current && activeTenantScopeKeyRef.current === tenantScopeKey(tenantScope)) setModeLibraryBusy(false);
      });
    loadChatHistory(currentMapId);
    return () => {
      controller.abort();
      if (mapLoadAbortRef.current === controller) mapLoadAbortRef.current = null;
    };
  }, [currentMapId, currentMode, tenantScope, mapsSignature, mapCatalogReady, setNodes, setEdges, setEntityGraph, loadChatHistory]);

  // Warm the first library owned by every board after the catalog arrives.
  // Later top-tab switches can then paint from memory while revalidation runs.
  useEffect(() => {
    if (!mapCatalogReady || !tenantScope) return;
    const currentMaps = useMindGrowStore.getState().maps;
    if (currentMaps.length === 0) return;
    const requestedScopeKey = tenantScopeKey(tenantScope);
    prefetchAbortRef.current?.abort();
    const controller = new AbortController();
    prefetchAbortRef.current = controller;
    const targets = (["knowledge", "meeting", "article"] as AppMode[])
      .map((mode) => currentMaps.find((map) => isMapForMode(map, mode)))
      .filter((map): map is MindMap => Boolean(map))
      .filter((map) => map.id !== currentMapId)
      .filter((map) => {
        const key = tenantMapKey(tenantScope, map.id);
        if (tenantCache.getMapGraph(tenantScope, map.id) || prefetchedMapKeysRef.current.has(key)) return false;
        prefetchedMapKeysRef.current.add(key);
        return true;
      });
    void Promise.allSettled(targets.map(async (map) => {
      const key = tenantMapKey(tenantScope, map.id);
      const token = tenantCache.beginMapRead(tenantScope, map.id);
      try {
        const response = await apiFetch(`/api/knowledge?mapId=${map.id}`, { signal: controller.signal });
        if (!response.ok) throw new Error("prefetch failed");
        const data = await response.json();
        if (controller.signal.aborted || activeTenantScopeKeyRef.current !== requestedScopeKey) return;
        tenantCache.commitServerSnapshot(token, graphSnapshotFromResponse(data));
      } finally {
        if (!tenantCache.getMapGraph(tenantScope, map.id)) prefetchedMapKeysRef.current.delete(key);
      }
    }));
    return () => {
      controller.abort();
      if (prefetchAbortRef.current === controller) prefetchAbortRef.current = null;
    };
  }, [currentMapId, tenantScope, mapCatalogReady, mapsSignature]);

  // Each product board owns a separate set of knowledge libraries.
  const visibleMaps = maps.filter((map) => isMapForMode(map, currentMode));
  const uncategorizedMaps = visibleMaps.filter((m) => !m.categoryId);
  const categorizedMaps = (currentMode === "knowledge" ? categories : []).map((cat) => ({
    category: cat,
    maps: visibleMaps.filter((m) => m.categoryId === cat.id),
  }));

  const FOLDER_ICONS = ["📁", "📂", "📚", "🎯", "💡", "🔬", "🎨", "💼", "🏠", "🧪", "📖", "🌍", "💻", "🧠", "🎮", "📝"];
  const modeConfig = MODE_LIBRARY_CONFIG[currentMode];
  const selectedModeMap = maps.find((map) => map.id === currentMapId && isMapForMode(map, currentMode));
  const selectedGraphKey = tenantScope && currentMapId ? tenantMapKey(tenantScope, currentMapId) : null;
  const currentGraphReady = Boolean(selectedGraphKey && confirmedGraphKey === selectedGraphKey);
  const showNewUserEmptyState = shouldShowNewUserEmptyState({
    mapCatalogReady,
    modeLibraryBusy,
    currentGraphReady,
    currentMode,
    maps,
    currentMapId,
    defaultMapId: currentWorkspaceDefaultMapId,
    nodeCount: nodes.length,
    onboardingState,
  });

  useEffect(() => {
    if (onboardingState !== "pending" || !mapCatalogReady) return;
    if (maps.length > 1 || (currentGraphReady && nodes.length > 0)) persistOnboardingState("completed");
  }, [currentGraphReady, mapCatalogReady, maps.length, nodes.length, onboardingState, persistOnboardingState]);

  useEffect(() => {
    if (onboardingFocusTarget !== "article" || currentMode !== "article" || modeLibraryBusy || !selectedModeMap) return;
    const frame = window.requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>('input[type="url"]');
      if (!input) return;
      input.focus();
      setOnboardingFocusTarget(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentMode, modeLibraryBusy, onboardingFocusTarget, selectedModeMap]);

  const onboardingPanel = (
    <NewUserEmptyState
      busy={onboardingBusy}
      error={onboardingError}
      onPersonalNotes={() => void createPersonalNotes()}
      onArticleReading={() => enterOnboardingMode("article")}
      onMeetingNotes={() => enterOnboardingMode("meeting")}
      onDismiss={() => persistOnboardingState("dismissed")}
    />
  );
  const activeModePanel = currentMode !== "knowledge" && (!selectedModeMap || modeLibraryError)
    ? (
      <div className="flex h-full w-full items-center justify-center bg-[var(--background)] px-6" data-testid="mode-library-state">
        <div className="max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 text-center shadow-xl">
          <div className="mb-3 text-3xl">{modeConfig.emoji}</div>
          <h2 className="text-base font-semibold text-[var(--foreground)]">{modeLibraryError ? `${modeConfig.defaultName}暂时不可用` : `正在进入${modeConfig.defaultName}`}</h2>
          <p className="mt-2 text-xs leading-6 text-[var(--muted-foreground)]">{modeLibraryError || "首次进入会自动创建独立知识库，后续将直接恢复上次内容。"}</p>
          {modeLibraryError && <button type="button" onClick={() => { setModeLibraryError(""); ++mapLoadRequestRef.current; setMapCatalogReady(false); void reloadAll(); }} className="mt-4 rounded-xl bg-[var(--primary)] px-4 py-2 text-xs font-semibold text-[var(--primary-foreground)]">重新尝试</button>}
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
        {/* Mobile utility bar: product navigation lives only at the bottom. */}
        <div className="flex h-11 shrink-0 items-center border-b border-[var(--border)] bg-[var(--card)] px-1.5" data-testid="mobile-view-toolbar">
          <button
            onClick={() => setDrawerOpen(!drawerOpen)}
            aria-label="打开知识库列表"
            className={`drawer-toggle-btn flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors cursor-pointer ${
              drawerOpen ? "text-[var(--primary)]" : "text-[var(--muted-foreground)]"
            }`}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <div className="min-w-0 flex-1 px-2 text-xs font-semibold text-[var(--text-secondary)]">{modeConfig.emoji} {modeConfig.defaultName}</div>
          <div className="flex rounded-lg border border-[var(--border)] bg-[var(--background)] p-0.5">
            <button type="button" onClick={() => setMobileTab("chat")} aria-label="查看当前板块内容" className={`rounded-md px-2.5 py-1.5 text-[10px] font-medium ${mobileTab === "chat" ? "bg-[var(--primary-subtle)] text-[var(--primary-hover)]" : "text-[var(--text-muted)]"}`}>内容</button>
            <button type="button" onClick={() => setMobileTab("map")} aria-label="查看知识图谱" className={`rounded-md px-2.5 py-1.5 text-[10px] font-medium ${mobileTab === "map" ? "bg-[var(--primary-subtle)] text-[var(--primary-hover)]" : "text-[var(--text-muted)]"}`}>图谱</button>
          </div>
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
                    data-testid="mobile-template-browser-open"
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
        <div className="flex flex-1 flex-col overflow-hidden pb-5" data-testid="mobile-content-region">
          {mobileTab === "chat" ? (
            showNewUserEmptyState ? onboardingPanel : activeModePanel
          ) : (
            <MindMapPanel showSkeleton={!mapCatalogReady || modeLibraryBusy} />
          )}
        </div>
        <MobileBottomNav
          currentMode={currentMode}
          onModeChange={(mode) => { setCurrentMode(mode); setMobileTab("chat"); setDrawerOpen(false); }}
          onCreate={() => { setMobileTab("chat"); setDrawerOpen(true); setIsCreating(true); setNewCategoryId(null); }}
        />
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
                    mode: "knowledge",
                    name: template.mindMap.root,
                    description: template.mindMap.rootDesc || template.description,
                    color: "#22d3a7",
                    template: template.mindMap,
                  }),
                });
                if (res.ok) {
                  const { map } = await res.json();
                  await handleCreatedMap(map.id);
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
      <Sidebar onSwitchMap={handleSwitchMap} onMapCreated={handleCreatedMap} />
      {showNewUserEmptyState ? onboardingPanel : <>
        <div className={currentMode === "knowledge" ? "flex h-full shrink-0" : "h-full w-[clamp(360px,36vw,520px)] shrink-0 border-r border-[var(--border)]"}>
          {activeModePanel}
        </div>
        <MindMapPanel showSkeleton={!mapCatalogReady || modeLibraryBusy} />
      </>}
    </main>
  );
}
