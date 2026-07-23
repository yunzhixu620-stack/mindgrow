import { describe, expect, it } from "vitest";
import {
  __mapVersionSyncInternal,
  isNewerRemoteMapVersion,
  normalizeMapVersionMessage,
} from "@/lib/map-version-sync";

describe("cross-tab map version synchronization", () => {
  it("accepts only scoped, monotonic version messages", () => {
    const message = normalizeMapVersionMessage({
      mapId: "map-a",
      workspaceId: "workspace-a",
      version: 42,
      sourceTabId: "another-tab",
    });
    expect(message).not.toBeNull();
    expect(isNewerRemoteMapVersion(message!, "workspace-a", 41)).toBe(true);
    expect(isNewerRemoteMapVersion(message!, "workspace-a", 42)).toBe(false);
    expect(isNewerRemoteMapVersion(message!, "workspace-b", 1)).toBe(false);
  });

  it("ignores malformed and same-tab messages", () => {
    expect(normalizeMapVersionMessage({ mapId: "", version: 1 })).toBeNull();
    const sameTab = normalizeMapVersionMessage({
      mapId: "map-a",
      workspaceId: "workspace-a",
      version: 42,
      sourceTabId: __mapVersionSyncInternal.sourceTabId,
    });
    expect(isNewerRemoteMapVersion(sameTab!, "workspace-a", 0)).toBe(false);
  });
});
