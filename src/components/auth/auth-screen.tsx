"use client";

import { FormEvent, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";

export function AuthScreen() {
  const { signIn, signUp, message } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("密码至少需要 8 位");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signin") await signIn(email.trim(), password);
      else await signUp(email.trim(), password);
    } catch (reason) {
      const raw = reason instanceof Error ? reason.message : "登录失败，请重试";
      setError(raw.includes("Invalid login") ? "邮箱或密码不正确" : raw);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen w-full overflow-y-auto bg-[var(--bg-base)] flex items-center justify-center p-5">
      <div className="w-full max-w-[420px] rounded-3xl border border-[var(--border-strong)] bg-[var(--bg-surface)] p-7 shadow-2xl">
        <div className="flex items-center gap-3 mb-7">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-black text-xl" style={{ background: "linear-gradient(135deg, #22d3a7, #06b6d4)" }}>✦</div>
          <div>
            <h1 className="text-xl font-semibold">MindGrow</h1>
            <p className="text-xs text-[var(--text-tertiary)]">你的私有 AI 知识工作区</p>
          </div>
        </div>

        <div className="grid grid-cols-2 rounded-xl bg-[var(--bg-elevated)] p-1 mb-6">
          <button onClick={() => setMode("signin")} className={`rounded-lg py-2 text-sm ${mode === "signin" ? "bg-[var(--primary)] text-black font-medium" : "text-[var(--text-secondary)]"}`}>登录</button>
          <button onClick={() => setMode("signup")} className={`rounded-lg py-2 text-sm ${mode === "signup" ? "bg-[var(--primary)] text-black font-medium" : "text-[var(--text-secondary)]"}`}>注册</button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="block text-xs text-[var(--text-secondary)] mb-1.5">邮箱</span>
            <input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg-base)] px-4 py-3 text-sm outline-none focus:border-[var(--primary)]" />
          </label>
          <label className="block">
            <span className="block text-xs text-[var(--text-secondary)] mb-1.5">密码</span>
            <input type="password" required minLength={8} autoComplete={mode === "signin" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 8 位" className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg-base)] px-4 py-3 text-sm outline-none focus:border-[var(--primary)]" />
          </label>
          {(error || message) && <div role="status" className={`rounded-xl px-3 py-2 text-xs ${error ? "bg-red-500/10 text-red-300" : "bg-emerald-500/10 text-emerald-300"}`}>{error || message}</div>}
          <button disabled={busy} className="w-full rounded-xl bg-[var(--primary)] py-3 text-sm font-semibold text-black disabled:opacity-50">{busy ? "请稍候…" : mode === "signin" ? "进入工作区" : "创建账号"}</button>
        </form>
        <p className="mt-5 text-center text-[10px] leading-relaxed text-[var(--text-muted)]">登录后，每个工作区的数据独立存储；浏览器不会接触数据库管理密钥。</p>
      </div>
    </main>
  );
}
