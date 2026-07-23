import { describe, expect, it } from "vitest";
import {
  AUTH_EMAIL_RESEND_COOLDOWN_MS,
  AUTH_EMAIL_RESEND_STORAGE_KEY,
  clearAuthEmailCooldown,
  getAuthEmailCooldownSeconds,
  isAuthEmailRateLimitError,
  readAuthEmailCooldown,
  startAuthEmailCooldown,
} from "@/lib/auth-email";

function createStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(AUTH_EMAIL_RESEND_STORAGE_KEY, initial);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

describe("S2.18 auth email frequency control", () => {
  it("persists a 60 second browser cooldown without storing the email address", () => {
    const storage = createStorage();
    const now = 1_800_000_000_000;
    const availableAt = startAuthEmailCooldown(storage, now);

    expect(availableAt).toBe(now + AUTH_EMAIL_RESEND_COOLDOWN_MS);
    expect(readAuthEmailCooldown(storage, now + 1_000)).toBe(availableAt);
    expect(getAuthEmailCooldownSeconds(availableAt, now + 1_001)).toBe(59);
    expect(storage.getItem(AUTH_EMAIL_RESEND_STORAGE_KEY)).toBe(String(availableAt));
  });

  it("removes expired or implausibly long values instead of locking out the user", () => {
    const now = 1_800_000_000_000;
    const expired = createStorage(String(now - 1));
    const corrupt = createStorage(String(now + AUTH_EMAIL_RESEND_COOLDOWN_MS * 3));

    expect(readAuthEmailCooldown(expired, now)).toBe(0);
    expect(expired.getItem(AUTH_EMAIL_RESEND_STORAGE_KEY)).toBeNull();
    expect(readAuthEmailCooldown(corrupt, now)).toBe(0);
    expect(corrupt.getItem(AUTH_EMAIL_RESEND_STORAGE_KEY)).toBeNull();
  });

  it("clears the persisted cooldown and recognizes common Supabase throttling errors", () => {
    const storage = createStorage("1800000060000");
    clearAuthEmailCooldown(storage);
    expect(storage.getItem(AUTH_EMAIL_RESEND_STORAGE_KEY)).toBeNull();
    expect(isAuthEmailRateLimitError("email rate limit exceeded")).toBe(true);
    expect(isAuthEmailRateLimitError("For security purposes, you can only request this after 60 seconds.")).toBe(true);
    expect(isAuthEmailRateLimitError("HTTP 429 Too Many Requests")).toBe(true);
    expect(isAuthEmailRateLimitError("Invalid login credentials")).toBe(false);
  });
});
