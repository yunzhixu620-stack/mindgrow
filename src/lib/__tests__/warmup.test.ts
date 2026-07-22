import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HEALTH_WARMUP_COOLDOWN_MS,
  HEALTH_WARMUP_TIMEOUT_MS,
  createHealthWarmer,
} from "@/lib/warmup";

afterEach(() => {
  vi.useRealTimers();
});

describe("health warmup", () => {
  it("does not request the static site's /health when API_BASE_URL is empty", () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const warm = createHealthWarmer({ apiBaseUrl: "", fetchImpl });

    expect(warm()).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("warms only /health and shares one in-flight request", async () => {
    let resolveRequest: ((response: Response) => void) | undefined;
    const fetchImpl = vi.fn<typeof fetch>(() => new Promise<Response>((resolve) => {
      resolveRequest = resolve;
    }));
    const warm = createHealthWarmer({ apiBaseUrl: "https://api.example.test/", fetchImpl });

    const first = warm();
    const second = warm();

    expect(first).toBe(second);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.example.test/health",
      expect.objectContaining({ method: "GET", cache: "no-store", credentials: "omit" }),
    );
    expect(fetchImpl.mock.calls[0][0]).not.toContain("workspace");
    expect(fetchImpl.mock.calls[0][0]).not.toContain("knowledge");

    resolveRequest?.(new Response(null, { status: 200 }));
    await first;
  });

  it("uses a 30 second cooldown after the request settles", async () => {
    let clock = 100_000;
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));
    const warm = createHealthWarmer({ apiBaseUrl: "https://api.example.test", fetchImpl, now: () => clock });

    await warm();
    expect(warm()).toBeNull();
    clock += HEALTH_WARMUP_COOLDOWN_MS - 1;
    expect(warm()).toBeNull();
    clock += 2;
    await warm();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("aborts quickly and records only a redacted timeout diagnostic", async () => {
    vi.useFakeTimers();
    const diagnostics: unknown[] = [];
    const fetchImpl = vi.fn<typeof fetch>((_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        const error = new Error("sensitive backend details");
        error.name = "AbortError";
        reject(error);
      });
    }));
    const warm = createHealthWarmer({
      apiBaseUrl: "https://api.example.test",
      fetchImpl,
      diagnose: (diagnostic) => diagnostics.push(diagnostic),
    });

    const request = warm();
    await vi.advanceTimersByTimeAsync(HEALTH_WARMUP_TIMEOUT_MS);
    await request;

    expect(diagnostics).toEqual([{ kind: "timeout" }]);
    expect(JSON.stringify(diagnostics)).not.toContain("sensitive backend details");
    expect(JSON.stringify(diagnostics)).not.toContain("api.example.test");
  });

  it("records sanitized HTTP status without rejecting the caller", async () => {
    const diagnostics: unknown[] = [];
    const warm = createHealthWarmer({
      apiBaseUrl: "https://api.example.test",
      fetchImpl: vi.fn<typeof fetch>(async () => new Response("internal body", { status: 503 })),
      diagnose: (diagnostic) => diagnostics.push(diagnostic),
    });

    await expect(warm()).resolves.toBeUndefined();
    expect(diagnostics).toEqual([{ kind: "http", status: 503 }]);
    expect(JSON.stringify(diagnostics)).not.toContain("internal body");
  });
});
