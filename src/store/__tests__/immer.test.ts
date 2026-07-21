import { enableMapSet, produce } from "immer";
import { describe, expect, it } from "vitest";

enableMapSet();

describe("Immer store foundation", () => {
  it("creates observable object and array references without mutating the base", () => {
    const base = {
      nodes: [{ id: "n1", title: "Original" }],
      metadata: { mapId: "map-a" },
    };

    const next = produce(base, (draft) => {
      draft.nodes[0].title = "Edited";
      draft.nodes.push({ id: "n2", title: "Added" });
    });

    expect(next).not.toBe(base);
    expect(next.nodes).not.toBe(base.nodes);
    expect(next.metadata).toBe(base.metadata);
    expect(base.nodes).toEqual([{ id: "n1", title: "Original" }]);
    expect(next.nodes).toEqual([
      { id: "n1", title: "Edited" },
      { id: "n2", title: "Added" },
    ]);
  });

  it("creates a new Set reference after enableMapSet", () => {
    const base = {
      collapsedNodes: new Set(["n1"]),
      selectedNodeId: "n1",
    };

    const expanded = produce(base, (draft) => {
      draft.collapsedNodes.delete("n1");
      draft.collapsedNodes.add("n2");
    });

    expect(expanded).not.toBe(base);
    expect(expanded.collapsedNodes).not.toBe(base.collapsedNodes);
    expect(base.collapsedNodes).toEqual(new Set(["n1"]));
    expect(expanded.collapsedNodes).toEqual(new Set(["n2"]));
  });
});
