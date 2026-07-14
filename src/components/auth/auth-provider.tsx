"use client";

import type { Session, User } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getAuthRedirectUrl } from "@/lib/auth-urls";
import { IS_LOCAL_MODE, apiFetch, setActiveWorkspaceId } from "@/lib/client-api";
import { supabase } from "@/lib/supabase-browser";

export interface Workspace {
  id: string;
  name: string;
  ownerId: string;
  role: "owner" | "editor" | "viewer";
  defaultMapId: string;
  createdAt: string;
  updatedAt: string;
}

interface AuthContextValue {
  loading: boolean;
  session: Session | null;
  user: User | null;
  workspaces: Workspace[];
  currentWorkspace: Workspace | null;
  message: string;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  resendConfirmation: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  createWorkspace: (name: string) => Promise<void>;
  selectWorkspace: (workspaceId: string) => void;
  refreshWorkspaces: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(!IS_LOCAL_MODE);
  const [session, setSession] = useState<Session | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [currentWorkspace, setCurrentWorkspace] = useState<Workspace | null>(null);
  const [message, setMessage] = useState("");

  const refreshWorkspaces = useCallback(async () => {
    if (IS_LOCAL_MODE) return;
    const response = await apiFetch("/api/workspaces", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "工作区加载失败");
    const rows = (data.workspaces || []) as Workspace[];
    const savedId = window.localStorage.getItem("mindgrow.workspace.v1");
    const selected = rows.find((item) => item.id === savedId) || rows[0] || null;
    setWorkspaces(rows);
    setCurrentWorkspace(selected);
    setActiveWorkspaceId(selected?.id || null);
  }, []);

  useEffect(() => {
    if (IS_LOCAL_MODE) {
      setLoading(false);
      return;
    }

    const hashParams = new URLSearchParams(window.location.hash.slice(1));
    const searchParams = new URLSearchParams(window.location.search);
    const callbackErrorCode = hashParams.get("error_code") || searchParams.get("error_code");
    const callbackError = hashParams.get("error") || searchParams.get("error");
    if (callbackErrorCode || callbackError) {
      setMessage(callbackErrorCode === "otp_expired"
        ? "确认链接已失效或已被使用。请在下方输入注册邮箱，重新发送确认邮件。"
        : "邮箱确认没有完成，请重新发送确认邮件后再试。");
      window.history.replaceState({}, "", window.location.pathname);
    }

    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      if (data.session) {
        try { await refreshWorkspaces(); } catch (error) { setMessage(error instanceof Error ? error.message : "工作区加载失败"); }
      }
      if (active) setLoading(false);
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      if (!nextSession) {
        setWorkspaces([]);
        setCurrentWorkspace(null);
        setActiveWorkspaceId(null);
      } else {
        window.setTimeout(() => void refreshWorkspaces().catch((error) => setMessage(error.message)), 0);
      }
    });
    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [refreshWorkspaces]);

  const signIn = useCallback(async (email: string, password: string) => {
    setMessage("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    setMessage("");
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: getAuthRedirectUrl() },
    });
    if (error) throw error;
    if (!data.session) setMessage("注册成功。确认邮件已发送，请使用最新邮件中的链接完成验证。");
  }, []);

  const resendConfirmation = useCallback(async (email: string) => {
    setMessage("");
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: getAuthRedirectUrl() },
    });
    if (error) throw error;
    setMessage("新的确认邮件已发送。请使用最新邮件中的链接，旧链接会失效。");
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    window.localStorage.removeItem("mindgrow.workspace.v1");
  }, []);

  const createWorkspace = useCallback(async (name: string) => {
    const response = await apiFetch("/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create", name }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "创建工作区失败");
    window.localStorage.setItem("mindgrow.workspace.v1", data.workspace.id);
    await refreshWorkspaces();
  }, [refreshWorkspaces]);

  const selectWorkspace = useCallback((workspaceId: string) => {
    const selected = workspaces.find((item) => item.id === workspaceId) || null;
    if (!selected) return;
    window.localStorage.setItem("mindgrow.workspace.v1", selected.id);
    setActiveWorkspaceId(selected.id);
    setCurrentWorkspace(selected);
  }, [workspaces]);

  const value = useMemo<AuthContextValue>(() => ({
    loading,
    session,
    user: session?.user || null,
    workspaces,
    currentWorkspace,
    message,
    signIn,
    signUp,
    resendConfirmation,
    signOut,
    createWorkspace,
    selectWorkspace,
    refreshWorkspaces,
  }), [loading, session, workspaces, currentWorkspace, message, signIn, signUp, resendConfirmation, signOut, createWorkspace, selectWorkspace, refreshWorkspaces]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
