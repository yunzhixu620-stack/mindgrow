"use client";

import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { useLocale } from "@/components/i18n/locale-provider";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import {
  clearAuthEmailCooldown,
  getAuthEmailCooldownSeconds,
  isAuthEmailRateLimitError,
  readAuthEmailCooldown,
  startAuthEmailCooldown,
} from "@/lib/auth-email";

export function AuthScreen() {
  const { signIn, signUp, resendConfirmation, message } = useAuth();
  const { t } = useLocale();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState("");
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  const cooldownSeconds = getAuthEmailCooldownSeconds(cooldownUntil, clock);

  useEffect(() => {
    const now = Date.now();
    setClock(now);
    setCooldownUntil(readAuthEmailCooldown(window.localStorage, now));
  }, []);

  useEffect(() => {
    if (!cooldownUntil) return;
    const remaining = cooldownUntil - Date.now();
    if (remaining <= 0) {
      clearAuthEmailCooldown(window.localStorage);
      setCooldownUntil(0);
      return;
    }
    const timer = window.setTimeout(() => setClock(Date.now()), Math.min(1_000, remaining));
    return () => window.clearTimeout(timer);
  }, [clock, cooldownUntil]);

  function beginEmailCooldown() {
    const now = Date.now();
    setClock(now);
    setCooldownUntil(startAuthEmailCooldown(window.localStorage, now));
  }
  const localizedMessage = message && t("auth.signIn") === "Sign in"
    ? message
      .replace("注册成功。确认邮件已发送，请使用最新邮件中的链接完成验证。", "Account created. Use the newest confirmation email to verify it.")
      .replace("新的确认邮件已发送。请使用最新邮件中的链接，旧链接会失效。", "A new confirmation email was sent. Use the newest link; older links are invalid.")
      .replace("确认链接已过期或无效。请在下方输入邮箱并重新发送确认邮件。", "The confirmation link expired or is invalid. Enter your email below and resend it.")
    : message;

  function describeAuthError(raw: string) {
    if (raw.includes("Invalid login")) return t("auth.invalid");
    if (raw.includes("Email not confirmed")) return t("auth.unconfirmed");
    if (isAuthEmailRateLimitError(raw)) return t("auth.rateLimit");
    return raw;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (password.length < 8) {
      setError(t("auth.passwordLength"));
      return;
    }
    setBusy(true);
    try {
      if (mode === "signin") await signIn(email.trim(), password);
      else {
        await signUp(email.trim(), password);
        beginEmailCooldown();
      }
    } catch (reason) {
      const raw = reason instanceof Error ? reason.message : t("auth.failure");
      setError(describeAuthError(raw));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setError("");
    if (cooldownSeconds > 0) return;
    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      setError(t("auth.emailRequired"));
      return;
    }
    setResending(true);
    try {
      await resendConfirmation(normalizedEmail);
      beginEmailCooldown();
    } catch (reason) {
      const raw = reason instanceof Error ? reason.message : t("auth.sendFailure");
      if (isAuthEmailRateLimitError(raw)) beginEmailCooldown();
      setError(describeAuthError(raw));
    } finally {
      setResending(false);
    }
  }

  return (
    <main className="min-h-screen w-full overflow-y-auto bg-[var(--bg-base)] flex items-center justify-center p-5">
      <div className="relative w-full max-w-[420px] rounded-3xl border border-[var(--border-strong)] bg-[var(--bg-surface)] p-7 shadow-2xl">
        <div className="absolute right-5 top-5"><LocaleSwitcher /></div>
        <div className="flex items-center gap-3 mb-7">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-black text-xl" style={{ background: "linear-gradient(135deg, #22d3a7, #06b6d4)" }}>✦</div>
          <div>
            <h1 className="text-xl font-semibold">MindGrow</h1>
            <p className="text-xs text-[var(--text-tertiary)]">{t("auth.subtitle")}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 rounded-xl bg-[var(--bg-elevated)] p-1 mb-6">
          <button onClick={() => setMode("signin")} className={`rounded-lg py-2 text-sm ${mode === "signin" ? "bg-[var(--primary)] text-[var(--primary-foreground)] font-medium" : "text-[var(--text-secondary)]"}`}>{t("auth.signIn")}</button>
          <button onClick={() => setMode("signup")} className={`rounded-lg py-2 text-sm ${mode === "signup" ? "bg-[var(--primary)] text-[var(--primary-foreground)] font-medium" : "text-[var(--text-secondary)]"}`}>{t("auth.signUp")}</button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="block text-xs text-[var(--text-secondary)] mb-1.5">{t("auth.email")}</span>
            <input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg-base)] px-4 py-3 text-sm outline-none focus:border-[var(--primary)]" />
          </label>
          <label className="block">
            <span className="block text-xs text-[var(--text-secondary)] mb-1.5">{t("auth.password")}</span>
            <input type="password" required minLength={8} autoComplete={mode === "signin" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={t("auth.passwordHint")} className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg-base)] px-4 py-3 text-sm outline-none focus:border-[var(--primary)]" />
          </label>
          {(error || localizedMessage) && <div role="status" className={`rounded-xl px-3 py-2 text-xs ${error ? "bg-red-500/10 text-red-300" : "bg-emerald-500/10 text-emerald-300"}`}>{error || localizedMessage}</div>}
          <button disabled={busy} className="w-full rounded-xl bg-[var(--primary)] py-3 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50">{busy ? t("auth.wait") : mode === "signin" ? t("auth.enter") : t("auth.create")}</button>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2.5 text-center">
            <p className="text-[11px] text-[var(--text-tertiary)]">{t("auth.recoveryPrompt")}</p>
            <button type="button" disabled={busy || resending || cooldownSeconds > 0} onClick={resend} className="mt-1 text-xs font-medium text-[var(--primary)] hover:underline disabled:opacity-50">
              {resending
                ? t("auth.resending")
                : cooldownSeconds > 0
                  ? t("auth.resendCooldown", { seconds: cooldownSeconds })
                  : t("auth.resend")}
            </button>
            <p className="mt-1 text-[10px] leading-relaxed text-[var(--text-muted)]">{t("auth.deliveryHint")}</p>
          </div>
        </form>
        <p className="mt-5 text-center text-[10px] leading-relaxed text-[var(--text-muted)]">{t("auth.privacy")}</p>
      </div>
    </main>
  );
}
