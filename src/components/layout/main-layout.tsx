"use client";

import { Header } from "./header";
import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { AuthProvider, useAuth } from "@/components/auth/auth-provider";
import { AuthScreen } from "@/components/auth/auth-screen";
import { IS_LOCAL_MODE } from "@/lib/client-api";
import { warmupHealth } from "@/lib/warmup";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { CommandPalette } from "@/components/ui/command-palette";
import { SyncIndicator } from "@/components/ui/sync-indicator";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { LocaleProvider, useLocale } from "@/components/i18n/locale-provider";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import { FeedbackCenter } from "@/components/feedback/feedback-center";

export function MainLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    void warmupHealth();
  }, []);

  return <LocaleProvider><AuthProvider><AuthenticatedLayout>{children}</AuthenticatedLayout></AuthProvider></LocaleProvider>;
}

function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const [isMobile, setIsMobile] = useState(false);
  const pathname = usePathname();
  const isDocumentPage = pathname.startsWith("/guide");
  const { loading, session } = useAuth();

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  if (isDocumentPage) {
    return <div className="h-screen w-full overflow-y-scroll overscroll-y-contain bg-[var(--bg-base)]" data-guide-scroll>{children}</div>;
  }

  if (!IS_LOCAL_MODE && loading) {
    return <ConnectingScreen />;
  }
  if (!IS_LOCAL_MODE && !session) return <AuthScreen />;

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden">
      {isMobile ? <div className="flex shrink-0 items-center gap-1 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] pr-2" data-testid="mobile-breadcrumb-bar"><div className="min-w-0 flex-1"><Breadcrumb compact /></div><SyncIndicator compact /><ThemeToggle compact /><LocaleSwitcher compact /><FeedbackCenter compact /></div> : <Header />}
      <div className="flex-1 overflow-hidden">{children}</div>
      {pathname === "/" && <CommandPalette />}
    </div>
  );
}

function ConnectingScreen() {
  const { t } = useLocale();
  return <div className="flex h-screen w-screen items-center justify-center bg-[var(--bg-base)] text-sm text-[var(--text-tertiary)]">{t("app.connecting")}</div>;
}
