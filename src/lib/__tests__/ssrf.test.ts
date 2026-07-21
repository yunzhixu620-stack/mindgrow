import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";

const {
  assertPublicUrl,
  fetchArticleText,
  isPublicIPv4,
} = require("../../../fc-proxy/index.js") as {
  assertPublicUrl: (url: string, options?: Record<string, unknown>) => Promise<{
    url: URL;
    hostname: string;
    address: string;
    addresses: string[];
  }>;
  fetchArticleText: (url: string, redirects?: number, options?: Record<string, unknown>) => Promise<{
    html: string;
    finalUrl: string;
  }>;
  isPublicIPv4: (address: string) => boolean;
};

type ResponseSpec = {
  status?: number;
  headers?: Record<string, string>;
  chunks?: Array<string | Buffer>;
  neverRespond?: boolean;
  neverEnd?: boolean;
  socketConnecting?: boolean;
};

function fakeTransport(specs: ResponseSpec[]) {
  const captured: Array<Record<string, unknown>> = [];
  let requestIndex = 0;
  return {
    captured,
    transport: {
      request(options: Record<string, unknown>, callback: (response: Readable & {
        statusCode: number;
        headers: Record<string, string>;
      }) => void) {
        captured.push(options);
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
            const spec = specs[requestIndex++] || {};
            socket.connecting = Boolean(spec.socketConnecting);
            request.emit("socket", socket);
            if (spec.neverRespond) return;
            const sourceChunks = spec.chunks || ["<article>ok</article>"];
            const response = (spec.neverEnd
              ? new Readable({
                read() {
                  while (sourceChunks.length) this.push(sourceChunks.shift()!);
                },
              })
              : Readable.from(sourceChunks)) as Readable & {
              statusCode: number;
              headers: Record<string, string>;
            };
            response.statusCode = spec.status || 200;
            response.headers = spec.headers || { "content-type": "text/html; charset=utf-8" };
            callback(response);
          });
        };
        return request;
      },
    },
  };
}

const publicDns = async () => ["93.184.216.34"];

describe("public URL validation", () => {
  it("rejects private, loopback, link-local, shared, documentation, multicast, and reserved IPv4", () => {
    for (const address of [
      "0.1.2.3",
      "10.2.3.4",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "172.31.255.255",
      "192.0.0.8",
      "192.0.2.10",
      "192.88.99.1",
      "192.168.1.1",
      "198.18.0.1",
      "198.51.100.2",
      "203.0.113.9",
      "224.0.0.1",
      "240.0.0.1",
      "255.255.255.255",
    ]) {
      expect(isPublicIPv4(address), address).toBe(false);
    }
    expect(isPublicIPv4("8.8.8.8")).toBe(true);
    expect(isPublicIPv4("172.15.255.255")).toBe(true);
    expect(isPublicIPv4("172.32.0.1")).toBe(true);
    expect(isPublicIPv4("93.184.216.34")).toBe(true);
  });

  it("rejects credentials, unsupported protocols, IPv6, and exotic loopback literals", async () => {
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toMatchObject({ publicCode: "INVALID_URL" });
    await expect(assertPublicUrl("https://user:secret@example.com/")).rejects.toMatchObject({ publicCode: "INVALID_URL" });
    await expect(assertPublicUrl("http://[::1]/")).rejects.toMatchObject({ publicCode: "URL_NOT_ALLOWED" });
    await expect(assertPublicUrl("http://2130706433/")).rejects.toMatchObject({ publicCode: "URL_NOT_ALLOWED" });
    await expect(assertPublicUrl("http://0x7f000001/")).rejects.toMatchObject({ publicCode: "URL_NOT_ALLOWED" });
  });

  it("normalizes mixed-case and trailing-dot hostnames before resolving", async () => {
    const resolvedNames: string[] = [];
    const result = await assertPublicUrl("HTTPS://ExAmPlE.COM./paper#section", {
      resolve4: async (hostname: string) => {
        resolvedNames.push(hostname);
        return ["93.184.216.34"];
      },
    });
    expect(resolvedNames).toEqual(["example.com"]);
    expect(result.url.toString()).toBe("https://example.com/paper");
  });

  it("rejects the whole DNS answer set when any candidate is unsafe", async () => {
    await expect(assertPublicUrl("https://example.com", {
      resolve4: async () => ["93.184.216.34", "10.0.0.8"],
    })).rejects.toMatchObject({ publicCode: "URL_NOT_ALLOWED" });
    await expect(assertPublicUrl("https://example.com", {
      resolve4: async () => ["93.184.216.34", "::1"],
    })).rejects.toMatchObject({ publicCode: "URL_NOT_ALLOWED" });
    await expect(assertPublicUrl("https://example.com", {
      resolve4: async () => ["not-an-address"],
    })).rejects.toMatchObject({ publicCode: "URL_NOT_ALLOWED" });
  });
});

