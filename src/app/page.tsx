"use client";

import { useEffect, useState } from "react";
import { MindMapPanel } from "@/components/mindmap/mind-map-panel";
import { ChatPanel } from "@/components/chat/chat-panel";
import { Sidebar } from "@/components/layout/sidebar";
import { useMindGrowStore } from "@/store/mindgrow-store";

export default function Home() {
  const { currentMapId, setCurrentMapId, setMaps, setNodes, setEdges, setMessages } = useMindGrowStore();
  const [mobileTab, setMobileTab] = useState<"chat" | "map">("chat");
  const [isMobile, setIsMobile] = useState(false);

  // Detect mobile
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Fix iOS virtual keyboard not restoring viewport
  useEffect(() => {
    if (!isMobile) return;
    const visualViewport = window.visualViewport;
    if (!visualViewport) return;
    let prevHeight = visualViewport.height;
    const onResize = () => {
      if (visualViewport.height > prevHeight) {
        // Keyboard closed - scroll to top to restore layout
        window.scrollTo(0, 0);
        document.documentElement.style.setProperty("--vh", `${visualViewport.height}px`);
      }
      prevHeight = visualViewport.height;
    };
    visualViewport.addEventListener("resize", onResize);
    return () => visualViewport.removeEventListener("resize", onResize);
  }, [isMobile]);

  // Load maps on mount
  useEffect(() => {
    fetch("/api/knowledge?action=maps")
      .then((r) => r.json())
      .then((data) => setMaps(data.maps || []))
      .catch(() => {});
  }, [setMaps]);

  // Load data when map changes
  useEffect(() => {
    fetch(`/api/knowledge?mapId=${currentMapId}`)
      .then((r) => r.json())
      .then((data) => {
        setNodes(data.nodes || []);
        setEdges(data.edges || []);
      })
      .catch(() => {});

    setMessages([
      {
        id: `welcome_${currentMapId}`,
        role: "assistant",
        content: "🌱 欢迎！在下方输入你的碎片想法，我来帮你整理成思维导图。\n\n试试输入一个知识点，比如「深度学习」或「产品设计」",
        timestamp: new Date().toISOString(),
      },
    ]);
  }, [currentMapId, setNodes, setEdges, setMessages]);

  // Mobile layout
  if (isMobile) {
    return (
      <main className="flex flex-col h-screen w-screen overflow-hidden bg-[var(--bg-base)]">
        {/* Mobile tab bar */}
        <div
          className="flex border-b border-[var(--border)] bg-[var(--card)] shrink-0"
          style={{
            paddingTop: "env(safe-area-inset-top)",
            paddingBottom: "env(safe-area-inset-bottom)",
          }}
        >
          <button
            onClick={() => setMobileTab("chat")}
            className={`flex-1 py-3 text-xs font-medium transition-all cursor-pointer ${
              mobileTab === "chat" ? "text-[var(--primary)] border-b-2 border-[var(--primary)]" : "text-[var(--muted-foreground)]"
            }`}
          >
            💬 对话
          </button>
          <button
            onClick={() => setMobileTab("map")}
            className={`flex-1 py-3 text-xs font-medium transition-all cursor-pointer ${
              mobileTab === "map" ? "text-[var(--primary)] border-b-2 border-[var(--primary)]" : "text-[var(--muted-foreground)]"
            }`}
          >
            🌿 导图
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          {mobileTab === "chat" ? (
            <div className="w-full h-full [&>div]:!w-full [&>div]:!min-w-0 [&>div]:!max-w-full">
              <ChatPanel />
            </div>
          ) : (
            <MindMapPanel />
          )}
        </div>
      </main>
    );
  }

  // Desktop layout
  return (
    <main className="flex h-screen w-screen overflow-hidden">
      <div className="flex h-full">
        <Sidebar />
        <ChatPanel />
      </div>
      <MindMapPanel />
    </main>
  );
}
