import { describe, expect, it } from "vitest";
import {
  PERSONAL_NOTES_TEMPLATE,
  onboardingStorageKey,
  shouldShowNewUserEmptyState,
  type OnboardingState,
} from "@/components/onboarding/new-user-empty-state";
import type { MindMap } from "@/types";

const defaultMap: MindMap = {
  id: "map-default",
  name: "默认知识库",
  description: "",
  mode: "knowledge",
  canvasView: "mindmap",
  color: "#22d3a7",
  isDefault: true,
  categoryId: null,
  nodeCount: 0,
  createdAt: "2026-07-22T00:00:00.000Z",
  updatedAt: "2026-07-22T00:00:00.000Z",
};

function visibility(overrides: Partial<Parameters<typeof shouldShowNewUserEmptyState>[0]> = {}) {
  return shouldShowNewUserEmptyState({
    mapCatalogReady: true,
    modeLibraryBusy: false,
    currentGraphReady: true,
    currentMode: "knowledge",
    maps: [defaultMap],
    currentMapId: defaultMap.id,
    defaultMapId: defaultMap.id,
    nodeCount: 0,
    onboardingState: "pending" as OnboardingState,
    ...overrides,
  });
}

describe("new-user empty state", () => {
  it("appears only after the catalog and current default graph are confirmed empty", () => {
    expect(visibility()).toBe(true);
    expect(visibility({ mapCatalogReady: false })).toBe(false);
    expect(visibility({ modeLibraryBusy: true })).toBe(false);
    expect(visibility({ currentGraphReady: false })).toBe(false);
    expect(visibility({ nodeCount: 1 })).toBe(false);
  });

  it("does not appear for old accounts, other boards, or dismissed onboarding", () => {
    const secondMap = { ...defaultMap, id: "map-second", name: "第二知识库", isDefault: false };
    expect(visibility({ maps: [defaultMap, secondMap] })).toBe(false);
    expect(visibility({ currentMode: "article" })).toBe(false);
    expect(visibility({ onboardingState: "dismissed" })).toBe(false);
    expect(visibility({ currentMapId: "missing" })).toBe(false);
  });

  it("provides exactly the three requested personal-note seeds and a tenant-scoped key", () => {
    expect(PERSONAL_NOTES_TEMPLATE.children.map((child) => child.topic)).toEqual(["学习目标", "灵感想法", "待办事项"]);
    expect(onboardingStorageKey("tenant:user-a:workspace-a")).not.toBe(onboardingStorageKey("tenant:user-a:workspace-b"));
  });
});
