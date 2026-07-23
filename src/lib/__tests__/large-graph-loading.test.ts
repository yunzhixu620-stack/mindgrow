import { describe, expect, it } from "vitest";

const { __largeGraphInternal } = require("../../../fc-proxy/index.js") as {
  __largeGraphInternal: {
    splitIntoBatches: <T>(values: T[], maximum: number) => T[][];
  };
};

describe("large graph loading", () => {
  it("keeps node-id filters below the request-line budget", () => {
    const ids = Array.from({ length: 336 }, (_, index) => `node-${index + 1}`);
    const batches = __largeGraphInternal.splitIntoBatches(ids, 80);

    expect(batches).toHaveLength(5);
    expect(batches.every((batch) => batch.length <= 80)).toBe(true);
    expect(batches.reduce((total, batch) => total + batch.length, 0)).toBe(336);
    expect(batches[0][0]).toBe("node-1");
    expect(batches[4][15]).toBe("node-336");
  });

  it("does not lose items when a caller provides an invalid size", () => {
    expect(__largeGraphInternal.splitIntoBatches(["a", "b"], 0)).toEqual([["a", "b"]]);
  });
});
