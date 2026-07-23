import { describe, expect, it, vi } from "vitest";
import { initialSessionWithTimeout } from "@/lib/auth-session-init";

describe("initial Supabase session timeout", () => {
  it("returns the existing session when initialization completes", async () => {
    const session = { access_token: "token" };
    await expect(initialSessionWithTimeout(
      async () => ({ data: { session } }),
      20,
    )).resolves.toEqual({ status: "ready", session });
  });

  it("releases the authentication gate when session initialization hangs", async () => {
    vi.useFakeTimers();
    const pending = initialSessionWithTimeout(
      () => new Promise(() => undefined),
      12_000,
    );
    await vi.advanceTimersByTimeAsync(12_000);
    await expect(pending).resolves.toEqual({ status: "timeout", session: null });
    vi.useRealTimers();
  });

  it("turns initialization errors into a recoverable signed-out state", async () => {
    await expect(initialSessionWithTimeout(
      async () => { throw new Error("auth unavailable"); },
      20,
    )).resolves.toEqual({ status: "error", session: null });
  });
});
