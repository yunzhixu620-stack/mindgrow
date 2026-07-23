import { describe, expect, it } from "vitest";
import { buildSelectedMindMap } from "@/lib/knowledge-selection";

describe("knowledge suggestion confirmation", () => {
  it("keeps selected first-level branches even when they have no leaf items", () => {
    const result = buildSelectedMindMap({
      root: "GraphRAG",
      children: [
        { topic: "技术优势", items: [] },
        { topic: "评估指标", items: ["召回率", "答案忠实度"] },
      ],
    }, [
      { childIdx: 0, items: [] },
      { childIdx: 1, items: ["答案忠实度"] },
    ]);

    expect(result.children).toEqual([
      {
        topic: "技术优势",
        desc: undefined,
        type: undefined,
        items: [],
        citationIndexes: undefined,
        itemCitationIndexes: [],
      },
      {
        topic: "评估指标",
        desc: undefined,
        type: undefined,
        items: ["答案忠实度"],
        citationIndexes: undefined,
        itemCitationIndexes: [[]],
      },
    ]);
  });
});
