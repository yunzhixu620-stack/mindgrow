export type MindMapViewMode = "outline" | "all" | "custom";

interface LargeMapOutlineState {
  initializedKey: string | null;
  largeMapKey: string;
  viewMode: MindMapViewMode;
  collapsedNodeCount: number;
}

/**
 * A parent tenant reset can clear the shared collapsed-node set after the
 * mind-map panel has already selected outline mode. Recover that display-only
 * state without overriding an explicit "all" or progressively expanded view.
 */
export function shouldInitializeLargeMapOutline({
  initializedKey,
  largeMapKey,
  viewMode,
  collapsedNodeCount,
}: LargeMapOutlineState) {
  if (initializedKey !== largeMapKey) return true;
  return viewMode === "outline" && collapsedNodeCount === 0;
}
