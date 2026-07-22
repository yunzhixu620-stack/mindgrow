import { describe, expect, it } from "vitest";
import { breadcrumbMapsForMode, shortenBreadcrumbLabel } from "@/components/ui/breadcrumb";
import type { MindMap } from "@/types";

const createdAt = "2026-07-22T00:00:00.000Z";
const maps: MindMap[] = [
  { id: "knowledge", name: "个人知识库", description: "", mode: "knowledge", color: "#22d3a7", isDefault: true, categoryId: null, nodeCount: 3, createdAt, updatedAt: createdAt },
  { id: "meeting", name: "会议知识库", description: "会议结论", mode: "meeting", color: "#38bdf8", isDefault: false, categoryId: null, nodeCount: 2, createdAt, updatedAt: createdAt },
  { id: "article", name: "文章知识库", description: "论文阅读", mode: "article", color: "#a78bfa", isDefault: false, categoryId: null, nodeCount: 4, createdAt, updatedAt: createdAt },
];

describe("product breadcrumb", () => {
  it("uses the product-board hierarchy instead of inventing a graph level", () => {
    expect(breadcrumbMapsForMode(maps, "knowledge").map((map) => map.id)).toEqual(["knowledge"]);
    expect(breadcrumbMapsForMode(maps, "meeting").map((map) => map.id)).toEqual(["meeting"]);
    expect(breadcrumbMapsForMode(maps, "article").map((map) => map.id)).toEqual(["article"]);
  });

  it("shortens long mobile knowledge-base names without changing short names", () => {
    expect(shortenBreadcrumbLabel("论文库")).toBe("论文库");
    expect(shortenBreadcrumbLabel("这是一个非常非常长的论文知识库名称", 10)).toBe("这是一个非常非常长…");
  });
});