describe("pinned public article fetch", () => {
  it("pins the vetted IPv4 while preserving HTTPS SNI and Host", async () => {
    const fake = fakeTransport([{ chunks: ["<h1>Public paper</h1>"] }]);
    let dnsCalls = 0;
    const result = await fetchArticleText("https://Research.Example:8443/paper", 0, {
      resolve4: async () => {
        dnsCalls += 1;
        return dnsCalls === 1 ? ["93.184.216.34"] : ["127.0.0.1"];
      },
      transports: { "https:": fake.transport },
    });

    expect(result.html).toContain("Public paper");
    expect(dnsCalls).toBe(1);
    expect(fake.captured[0]).toMatchObject({
      hostname: "93.184.216.34",
      servername: "research.example",
      family: 4,
      agent: false,
    });
    expect((fake.captured[0].headers as Record<string, string>).Host).toBe("research.example:8443");
  });

  it("successfully returns a normal public HTML page", async () => {
    const fake = fakeTransport([{ headers: { "content-type": "text/html" }, chunks: ["<p>verified source</p>"] }]);
    const result = await fetchArticleText("http://example.com/article", 0, {
      resolve4: publicDns,
      transports: { "http:": fake.transport },
    });
    expect(result).toEqual({ html: "<p>verified source</p>", finalUrl: "http://example.com/article" });
    expect(fake.captured[0].hostname).toBe("93.184.216.34");
  });

  it("re-resolves every redirect and rejects a redirect to a private address", async () => {
    const fake = fakeTransport([{ status: 302, headers: { location: "http://internal.example/secret" } }]);
    await expect(fetchArticleText("http://public.example/start", 0, {
      resolve4: async (hostname: string) => hostname === "public.example" ? ["93.184.216.34"] : ["127.0.0.1"],
      transports: { "http:": fake.transport },
    })).rejects.toMatchObject({ publicCode: "URL_NOT_ALLOWED" });
  });

  it("rejects HTTPS downgrade, missing Location, and redirect loops", async () => {
    const downgrade = fakeTransport([{ status: 302, headers: { location: "http://example.com/insecure" } }]);
    await expect(fetchArticleText("https://example.com/start", 0, {
      resolve4: publicDns,
      transports: { "https:": downgrade.transport },
    })).rejects.toMatchObject({ publicCode: "REDIRECT_DOWNGRADE_NOT_ALLOWED" });

    const missing = fakeTransport([{ status: 302, headers: {} }]);
    await expect(fetchArticleText("http://example.com/start", 0, {
      resolve4: publicDns,
      transports: { "http:": missing.transport },
    })).rejects.toMatchObject({ publicCode: "REDIRECT_LOCATION_MISSING" });

    const loop = fakeTransport([
      { status: 302, headers: { location: "/second" } },
      { status: 302, headers: { location: "/start" } },
    ]);
    await expect(fetchArticleText("http://example.com/start", 0, {
      resolve4: publicDns,
      transports: { "http:": loop.transport },
    })).rejects.toMatchObject({ publicCode: "REDIRECT_LOOP" });
  });

  it("limits redirect chains to three hops", async () => {
    const redirects = fakeTransport([
      { status: 302, headers: { location: "/one" } },
      { status: 302, headers: { location: "/two" } },
      { status: 302, headers: { location: "/three" } },
      { status: 302, headers: { location: "/four" } },
    ]);
    await expect(fetchArticleText("http://example.com/start", 0, {
      resolve4: publicDns,
      transports: { "http:": redirects.transport },
    })).rejects.toMatchObject({ publicCode: "TOO_MANY_REDIRECTS" });
    expect(redirects.captured).toHaveLength(4);
  });

  it("rejects unsupported and oversized responses", async () => {
    const binary = fakeTransport([{ headers: { "content-type": "application/octet-stream" } }]);
    await expect(fetchArticleText("http://example.com/file", 0, {
      resolve4: publicDns,
      transports: { "http:": binary.transport },
    })).rejects.toMatchObject({ publicCode: "UNSUPPORTED_ARTICLE_TYPE" });

    const declaredLarge = fakeTransport([{ headers: { "content-type": "text/html", "content-length": "10" } }]);
    await expect(fetchArticleText("http://example.com/large", 0, {
      maxBytes: 5,
      resolve4: publicDns,
      transports: { "http:": declaredLarge.transport },
    })).rejects.toMatchObject({ publicCode: "ARTICLE_TOO_LARGE" });

    const streamedLarge = fakeTransport([{ chunks: ["123", "456"] }]);
    await expect(fetchArticleText("http://example.com/stream", 0, {
      maxBytes: 5,
      resolve4: publicDns,
      transports: { "http:": streamedLarge.transport },
    })).rejects.toMatchObject({ publicCode: "ARTICLE_TOO_LARGE" });
  });

  it("enforces a first-byte timeout", async () => {
    const stalled = fakeTransport([{ neverRespond: true }]);
    await expect(fetchArticleText("http://example.com/stalled", 0, {
      connectTimeoutMs: 50,
      firstByteTimeoutMs: 5,
      totalTimeoutMs: 100,
      resolve4: publicDns,
      transports: { "http:": stalled.transport },
    })).rejects.toMatchObject({ publicCode: "ARTICLE_FIRST_BYTE_TIMEOUT" });
  });

  it("enforces connection and whole-operation timeouts", async () => {
    const neverConnects = fakeTransport([{ neverRespond: true, socketConnecting: true }]);
    await expect(fetchArticleText("http://example.com/connect", 0, {
      connectTimeoutMs: 5,
      firstByteTimeoutMs: 50,
      totalTimeoutMs: 100,
      resolve4: publicDns,
      transports: { "http:": neverConnects.transport },
    })).rejects.toMatchObject({ publicCode: "ARTICLE_CONNECT_TIMEOUT" });

    const neverEnds = fakeTransport([{ neverEnd: true, chunks: ["partial"] }]);
    await expect(fetchArticleText("http://example.com/overall", 0, {
      connectTimeoutMs: 50,
      firstByteTimeoutMs: 50,
      totalTimeoutMs: 5,
      resolve4: publicDns,
      transports: { "http:": neverEnds.transport },
    })).rejects.toMatchObject({ publicCode: "ARTICLE_FETCH_TIMEOUT" });

    await expect(fetchArticleText("http://example.com/dns", 0, {
      totalTimeoutMs: 5,
      resolve4: () => new Promise(() => {}),
    })).rejects.toMatchObject({ publicCode: "ARTICLE_FETCH_TIMEOUT" });
  });
});
