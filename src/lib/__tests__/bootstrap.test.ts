import { describe, expect, it } from "vitest";
import { matchesBootstrapTenant } from "@/lib/bootstrap";

const { __bootstrapInternal } = require("../../../fc-proxy/index.js") as {
  __bootstrapInternal: {
    selectBootstrapWorkspace: <T extends { id: string }>(workspaces: T[], requestedId?: string) => T | null;
    selectBootstrapDefaultMap: <T extends { id: string; mode: string; isDefault?: boolean }>(
      maps: T[],
      workspace?: { defaultMapId?: string },
    ) => T | null;
  };
};

describe("bootstrap selection", () => {
  const workspaces = [
    { id: "ws-a", name: "A" },
    { id: "ws-b", name: "B" },
  ];

  it("uses the requested workspace only when it belongs to the authenticated user", () => {
    expect(__bootstrapInternal.selectBootstrapWorkspace(workspaces, "ws-b")?.id).toBe("ws-b");
    expect(__bootstrapInternal.selectBootstrapWorkspace(workspaces, "ws-stale")?.id).toBe("ws-a");
  });

  it("returns null when the user has no workspace", () => {
    expect(__bootstrapInternal.selectBootstrapWorkspace([], "ws-a")).toBeNull();
  });

  it("selects the declared default map before any fallback", () => {
    const maps = [
      { id: "map-recent", mode: "article", isDefault: false },
      { id: "map-default", mode: "knowledge", isDefault: true },
    ];
    expect(__bootstrapInternal.selectBootstrapDefaultMap(maps, { defaultMapId: "map-default" })?.id).toBe("map-default");
  });

  it("falls back to a default knowledge map, then a knowledge map, then the first map", () => {
    const defaultKnowledge = [
      { id: "map-article", mode: "article", isDefault: false },
      { id: "map-knowledge", mode: "knowledge", isDefault: true },
    ];
    const plainKnowledge = [
      { id: "map-article", mode: "article", isDefault: false },
      { id: "map-knowledge", mode: "knowledge", isDefault: false },
    ];
    const articleOnly = [{ id: "map-article", mode: "article", isDefault: false }];

    expect(__bootstrapInternal.selectBootstrapDefaultMap(defaultKnowledge, { defaultMapId: "missing" })?.id).toBe("map-knowledge");
    expect(__bootstrapInternal.selectBootstrapDefaultMap(plainKnowledge, { defaultMapId: "missing" })?.id).toBe("map-knowledge");
    expect(__bootstrapInternal.selectBootstrapDefaultMap(articleOnly, { defaultMapId: "missing" })?.id).toBe("map-article");
    expect(__bootstrapInternal.selectBootstrapDefaultMap([], { defaultMapId: "missing" })).toBeNull();
  });
});

describe("bootstrap tenant guard", () => {
  const bootstrap = { user: { id: "user-a" }, workspace: { id: "ws-a" } };

  it("accepts only the matching authenticated tenant", () => {
    expect(matchesBootstrapTenant(bootstrap, "user-a", "ws-a")).toBe(true);
    expect(matchesBootstrapTenant(bootstrap, "user-b", "ws-a")).toBe(false);
    expect(matchesBootstrapTenant(bootstrap, "user-a", "ws-b")).toBe(false);
  });

  it("rejects incomplete bootstrap identities", () => {
    expect(matchesBootstrapTenant(null, "user-a", "ws-a")).toBe(false);
    expect(matchesBootstrapTenant({ user: { id: "user-a" } }, "user-a", "ws-a")).toBe(false);
    expect(matchesBootstrapTenant(bootstrap, null, "ws-a")).toBe(false);
  });
});
