import { describe, expect, it } from "vitest";
import {
  GRAPH_DIMMED_OPACITY,
  graphEdgeFocusOpacity,
  graphNodeFocusOpacity,
  oneHopNodeIds,
} from "@/lib/graph-hover";

const connections = [
  { source: "a", target: "b" },
  { source: "c", target: "a" },
  { source: "c", target: "d" },
];

describe("one-hop graph hover focus", () => {
  it("keeps the hovered node and both incoming and outgoing neighbors", () => {
    expect(Array.from(oneHopNodeIds("a", connections) || []).sort()).toEqual(["a", "b", "c"]);
    expect(oneHopNodeIds(null, connections)).toBeNull();
  });

  it("dims unrelated nodes and edges to 25 percent without changing the idle graph", () => {
    const neighbors = oneHopNodeIds("a", connections);
    expect(graphNodeFocusOpacity("a", neighbors)).toBe(1);
    expect(graphNodeFocusOpacity("b", neighbors)).toBe(1);
    expect(graphNodeFocusOpacity("d", neighbors)).toBe(GRAPH_DIMMED_OPACITY);
    expect(graphEdgeFocusOpacity(connections[0], "a")).toBe(1);
    expect(graphEdgeFocusOpacity(connections[2], "a")).toBe(GRAPH_DIMMED_OPACITY);
    expect(graphNodeFocusOpacity("d", null)).toBe(1);
    expect(graphEdgeFocusOpacity(connections[2], null)).toBe(1);
  });

  it("supports a bounded animation progress for Canvas fade-in and fade-out", () => {
    const neighbors = oneHopNodeIds("a", connections);
    expect(graphNodeFocusOpacity("d", neighbors, 0)).toBe(1);
    expect(graphNodeFocusOpacity("d", neighbors, 0.5)).toBeCloseTo(0.625);
    expect(graphNodeFocusOpacity("d", neighbors, 3)).toBe(GRAPH_DIMMED_OPACITY);
  });
});
