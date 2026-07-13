"use client";

import { Header } from "./header";
import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";

export function MainLayout({ children }: { children: React.ReactNode }) {
  const [isMobile, setIsMobile] = useState(false);
  const pathname = usePathname();
  const isDocumentPage = pathname.startsWith("/guide");

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  if (isDocumentPage) {
    return <div className="min-h-screen w-full overflow-y-auto bg-[var(--bg-base)]">{children}</div>;
  }

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden">
      {!isMobile && <Header />}
      <div className="flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
