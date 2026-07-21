import { afterEach, describe, expect, it, vi } from "vitest";
import { retainNetworkStatusListener } from "@/lib/client-api";
import { useMindGrowStore } from "@/store/mindgrow-store";

afterEach(() => {
  vi.unstubAllGlobals();
  useMindGrowStore.getState().setNetworkOnline(true);
});

describe("network sync status listener", () => {
  it("registers one shared listener pair and removes it after the final user releases", () => {
    const listeners = new Map<string, () => void>();
    const addEventListener = vi.fn((name: string, listener: () => void) => listeners.set(name, listener));
    const removeEventListener = vi.fn((name: string) => listeners.delete(name));
    const fakeNavigator = { onLine: false };
    vi.stubGlobal("navigator", fakeNavigator);
    vi.stubGlobal("window", { addEventListener, removeEventListener });

    const releaseFirst = retainNetworkStatusListener();
    const releaseSecond = retainNetworkStatusListener();

    expect(addEventListener).toHaveBeenCalledTimes(2);
    expect(useMindGrowStore.getState().networkOnline).toBe(false);

    fakeNavigator.onLine = true;
    listeners.get("online")?.();
    expect(useMindGrowStore.getState().networkOnline).toBe(true);

    releaseFirst();
    expect(removeEventListener).not.toHaveBeenCalled();
    releaseSecond();
    expect(removeEventListener).toHaveBeenCalledTimes(2);
  });
});
