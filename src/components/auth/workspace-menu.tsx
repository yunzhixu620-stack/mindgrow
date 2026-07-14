"use client";

import { useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { IS_LOCAL_MODE } from "@/lib/client-api";

export function WorkspaceMenu({ compact = false }: { compact?: boolean }) {
  const { currentWorkspace, workspaces, selectWorkspace, createWorkspace, signOut, user } = useAuth();
  const [busy, setBusy] = useState(false);
  if (IS_LOCAL_MODE || !currentWorkspace) return null;

  async function addWorkspace() {
    const name = window.prompt("新工作区名称");
    if (!name?.trim()) return;
    setBusy(true);
    try { await createWorkspace(name.trim()); }
    catch (error) { window.alert(error instanceof Error ? error.message : "创建失败"); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex items-center gap-1">
      <select
        aria-label="切换工作区"
        value={currentWorkspace.id}
        onChange={(event) => selectWorkspace(event.target.value)}
        className={`${compact ? "max-w-[120px]" : "max-w-[170px]"} rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1.5 text-[11px] text-[var(--text-secondary)] outline-none`}
        title={user?.email || "当前工作区"}
      >
        {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
      </select>
      <button type="button" onClick={addWorkspace} disabled={busy} aria-label="新建工作区" title="新建工作区" className="w-7 h-7 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)] disabled:opacity-50">＋</button>
      <button type="button" onClick={() => void signOut()} aria-label="退出登录" title={`退出登录${user?.email ? ` · ${user.email}` : ""}`} className="w-7 h-7 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)]">↪</button>
    </div>
  );
}
