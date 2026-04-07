"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useMindGrowStore } from "@/store/mindgrow-store";
import { ChatMessage, AIMindMap } from "@/types";
import { API_BASE_URL } from "@/lib/config";

// ============================================================
// Simple Markdown renderer
// ============================================================
function renderMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong style="color:var(--text-primary)">$1</strong>')
    .replace(/_(.*?)_/g, '<em style="color:var(--muted-foreground)">$1</em>')
    .replace(/\n/g, '<br/>');
}

// ============================================================
// Message bubble
// ============================================================
function MessageBubble({ msg }: { msg: ChatMessage }) {
  if (msg.role === "system") return null;
  const isUser = msg.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} animate-fade-in-up`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? "bg-[var(--primary)] text-[var(--primary-foreground)] rounded-br-sm"
            : "bg-[var(--muted)] text-[var(--foreground)] rounded-bl-sm"
        }`}
        style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
        dangerouslySetInnerHTML={{ __html: isUser ? msg.content : renderMarkdown(msg.content) }}
      />
    </div>
  );
}

// ============================================================
// Selectable mind map preview card
// ============================================================
function MindMapPreview({
  mindMap,
  placement,
  onConfirm,
  onCancel,
  isProcessing,
}: {
  mindMap: AIMindMap;
  placement: { targetTopic: string; confidence: number; reason: string } | null;
  onConfirm: (selected: { childIdx: number; items: string[] }[]) => void;
  onCancel: () => void;
  isProcessing: boolean;
}) {
  // Track which children and items are selected
  const [selected, setSelected] = useState<Record<number, boolean[]>>(
    () => {
      const init: Record<number, boolean[]> = {};
      mindMap.children.forEach((child, i) => {
        init[i] = [true, ...child.items.map(() => true)];
      });
      return init;
    }
  );

  const toggleChild = useCallback((childIdx: number) => {
    setSelected((prev) => {
      const current = prev[childIdx];
      const newChecked = !current[0];
      return {
        ...prev,
        [childIdx]: [newChecked, ...current.slice(1).map(() => newChecked)],
      };
    });
  }, []);

  const toggleItem = useCallback((childIdx: number, itemIdx: number) => {
    setSelected((prev) => {
      const current = [...prev[childIdx]];
      current[itemIdx + 1] = !current[itemIdx + 1]; // +1 because [0] is the child itself
      // If all items unchecked, uncheck parent too
      const allItemsUnchecked = current.slice(1).every((v) => !v);
      if (allItemsUnchecked) current[0] = false;
      else if (!current[0] && current[itemIdx + 1]) current[0] = true;
      return { ...prev, [childIdx]: current };
    });
  }, []);

  const branchColors = ["#22d3a7", "#6366f1", "#06b6d4", "#f59e0b", "#f43f5e"];

  // Count selected nodes
  const selectedCount = (() => {
    let count = 1; // root always included
    for (const child of mindMap.children) {
      const idx = mindMap.children.indexOf(child);
      const s = selected[idx];
      if (!s) continue;
      if (s[0]) count++; // child itself
      child.items.forEach((_, i) => { if (s[i + 1]) count++; });
    }
    return count;
  })();

  const handleConfirm = useCallback(() => {
    const result: { childIdx: number; items: string[] }[] = [];
    mindMap.children.forEach((child, idx) => {
      const s = selected[idx];
      if (!s || !s[0]) return; // skip unchecked children
      const items: string[] = [];
      child.items.forEach((item, i) => {
        if (s[i + 1]) items.push(item);
      });
      result.push({ childIdx: idx, items });
    });
    if (result.length === 0) return;
    onConfirm(result);
  }, [selected, mindMap, onConfirm]);

  return (
    <div className="bg-[var(--muted)] rounded-2xl rounded-bl-sm p-4 space-y-3 animate-fade-in-up">
      {/* Placement suggestion */}
      {placement && (
        <div className="text-xs text-[var(--muted-foreground)] bg-[var(--background)] rounded-lg px-3 py-2 flex items-center gap-2">
          <span>📌</span>
          <span>建议归入「{placement.targetTopic}」（{Math.round(placement.confidence * 100)}%）</span>
        </div>
      )}

      {/* Root */}
      <div className="space-y-2">
        <div className="text-sm font-semibold text-[var(--primary)] flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--primary)]" />
          <span>{mindMap.root}</span>
        </div>
        {mindMap.rootDesc && (
          <div className="text-xs text-[var(--muted-foreground)] ml-4 italic">
            {mindMap.rootDesc}
          </div>
        )}
      </div>

      {/* Children with checkboxes */}
      <div className="ml-2 space-y-2">
        {mindMap.children.map((child, i) => {
          const color = branchColors[i % branchColors.length];
          const isChecked = selected[i]?.[0] ?? true;
          return (
            <div key={i} className={`rounded-lg p-2 transition-all ${isChecked ? "bg-[var(--bg-hover)]" : "opacity-40"}`}>
              {/* Child header with checkbox */}
              <label className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => toggleChild(i)}
                  className="w-3.5 h-3.5 rounded accent-[var(--primary)] cursor-pointer"
                />
                <span className="w-1 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                <span className="text-sm font-medium text-[var(--foreground)] flex-1">{child.topic}</span>
              </label>
              {/* Child description */}
              {child.desc && (
                <div className="text-[10px] text-[var(--muted-foreground)] ml-5.5 mt-0.5">
                  {child.desc}
                </div>
              )}
              {/* Items with checkboxes */}
              {isChecked && (
                <div className="ml-5.5 mt-1 space-y-0.5">
                  {child.items.map((item, j) => {
                    const itemChecked = selected[i]?.[j + 1] ?? true;
                    return (
                      <label key={j} className="flex items-center gap-2 cursor-pointer group py-0.5">
                        <input
                          type="checkbox"
                          checked={itemChecked}
                          onChange={() => toggleItem(i, j)}
                          className="w-3 h-3 rounded accent-[var(--primary)] cursor-pointer"
                        />
                        <span className={`text-xs transition-all ${itemChecked ? "text-[var(--foreground)]" : "text-[var(--muted-foreground)] line-through opacity-50"}`}>
                          {item}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Related topics */}
      {mindMap.relatedTopics && mindMap.relatedTopics.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {mindMap.relatedTopics.map((t, i) => (
            <span key={i} className="text-[10px] text-[var(--muted-foreground)] bg-[var(--background)] px-2 py-0.5 rounded-full">
              🔗 {t}
            </span>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between pt-1">
        <span className="text-[10px] text-[var(--muted-foreground)]">
          已选 {selectedCount} 个节点
        </span>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            disabled={isProcessing}
            className="px-4 bg-[var(--border)] text-[var(--foreground)] rounded-xl py-2 text-sm hover:opacity-80 transition-all cursor-pointer disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={isProcessing || selectedCount <= 1}
            className="px-4 bg-[var(--primary)] text-[var(--primary-foreground)] rounded-xl py-2 text-sm font-medium hover:opacity-90 transition-all cursor-pointer disabled:opacity-50"
          >
            {isProcessing ? "⏳ 添加中..." : `✅ 添加 ${selectedCount} 节点`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Typing indicator
// ============================================================
function TypingIndicator() {
  return (
    <div className="flex justify-start animate-fade-in">
      <div className="bg-[var(--muted)] rounded-2xl rounded-bl-sm px-4 py-3">
        <div className="flex gap-1.5 items-center">
          <span className="w-1.5 h-1.5 bg-[var(--primary)] rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
          <span className="w-1.5 h-1.5 bg-[var(--primary)] rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
          <span className="w-1.5 h-1.5 bg-[var(--primary)] rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Main Chat Panel
// ============================================================
export function ChatPanel() {
  const {
    currentMapId,
    messages,
    addMessage,
    isProcessing,
    setProcessing,
    pendingMindMap,
    setPendingMindMap,
    pendingPlacement,
    setPendingPlacement,
    setNodes,
    setEdges,
  } = useMindGrowStore();

  const [input, setInput] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, pendingMindMap, scrollToBottom]);

  // Load initial data
  useEffect(() => {
    fetch(API_BASE_URL + "/api/knowledge")
      .then((res) => res.json())
      .then(({ nodes, edges }) => {
        if (nodes.length > 0) {
          useMindGrowStore.getState().setNodes(nodes);
          useMindGrowStore.getState().setEdges(edges);
        }
      })
      .catch(console.error);
  }, []);

  const handleSend = useCallback(async () => {
    if (!input.trim() || isProcessing) return;
    const userMessage: ChatMessage = {
      id: `msg_${Date.now()}`,
      role: "user",
      content: input.trim(),
      timestamp: new Date().toISOString(),
    };
    addMessage(userMessage);
    setInput("");
    setProcessing(true);

    try {
      const res = await fetch(API_BASE_URL + "/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: userMessage.content, mapId: currentMapId }),
      });
      const data = await res.json();
      const aiMessage: ChatMessage = {
        id: `msg_${Date.now()}_ai`,
        role: "assistant",
        content: data.reply || "😅 出了点问题，请重试",
        timestamp: new Date().toISOString(),
      };
      addMessage(aiMessage);
      if (data.type === "knowledge" && data.mindMap) {
        setPendingMindMap(data.mindMap);
        setPendingPlacement(data.placement || null);
      }
    } catch (error) {
      console.error("Chat error:", error);
      addMessage({
        id: `msg_${Date.now()}_err`,
        role: "assistant",
        content: "网络请求失败了，请重试一下",
        timestamp: new Date().toISOString(),
      });
    } finally {
      setProcessing(false);
    }
  }, [input, isProcessing, currentMapId, addMessage, setProcessing, setPendingMindMap, setPendingPlacement]);

  // Confirm with selected nodes only
  const handleConfirm = useCallback(async (selectedChildren: { childIdx: number; items: string[] }[]) => {
    if (!pendingMindMap || confirming) return;
    setConfirming(true);

    // Build filtered mindMap with only selected nodes
    const filteredMindMap = {
      root: pendingMindMap.root,
      rootDesc: pendingMindMap.rootDesc,
      rootType: pendingMindMap.rootType,
      children: selectedChildren
        .filter((s) => s.items.length > 0)
        .map((s) => ({
          topic: pendingMindMap.children[s.childIdx].topic,
          desc: pendingMindMap.children[s.childIdx].desc,
          type: pendingMindMap.children[s.childIdx].type,
          items: s.items,
        })),
      relatedTopics: pendingMindMap.relatedTopics,
    };

    // Skip if no children selected
    if (filteredMindMap.children.length === 0) {
      setConfirming(false);
      return;
    }

    try {
      const res = await fetch(API_BASE_URL + "/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mindMap: filteredMindMap,
          mapId: currentMapId,
          source: "ai_generated",
        }),
      });
      const data = await res.json();

      if (data.error) {
        addMessage({
          id: `msg_${Date.now()}_err2`,
          role: "assistant",
          content: `添加失败：${data.error}`,
          timestamp: new Date().toISOString(),
        });
      } else {
        const reloadRes = await fetch(API_BASE_URL + "/api/knowledge");
        if (reloadRes.ok) {
          const { nodes, edges } = await reloadRes.json();
          setNodes(nodes);
          setEdges(edges);
        }
        addMessage({
          id: `msg_${Date.now()}_confirm`,
          role: "assistant",
          content: `✅ 已创建 ${data.totalNodes || 0} 个知识节点！思维导图已更新 🌱`,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error) {
      console.error("Confirm error:", error);
      addMessage({
        id: `msg_${Date.now()}_err3`,
        role: "assistant",
        content: "添加失败了，请重试一下",
        timestamp: new Date().toISOString(),
      });
    } finally {
      setPendingMindMap(null);
      setPendingPlacement(null);
      setConfirming(false);
    }
  }, [pendingMindMap, confirming, currentMapId, setNodes, setEdges, addMessage, setPendingMindMap, setPendingPlacement]);

  const handleCancel = useCallback(() => {
    setPendingMindMap(null);
    setPendingPlacement(null);
  }, [setPendingMindMap, setPendingPlacement]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const nodeCount = useMindGrowStore.getState().nodes.length;

  return (
    <div className={`flex flex-col ${isMobile ? 'w-full !min-w-0 !max-w-full' : 'w-[380px] min-w-[320px]'} border-r border-[var(--border)] bg-[var(--card)] h-full`}>
      {/* Chat header */}
      <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-[var(--primary)] animate-pulse-glow" />
          <span className="text-xs font-semibold text-[var(--foreground)]">知识对话</span>
        </div>
        <span className="text-[10px] text-[var(--muted-foreground)]">{nodeCount} 个节点</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}

        {pendingMindMap && (
          <MindMapPreview
            mindMap={pendingMindMap}
            placement={pendingPlacement}
            onConfirm={handleConfirm}
            onCancel={handleCancel}
            isProcessing={confirming}
          />
        )}

        {isProcessing && <TypingIndicator />}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-[var(--border)] shrink-0">
        <div className="flex items-end gap-2 bg-[var(--background)] rounded-2xl px-4 py-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入知识点、粘贴文章片段..."
            rows={1}
            className="flex-1 bg-transparent text-sm resize-none outline-none max-h-[120px] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]"
            style={{ height: "auto", minHeight: "24px", lineHeight: "24px" }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = "auto";
              target.style.height = Math.min(target.scrollHeight, 120) + "px";
            }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isProcessing}
            className="flex-shrink-0 w-8 h-8 bg-[var(--primary)] text-[var(--primary-foreground)] rounded-xl flex items-center justify-center hover:opacity-90 transition-opacity disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 2L11 13" /><path d="M22 2L15 22L11 13L2 9L22 2Z" />
            </svg>
          </button>
        </div>
        <div className="flex items-center justify-between mt-1 px-1">
          <span className="text-[10px] text-[var(--muted-foreground)]">Enter 发送 · Shift+Enter 换行</span>
        </div>
      </div>
    </div>
  );
}
