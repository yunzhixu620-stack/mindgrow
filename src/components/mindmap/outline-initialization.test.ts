import { describe, expect, it } from "vitest";
import { shouldInitializeLargeMapOutline } from "@/components/mindmap/outline-initialization";

describe("large-map outline initialization", () => {
  it("initializes a newly loaded large map", () => {
    expect(shouldInitializeLargeMapOutline({
      initializedKey: null,
      largeMapKey: "map-a:large:desktop:root-a",
      viewMode: "all",
      collapsedNodeCount: 0,
    })).toBe(true);
  });

  it("restores outline collapse when a later tenant reset cleared it", () => {
    expect(shouldInitializeLargeMapOutline({
      initializedKey: "map-a:large:desktop:root-a",
      largeMapKey: "map-a:large:desktop:root-a",
      viewMode: "outline",
      collapsedNodeCount: 0,
    })).toBe(true);
  });

  it("does not reinitialize an intact outline", () => {
    expect(shouldInitializeLargeMapOutline({
      initializedKey: "map-a:large:desktop:root-a",
      largeMapKey: "map-a:large:desktop:root-a",
      viewMode: "outline",
      collapsedNodeCount: 6,
    })).toBe(false);
  });

  it.each(["all", "custom"] as const)("preserves an explicit %s view", (viewMode) => {
    expect(shouldInitializeLargeMapOutline({
      initializedKey: "map-a:large:desktop:root-a",
      largeMapKey: "map-a:large:desktop:root-a",
      viewMode,
      collapsedNodeCount: 0,
    })).toBe(false);
  });
});
