import { describe, expect, it } from "vitest";

const { __entityGraphInternal } = require("../../../fc-proxy/index.js") as {
  __entityGraphInternal: {
    workspaceGraphEntityIdentity: (workspaceId: string, entityType: string, name: string) => {
      id: string;
      normalizedName: string;
      key: string;
    };
  };
};

describe("backend workspace entity identity", () => {
  it("is stable across source maps but isolated by workspace and entity type", () => {
    const article = __entityGraphInternal.workspaceGraphEntityIdentity("workspace-a", "method", "GraphRAG");
    const meeting = __entityGraphInternal.workspaceGraphEntityIdentity("workspace-a", "method", " GraphRAG ");
    const otherWorkspace = __entityGraphInternal.workspaceGraphEntityIdentity("workspace-b", "method", "GraphRAG");
    const otherType = __entityGraphInternal.workspaceGraphEntityIdentity("workspace-a", "model", "GraphRAG");

    expect(article.id).toBe(meeting.id);
    expect(article.normalizedName).toBe("graphrag");
    expect(otherWorkspace.id).not.toBe(article.id);
    expect(otherType.id).not.toBe(article.id);
  });
});
