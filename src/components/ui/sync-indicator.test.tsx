import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SyncIndicatorView, syncIndicatorViewModel } from "@/components/ui/sync-indicator";

describe("U2 sync indicator", () => {
  it("maps all five write states to truthful user-facing labels", () => {
    expect(syncIndicatorViewModel({ state: "idle", lastSuccessAt: 1, error: null }).label).toBe("已同步");
    expect(syncIndicatorViewModel({ state: "syncing", lastSuccessAt: 1, error: null }).label).toBe("同步中…");
    expect(syncIndicatorViewModel({ state: "dirty", lastSuccessAt: 1, error: null }).label).toBe("有未提交改动");
    expect(syncIndicatorViewModel({ state: "offline", lastSuccessAt: 1, error: null }).label).toBe("离线，改动仅在本地");
    expect(syncIndicatorViewModel({ state: "error", lastSuccessAt: 1, error: "HTTP 401" }).label).toBe("同步失败");
  });

  it("keeps map identity, last-success time and safe error text in the status tooltip", () => {
    const status = { state: "error" as const, lastSuccessAt: new Date("2026-07-22T05:04:03Z").getTime(), error: "写入失败（HTTP 401）" };
    const html = renderToStaticMarkup(<SyncIndicatorView status={status} mapId="map-b" />);

    expect(html).toContain('data-sync-map-id="map-b"');
    expect(html).toContain('data-sync-state="error"');
    expect(html).toContain("写入失败（HTTP 401）");
    expect(html).toContain("上次同步");
  });

  it("renders dirty as a dashed amber dot and offline as a solid red state", () => {
    const dirty = renderToStaticMarkup(<SyncIndicatorView status={{ state: "dirty", lastSuccessAt: null, error: null }} mapId="map-a" />);
    const offline = renderToStaticMarkup(<SyncIndicatorView status={{ state: "offline", lastSuccessAt: null, error: null }} mapId="map-a" compact />);

    expect(dirty).toContain("border-dashed");
    expect(offline).toContain("bg-red-400");
    expect(offline).toContain("离线，改动仅在本地");
  });
});
