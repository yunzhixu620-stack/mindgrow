import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getMapMode,
  migrateLegacyMapMode,
  modeLibraryDescription,
  normalizeMapMode,
} from "@/lib/mode-libraries";

const { __mapModeInternal } = require("../../../fc-proxy/index.js") as {
  __mapModeInternal: {
    normalizeMapMode: (mode: unknown, description?: string) => "knowledge" | "meeting" | "article";
    isValidMapMode: (mode: unknown) => boolean;
    convertMap: (row: Record<string, unknown>) => { mode: "knowledge" | "meeting" | "article" };
  };
};

describe("S2.1 explicit map mode", () => {
  it("treats a valid explicit mode as authoritative even when a legacy marker conflicts", () => {
    expect(normalizeMapMode("article", "[MindGrow:meeting] old marker")).toBe("article");
    expect(getMapMode({ mode: "meeting", description: "plain meeting notes" })).toBe("meeting");
    expect(__mapModeInternal.normalizeMapMode("knowledge", "[MindGrow:article] stale text")).toBe("knowledge");
    expect(__mapModeInternal.isValidMapMode("article")).toBe(true);
    expect(__mapModeInternal.isValidMapMode("invalid")).toBe(false);
  });

  it("classifies pre-v12 payloads and upgrades them without losing other fields", () => {
    expect(normalizeMapMode(undefined, "[MindGrow:meeting] 决议")).toBe("meeting");
    expect(normalizeMapMode(null, "[MindGrow:article] 论文")).toBe("article");
    expect(normalizeMapMode("invalid", "普通笔记")).toBe("knowledge");
    expect(migrateLegacyMapMode({ id: "legacy", description: "[MindGrow:article] 论文" }))
      .toEqual({ id: "legacy", description: "[MindGrow:article] 论文", mode: "article" });
  });

  it("stops writing hidden markers into descriptions and exposes mode in API maps", () => {
    expect(modeLibraryDescription("meeting")).toBe("独立沉淀会议纪要、决议、行动项和风险");
    expect(modeLibraryDescription("article", "自定义介绍")).toBe("自定义介绍");
    expect(modeLibraryDescription("article")).not.toContain("[MindGrow:");
    expect(__mapModeInternal.convertMap({ id: "map-a", description: "[MindGrow:article] old" }).mode).toBe("article");
    expect(__mapModeInternal.convertMap({ id: "map-b", mode: "meeting", description: "plain" }).mode).toBe("meeting");
  });

  it("ships an idempotent forward migration and a semantics-preserving rollback", () => {
    const root = process.cwd();
    const forward = fs.readFileSync(path.join(root, "supabase-v12-map-mode-migration.sql"), "utf8");
    const rollback = fs.readFileSync(path.join(root, "supabase-v12-map-mode-rollback.sql"), "utf8");
    const schema = fs.readFileSync(path.join(root, "supabase-schema.sql"), "utf8");

    expect(forward).toContain("ADD COLUMN IF NOT EXISTS mode TEXT");
    expect(forward).toContain("mode IN ('knowledge', 'meeting', 'article')");
    expect(forward).toContain("idx_maps_workspace_mode_updated");
    expect(forward).toContain("maps_legacy_mode_compat");
    expect(schema).toContain("mode TEXT NOT NULL CHECK");
    expect(forward).toContain("IF NEW.mode IS NULL THEN");

    const restoreMeeting = rollback.indexOf("SET description = '[MindGrow:meeting] '");
    const dropColumn = rollback.indexOf("DROP COLUMN IF EXISTS mode");
    expect(restoreMeeting).toBeGreaterThanOrEqual(0);
    expect(dropColumn).toBeGreaterThan(restoreMeeting);
  });
});
