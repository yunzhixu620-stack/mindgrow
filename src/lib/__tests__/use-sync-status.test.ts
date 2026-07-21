import { describe, expect, it } from "vitest";
import { deriveSyncStatus, RECENT_WRITE_ERROR_MS } from "@/lib/use-sync-status";

const now = 1_000_000;
const base = {
  networkOnline: true,
  pendingWrites: 0,
  lastSuccessAt: 900_000,
  lastError: null,
  dirty: false,
};

describe("deriveSyncStatus", () => {
  it("gives offline the highest priority", () => {
    expect(deriveSyncStatus({
      ...base,
      networkOnline: false,
      pendingWrites: 2,
      dirty: true,
      lastError: { message: "failed", at: now - 100 },
    }, now).state).toBe("offline");
  });

  it("reports syncing before error or dirty", () => {
    expect(deriveSyncStatus({
      ...base,
      pendingWrites: 1,
      dirty: true,
      lastError: { message: "failed", at: now - 100 },
    }, now).state).toBe("syncing");
  });

  it("shows only recent map-scoped errors", () => {
    expect(deriveSyncStatus({
      ...base,
      dirty: true,
      lastError: { message: "safe failure", at: now - RECENT_WRITE_ERROR_MS + 1 },
    }, now)).toMatchObject({ state: "error", error: "safe failure" });
    expect(deriveSyncStatus({
      ...base,
      dirty: true,
      lastError: { message: "expired", at: now - RECENT_WRITE_ERROR_MS },
    }, now)).toMatchObject({ state: "dirty", error: null });
  });

  it("uses local overlay existence as the dirty signal", () => {
    expect(deriveSyncStatus({ ...base, dirty: true }, now).state).toBe("dirty");
  });

  it("returns idle with the map-specific success time", () => {
    expect(deriveSyncStatus(base, now)).toEqual({ state: "idle", lastSuccessAt: 900_000, error: null });
  });
});
