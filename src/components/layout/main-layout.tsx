"use client";

import { Header } from "./header";
import { useState, useEffect } from "react";

export function MainLayout({ children }: { children: React.ReactNode }) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden">
      {!isMobile && <Header />}
      <div className="flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
