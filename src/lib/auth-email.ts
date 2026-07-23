export const AUTH_EMAIL_RESEND_COOLDOWN_MS = 60_000;
export const AUTH_EMAIL_RESEND_STORAGE_KEY = "mindgrow.auth-email-resend.v1";

type CooldownStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function getAuthEmailCooldownSeconds(availableAt: number, now = Date.now()): number {
  if (!Number.isFinite(availableAt) || availableAt <= now) return 0;
  return Math.ceil((availableAt - now) / 1_000);
}

export function readAuthEmailCooldown(storage: CooldownStorage, now = Date.now()): number {
  try {
    const availableAt = Number(storage.getItem(AUTH_EMAIL_RESEND_STORAGE_KEY));
    const isPlausible = Number.isFinite(availableAt)
      && availableAt > now
      && availableAt <= now + AUTH_EMAIL_RESEND_COOLDOWN_MS * 2;
    if (isPlausible) return availableAt;
    storage.removeItem(AUTH_EMAIL_RESEND_STORAGE_KEY);
  } catch {
    // Storage is best effort; browser privacy modes may reject access.
  }
  return 0;
}

export function startAuthEmailCooldown(storage: CooldownStorage, now = Date.now()): number {
  const availableAt = now + AUTH_EMAIL_RESEND_COOLDOWN_MS;
  try {
    storage.setItem(AUTH_EMAIL_RESEND_STORAGE_KEY, String(availableAt));
  } catch {
    // The in-memory UI cooldown still applies when persistence is unavailable.
  }
  return availableAt;
}

export function clearAuthEmailCooldown(storage: CooldownStorage): void {
  try {
    storage.removeItem(AUTH_EMAIL_RESEND_STORAGE_KEY);
  } catch {
    // No action is required when storage is unavailable.
  }
}

export function isAuthEmailRateLimitError(message: string): boolean {
  return /(rate[ _-]?limit|too many requests|over_email_send_rate_limit|security purposes.*seconds|\b429\b)/i.test(message);
}
