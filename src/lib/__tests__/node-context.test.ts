import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildLocalNodeContext } from "@/lib/node-context";
import type { KnowledgeEdge, KnowledgeNode } from "@/types";

const baseNode = (id: string, overrides: Partial<KnowledgeNode> = {}): KnowledgeNode => ({
  id,
  content: id,
  desc: "",
  type: "concept",
  status: "active",
  source: "manual",
  confidence: 1,
  createdAt: "2026-07-22T00:00:00.000Z",
  updatedAt: "2026-07-22T00:00:00.000Z",
  ...overrides,
});

describe("local node context", () => {
  it("returns incoming edge backlinks and shared-source backlinks without duplicates", () => {
    const target = baseNode("target", { citations: [{ index: 1, documentId: "doc-a", quote: "target evidence" }] });
    const parent = baseNode("parent", { citations: [{ index: 2, documentId: "doc-a", quote: "parent evidence" }] });
    const sibling = baseNode("sibling", { citations: [{ index: 3, documentId: "doc-a", quote: "sibling evidence" }] });
    const edge: KnowledgeEdge = { id: "edge", sourceId: "parent", targetId: "target", relation: "contains", weight: 1, createdAt: target.createdAt };

    const context = buildLocalNodeContext(target, [target, parent, sibling], [edge]);

    expect(context.backlinks).toHaveLength(2);
    expect(context.backlinks.find((item) => item.node.id === "parent")?.kinds).toEqual(["incoming_edge", "shared_source"]);
    expect(context.backlinks.find((item) => item.node.id === "sibling")?.kinds).toEqual(["shared_source"]);
  });

  it("keeps unrelated citations out of backlinks", () => {
    const target = baseNode("target", { citations: [{ index: 1, documentId: "doc-a", quote: "a" }] });
    const unrelated = baseNode("other", { citations: [{ index: 1, documentId: "doc-b", quote: "b" }] });
    expect(buildLocalNodeContext(target, [target, unrelated], []).backlinks).toEqual([]);
  });

  it("shows created and updated events for locally edited nodes", () => {
    const target = baseNode("target", { updatedAt: "2026-07-22T01:00:00.000Z" });
    expect(buildLocalNodeContext(target, [target], []).timeline.map((item) => item.eventType)).toEqual(["updated", "created"]);
  });

  it("ships an idempotent service-role-only V13 migration and rollback", () => {
    const forward = fs.readFileSync(path.join(process.cwd(), "supabase-v13-node-revisions-migration.sql"), "utf8");
    const rollback = fs.readFileSync(path.join(process.cwd(), "supabase-v13-node-revisions-rollback.sql"), "utf8");
    expect(forward).toContain("CREATE TABLE IF NOT EXISTS node_revisions");
    expect(forward).toContain("ALTER TABLE node_revisions ENABLE ROW LEVEL SECURITY");
    expect(forward).toContain("REVOKE ALL ON TABLE node_revisions FROM anon, authenticated");
    expect(forward).toContain("GRANT ALL ON TABLE node_revisions TO service_role");
    expect(rollback).toContain("DROP TABLE IF EXISTS node_revisions");
  });
});
