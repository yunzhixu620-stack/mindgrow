"use client";

import { Header } from "./header";
import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { AuthProvider, useAuth } from "@/components/auth/auth-provider";
import { AuthScreen } from "@/components/auth/auth-screen";
import { IS_LOCAL_MODE } from "@/lib/client-api";

export function MainLayout({ children }: { children: React.ReactNode }) {
  return <AuthProvider><AuthenticatedLayout>{children}</AuthenticatedLayout></AuthProvider>;
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
    return <div className="h-screen w-screen bg-[var(--bg-base)] flex items-center justify-center text-sm text-[var(--text-tertiary)]">正在安全连接…</div>;
  }
  if (!IS_LOCAL_MODE && !session) return <AuthScreen />;

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden">
      {!isMobile && <Header />}
      <div className="flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
