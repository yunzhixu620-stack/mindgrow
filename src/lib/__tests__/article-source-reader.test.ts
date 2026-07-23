import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";

const {
  arxivArticleId,
  extractHtmlDocumentTitle,
  extractPdfTextLightweight,
  prepareArticleSource,
  readArticleSource,
} = require("../../../fc-proxy/index.js") as {
  arxivArticleId: (url: string) => string;
  extractHtmlDocumentTitle: (html: string) => string;
  extractPdfTextLightweight: (value: Buffer) => string;
  prepareArticleSource: (body: Record<string, unknown>) => Promise<{
    content: string;
    sourceType: "url" | "pdf" | "text";
    sourceUrl: string;
    sourceStatus: { acquisition: string; citationCount: number };
  }>;
  readArticleSource: (url: string, options?: Record<string, unknown>) => Promise<{
    content: string;
    finalUrl: string;
    acquisition: string;
    documentTitle?: string;
  }>;
};

type ResponseSpec = {
  status?: number;
  headers?: Record<string, string>;
  chunks: Array<string | Buffer>;
};

function fakeTransport(specs: ResponseSpec[]) {
  let index = 0;
  return {
    request(_options: Record<string, unknown>, callback: (response: Readable & {
      statusCode: number;
      headers: Record<string, string>;
    }) => void) {
      const request = new EventEmitter() as EventEmitter & {
        end: () => void;
        destroy: (error?: Error) => void;
      };
      request.destroy = (error?: Error) => {
        if (error) process.nextTick(() => request.emit("error", error));
      };
      request.end = () => {
        process.nextTick(() => {
          const socket = new EventEmitter() as EventEmitter & { connecting: boolean };
          socket.connecting = false;
          request.emit("socket", socket);
          const spec = specs[index++];
          const response = Readable.from(spec.chunks) as Readable & {
            statusCode: number;
            headers: Record<string, string>;
          };
          response.statusCode = spec.status || 200;
          response.headers = spec.headers || { "content-type": "text/html" };
          callback(response);
        });
      };
      return request;
    },
  };
}

const publicDns = async () => ["93.184.216.34"];

function readablePdf(text: string) {
  return Buffer.from(
    `%PDF-1.4\n1 0 obj\n<< /Length ${text.length + 24} >>\nstream\nBT (${text}) Tj ET\nendstream\nendobj\n%%EOF`,
    "latin1",
  );
}

describe("shared article source reader", () => {
  it("extracts an ordinary public page through the shared reader", async () => {
    const paragraph = "Verified public article sentence. ".repeat(20);
    const transport = fakeTransport([{ chunks: [`<main><p>${paragraph}</p></main>`] }]);

    const result = await readArticleSource("https://example.com/article", {
      resolve4: publicDns,
      transports: { "https:": transport },
    });

    expect(result.acquisition).toBe("remote_fetch");
    expect(result.content).toContain("Verified public article sentence");
  });

  it("keeps the trusted HTML title separate from readable article content", async () => {
    const paragraph = "Verified article body sentence. ".repeat(40);
    const html = `<html><head><meta name="citation_title" content="CLARK: Closed-loop Learning for Adaptive Reasoning over Knowledge Graphs"></head><main><p>${paragraph}</p></main></html>`;
    const transport = fakeTransport([{ chunks: [html] }]);

    const result = await readArticleSource("https://example.com/article", {
      resolve4: publicDns,
      transports: { "https:": transport },
    });

    expect(result.documentTitle).toBe("CLARK: Closed-loop Learning for Adaptive Reasoning over Knowledge Graphs");
    expect(result.content).not.toContain("citation_title");
    expect(extractHtmlDocumentTitle("<title>Paper Name | arXiv</title>")).toBe("Paper Name");
  });

  it("tries arXiv HTML and then falls back to PDF full text", async () => {
    const pdfText = "GraphRAG links entities and evidence across a document. ".repeat(24);
    const transport = fakeTransport([
      { chunks: ["<html><main>short</main></html>"] },
      { headers: { "content-type": "application/pdf" }, chunks: [readablePdf(pdfText)] },
    ]);

    const result = await readArticleSource("https://arxiv.org/abs/2607.12345", {
      resolve4: publicDns,
      transports: { "https:": transport },
    });

    expect(result.acquisition).toBe("arxiv_pdf_fallback");
    expect(result.content).toContain("GraphRAG links entities");
    expect(result.content.length).toBeGreaterThanOrEqual(800);
  });

  it("does not treat an arXiv abstract or title as full-paper content", async () => {
    const transport = fakeTransport([
      { chunks: ["<html><main>Only a short abstract.</main></html>"] },
      { headers: { "content-type": "application/pdf" }, chunks: [readablePdf("too short")] },
    ]);

    await expect(readArticleSource("https://arxiv.org/abs/2607.54321", {
      resolve4: publicDns,
      transports: { "https:": transport },
    })).rejects.toMatchObject({ publicCode: "ARTICLE_ARXIV_PDF_TEXT_UNAVAILABLE" });
  });

  it("normalizes URL, PDF and text inputs into the same prepared source contract", async () => {
    const text = "证据句子用于统一文章来源准备。".repeat(12);
    const prepared = await prepareArticleSource({ sourceType: "text", content: text });
    const replayed = await prepareArticleSource({
      preparedSource: true,
      sourceType: "text",
      content: prepared.content,
      acquisition: prepared.sourceStatus.acquisition,
    });

    expect(prepared.sourceType).toBe("text");
    expect(prepared.sourceStatus.acquisition).toBe("pasted_text");
    expect(prepared.sourceStatus.citationCount).toBeGreaterThan(0);
    expect(replayed.content).toBe(prepared.content);
  });

  it("recognizes abs, html and PDF arXiv forms", () => {
    expect(arxivArticleId("https://arxiv.org/abs/2607.12345")).toBe("2607.12345");
    expect(arxivArticleId("https://arxiv.org/html/2607.12345")).toBe("2607.12345");
    expect(arxivArticleId("https://export.arxiv.org/pdf/2607.12345.pdf")).toBe("2607.12345");
    expect(arxivArticleId("https://example.com/2607.12345")).toBe("");
    expect(extractPdfTextLightweight(readablePdf("A verifiable PDF sentence.".repeat(40))).length).toBeGreaterThan(800);
  });
});
