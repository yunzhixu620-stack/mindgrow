"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useMindGrowStore } from "@/store/mindgrow-store";
import { ChatMessage, AIMindMap } from "@/types";
import { apiFetch, IS_LOCAL_MODE } from "@/lib/client-api";
import { buildSelectedMindMap } from "@/lib/knowledge-selection";
import { useSpeechInput } from "@/hooks/use-speech-input";
import { useLocale } from "@/components/i18n/locale-provider";

// ============================================================
// Simple Markdown renderer
// ============================================================
function renderMarkdown(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.*?)\*\*/g, '<strong style="color:var(--text-primary)">$1</strong>')
    .replace(/_(.*?)_/g, '<em style="color:var(--muted-foreground)">$1</em>')
    .replace(/\n/g, '<br/>');
}

const CAPABILITY_PROMPT = "AI 知识助手包含哪些能力？";
const CAPABILITY_ANSWER = "MindGrow 可以收集资料、整理知识、检索证据，并用可核验引用回答问题。";

function CapabilityAnswer() {
  const steps = [
    ["01", "收集", "碎片、网页、PDF、会议"],
    ["02", "整理", "分类、导图、实体关系"],
    ["03", "检索", "GraphRAG 查找相关证据"],
    ["04", "追溯", "引用原文；证据不足就拒答"],
  ];

  return (
    <div data-testid="capability-answer" className="min-w-0">
      <div className="font-semibold text-[var(--foreground)]">MindGrow 用一条链路完成 4 件事</div>
      <div className="mt-3 space-y-2">
        {steps.map(([number, title, description]) => (
          <div key={number} className="flex items-center gap-2.5">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--primary-subtle)] text-[9px] font-semibold text-[var(--primary)]">{number}</span>
            <span className="w-9 shrink-0 text-xs font-semibold text-[var(--foreground)]">{title}</span>
            <span className="min-w-0 text-[11px] text-[var(--text-secondary)]">{description}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 rounded-lg border border-[var(--primary-border)] bg-[var(--primary-subtle)] px-3 py-2 text-[10px] text-[var(--primary-hover)]">
        最短路径：粘贴内容 → 确认导图 → 向知识库提问
      </div>
    </div>
  );
}

function AnswerFeedback({ messageId }: { messageId: string }) {
  const [rating, setRating] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(`mindgrow.feedback.${messageId}`);
    if (saved === "up" || saved === "down") setRating(saved);
  }, [messageId]);

  const rate = (value: "up" | "down") => {
    const next = rating === value ? null : value;
    setRating(next);
    if (next) window.localStorage.setItem(`mindgrow.feedback.${messageId}`, next);
    else window.localStorage.removeItem(`mindgrow.feedback.${messageId}`);
  };

  return (
    <div className="mt-2 pt-2 border-t border-white/5 flex items-center gap-1" aria-label="回答反馈">
      <span className="text-[10px] text-[var(--text-muted)] mr-1">这条回答有帮助吗？</span>
      <button
        type="button"
        onClick={() => rate("up")}
        aria-label="回答有帮助"
        aria-pressed={rating === "up"}
        className={`w-6 h-6 rounded-md text-[11px] cursor-pointer ${rating === "up" ? "bg-[var(--primary-subtle)] text-[var(--primary)]" : "text-[var(--text-tertiary)] hover:bg-white/5"}`}
      >
        👍
      </button>
      <button
        type="button"
        onClick={() => rate("down")}
        aria-label="回答需要改进"
        aria-pressed={rating === "down"}
        className={`w-6 h-6 rounded-md text-[11px] cursor-pointer ${rating === "down" ? "bg-red-500/10 text-red-300" : "text-[var(--text-tertiary)] hover:bg-white/5"}`}
      >
        👎
      </button>
      {rating && <span className="text-[10px] text-[var(--text-tertiary)] ml-1">已记录</span>}
    </div>
  );
}

// ============================================================
// Message bubble
// ============================================================
function MessageBubble({ msg }: { msg: ChatMessage }) {
  if (msg.role === "system") return null;
  const isUser = msg.role === "user";
  const routeLabel = msg.retrievalTrace?.queryRoute
    ? ({ basic: "精确检索", local: "实体局部检索", drift: "多跳探索", global: "全库概览" } as const)[msg.retrievalTrace.queryRoute]
    : null;
  return (
    <div data-chat-message-id={msg.id} className={`flex ${isUser ? "justify-end" : "justify-start"} animate-fade-in-up`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? "bg-[var(--primary)] text-[var(--primary-foreground)] rounded-br-sm"
            : "bg-[var(--muted)] text-[var(--foreground)] rounded-bl-sm"
        }`}
        style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
      >
        {msg.id.startsWith("capability_")
          ? <CapabilityAnswer />
          : <div dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />}
        {!isUser && msg.sources && msg.sources.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5 border-t border-white/5 pt-2" aria-label="回答来源">
            {msg.sources.map((source) => (
              source.sourceUrl
                ? <a key={`${source.id}-${source.index}`} href={source.sourceUrl} target="_blank" rel="noreferrer" title={source.quote || source.title} className="rounded-md bg-[var(--primary-subtle)] px-2 py-1 text-[10px] text-[var(--primary-hover)] hover:ring-1 hover:ring-[var(--primary)]">[{source.index}] {source.title}{source.locator ? ` · ${source.locator}` : ""}</a>
                : <span key={`${source.id}-${source.index}`} title={source.quote || source.title} className="rounded-md bg-[var(--primary-subtle)] px-2 py-1 text-[10px] text-[var(--primary-hover)]">[{source.index}] {source.title}{source.locator ? ` · ${source.locator}` : ""}</span>
            ))}
          </div>
        )}
        {!isUser && msg.retrievalTrace && (
          <div className="mt-2 rounded-lg border border-violet-400/20 bg-violet-400/5 px-2.5 py-2 text-[10px] text-violet-200" data-testid="graphrag-trace">
            <span className="mr-1.5 font-semibold">检索链路{routeLabel ? ` · ${routeLabel}` : ""}</span>
            {msg.retrievalTrace.needsDisambiguation
              ? "实体消歧 · 找到 " + String(msg.retrievalTrace.entitySeeds || 0) + " 个同名候选，已暂停自动回答"
              : (msg.retrievalTrace.entitySeeds || 0) > 0
                ? "Entity Graph · " + String(msg.retrievalTrace.entitySeeds || 0) + " 个实体入口 → " + String(msg.retrievalTrace.entityRelations || 0) + " 条受控关系 · " + String(msg.retrievalTrace.entityEvidence || 0) + " 条原文证据"
                : "GraphRAG · " + String(msg.retrievalTrace.seedNodes || 0) + " 个概念入口 → " + String(msg.retrievalTrace.expandedNodes || 0) + " 个邻域节点 · " + String(msg.retrievalTrace.candidateChunks || 0) + " 个候选证据块"}
          </div>
        )}
        {!isUser && !msg.id.startsWith("welcome_") && <AnswerFeedback messageId={msg.id} />}
      </div>
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
  placement: {
    targetTopic: string;
    confidence: number;
    reason: string;
    supplement?: boolean;
    predictedReuse?: number;
    predictedReuseRate?: number;
    total?: number;
    warning?: string;
  } | null;
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
      {placement?.targetTopic && (
        <div className="text-xs text-[var(--muted-foreground)] bg-[var(--background)] rounded-lg px-3 py-2 flex items-center gap-2">
          <span>📌</span>
          <span>建议归入「{placement.targetTopic}」（{Math.round(placement.confidence * 100)}%）</span>
        </div>
      )}
      {placement?.supplement && (
        <div data-testid="supplement-reuse-plan" className={`rounded-lg border px-3 py-2 text-xs ${placement.warning ? "border-amber-400/30 bg-amber-400/10 text-amber-100" : "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"}`}>
          <div className="font-semibold">补充模式 · 预计复用 {Math.round((placement.predictedReuseRate || 0) * 100)}%</div>
          <div className="mt-1 text-[10px] opacity-80">{placement.warning || "优先更新已有主题，确认后再写入。"}</div>
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
    <div className="flex justify-start animate-fade-in" role="status" aria-live="polite" data-testid="knowledge-typing-indicator">
      <div className="flex items-center gap-2.5 bg-[var(--muted)] rounded-2xl rounded-bl-sm px-4 py-3">
        <div className="flex gap-1.5 items-center">
          <span className="w-1.5 h-1.5 bg-[var(--primary)] rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
          <span className="w-1.5 h-1.5 bg-[var(--primary)] rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
          <span className="w-1.5 h-1.5 bg-[var(--primary)] rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
        </div>
        <span className="text-[11px] text-[var(--text-tertiary)]">正在检索知识库并组织回答…</span>
      </div>
    </div>
  );
}

// ============================================================
// Main Chat Panel
// ============================================================
export function ChatPanel() {
  const { locale } = useLocale();
  const english = locale === "en";
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
    updateMapNodeCount,
  } = useMindGrowStore();

  const [input, setInput] = useState("");
  const appendSpeech = useCallback((text: string) => {
    setInput((current) => `${current}${current && !current.endsWith(" ") ? " " : ""}${text}`);
  }, []);
  const speech = useSpeechInput(appendSpeech, english ? "en-US" : "zh-CN");
  const [confirming, setConfirming] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [cloudStatus, setCloudStatus] = useState<"checking" | "connected" | "offline">(
    IS_LOCAL_MODE ? "connected" : "checking"
  );
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const activeChatRequestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    if (IS_LOCAL_MODE) return;

    let active = true;
    const checkCloud = async () => {
      try {
        const response = await apiFetch("/health", { cache: "no-store" });
        if (!response.ok) throw new Error(`Health check failed: ${response.status}`);
        const data = await response.json();
        if (active) setCloudStatus(data.status === "ok" ? "connected" : "offline");
      } catch {
        if (active) setCloudStatus("offline");
      }
    };

    void checkCloud();
    const timer = window.setInterval(checkCloud, 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, pendingMindMap, scrollToBottom]);

  useEffect(() => {
    return () => activeChatRequestRef.current?.abort();
  }, []);

  const handleSend = useCallback(async () => {
    if (!input.trim() || isProcessing || confirming) return;
    const userMessage: ChatMessage = {
      id: `msg_${Date.now()}`,
      role: "user",
      content: input.trim(),
      timestamp: new Date().toISOString(),
    };
    addMessage(userMessage);
    setInput("");
    if (userMessage.content.replace(/[？?]/g, "").trim() === CAPABILITY_PROMPT.replace(/[？?]/g, "")) {
      addMessage({
        id: `capability_${Date.now()}`,
        role: "assistant",
        content: CAPABILITY_ANSWER,
        timestamp: new Date().toISOString(),
      });
      return;
    }
    setProcessing(true);
    const requestMapId = currentMapId;
    activeChatRequestRef.current?.abort();
    const controller = new AbortController();
    activeChatRequestRef.current = controller;

    try {
      const res = await apiFetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          input: userMessage.content,
          mapId: requestMapId,
          history: messages.filter((message) => message.role !== "system" && !message.id.startsWith("welcome_")).slice(-8).map((message) => ({ role: message.role, content: message.content })),
        }),
      });
      const data = await res.json();
      const latest = useMindGrowStore.getState();
      if (controller.signal.aborted || latest.currentMode !== "knowledge" || latest.currentMapId !== requestMapId) return;
      if (!res.ok || data.error) {
        addMessage({
          id: `msg_${Date.now()}_rejected`,
          role: "assistant",
          content: data.error || "当前内容无法读取，请检查后重试。",
          timestamp: new Date().toISOString(),
        });
        return;
      }
      const aiMessage: ChatMessage = {
        id: `msg_${Date.now()}_ai`,
        role: "assistant",
        content: data.reply || "😅 出了点问题，请重试",
        timestamp: new Date().toISOString(),
        sources: Array.isArray(data.sources) ? data.sources : undefined,
        retrievalTrace: data.retrievalTrace,
      };
      addMessage(aiMessage);
      if (data.type === "knowledge" && data.mindMap) {
        setPendingMindMap(data.mindMap);
        setPendingPlacement(data.placement || null);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      console.error("Chat error:", error);
      addMessage({
        id: `msg_${Date.now()}_err`,
        role: "assistant",
        content: "网络请求失败了，请重试一下",
        timestamp: new Date().toISOString(),
      });
    } finally {
      if (activeChatRequestRef.current === controller) activeChatRequestRef.current = null;
      const latest = useMindGrowStore.getState();
      if (!controller.signal.aborted && latest.currentMode === "knowledge" && latest.currentMapId === requestMapId) setProcessing(false);
    }
  }, [input, isProcessing, confirming, currentMapId, messages, addMessage, setProcessing, setPendingMindMap, setPendingPlacement]);

  // Confirm with selected nodes only
  const handleConfirm = useCallback(async (selectedChildren: { childIdx: number; items: string[] }[]) => {
    if (!pendingMindMap || confirming) return;
    setConfirming(true);
    const requestMapId = currentMapId;

    // Build filtered mindMap with only selected nodes
    const filteredMindMap = buildSelectedMindMap(pendingMindMap, selectedChildren);

    // Skip if no children selected
    if (filteredMindMap.children.length === 0) {
      setConfirming(false);
      return;
    }

    try {
      const res = await apiFetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        writeForMapId: requestMapId,
        body: JSON.stringify({
          mindMap: filteredMindMap,
          mapId: requestMapId,
          source: "ai_generated",
          placement: pendingPlacement,
        }),
      });
      const data = await res.json();
      const latest = useMindGrowStore.getState();
      if (latest.currentMode !== "knowledge" || latest.currentMapId !== requestMapId) return;

      if (data.error) {
        addMessage({
          id: `msg_${Date.now()}_err2`,
          role: "assistant",
          content: `添加失败：${data.error}`,
          timestamp: new Date().toISOString(),
        });
      } else {
        const reloadRes = await apiFetch(`/api/knowledge?mapId=${requestMapId}`);
        if (reloadRes.ok) {
          const { nodes, edges } = await reloadRes.json();
          const current = useMindGrowStore.getState();
          if (current.currentMode === "knowledge" && current.currentMapId === requestMapId) {
            setNodes(nodes);
            setEdges(edges);
            updateMapNodeCount(requestMapId, Array.isArray(nodes) ? nodes.length : 0);
          }
        }
        const current = useMindGrowStore.getState();
        if (current.currentMode !== "knowledge" || current.currentMapId !== requestMapId) return;
        addMessage({
          id: `msg_${Date.now()}_confirm`,
          role: "assistant",
          content: data.reusedNodes
            ? `✅ 已新增 ${data.totalNodes || 0} 个节点，并复用 ${data.reusedNodes} 个相似节点（复用率 ${Math.round((data.reuseRate || 0) * 100)}%）。${data.reuseWarning || "知识已自动耦合到现有主题。"}`
            : `✅ 已创建 ${data.totalNodes || 0} 个知识节点！思维导图已更新 🌱`,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error) {
      const latest = useMindGrowStore.getState();
      if (latest.currentMode !== "knowledge" || latest.currentMapId !== requestMapId) return;
      console.error("Confirm error:", error);
      addMessage({
        id: `msg_${Date.now()}_err3`,
        role: "assistant",
        content: "添加失败了，请重试一下",
        timestamp: new Date().toISOString(),
      });
    } finally {
      const latest = useMindGrowStore.getState();
      if (latest.currentMode === "knowledge" && latest.currentMapId === requestMapId) {
        setPendingMindMap(null);
        setPendingPlacement(null);
      }
      setConfirming(false);
    }
  }, [pendingMindMap, pendingPlacement, confirming, currentMapId, setNodes, setEdges, updateMapNodeCount, addMessage, setPendingMindMap, setPendingPlacement]);

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

  const nodeCount = useMindGrowStore((state) => state.nodes.length);

  return (
    <div className={`flex flex-col ${isMobile ? 'w-full !min-w-0 !max-w-full' : 'w-[380px] min-w-[320px]'} border-r border-[var(--border)] bg-[var(--card)] h-full`}>
      {/* Chat header */}
      <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${cloudStatus === "offline" ? "bg-amber-400" : "bg-[var(--primary)] animate-pulse-glow"}`}
          />
          <div>
            <div className="text-xs font-semibold text-[var(--foreground)]">{english ? "Knowledge chat" : "知识对话"}</div>
            <div className="text-[9px] text-[var(--text-tertiary)] mt-0.5">
              {IS_LOCAL_MODE
                ? (english ? "Local library · autosaved" : "本地知识库 · 自动保存")
                : cloudStatus === "checking"
                  ? (english ? "Connecting to cloud API…" : "正在连接云端 API…")
                  : cloudStatus === "connected"
                    ? (english ? "Cloud library · API connected" : "云端知识库 · API 已连接")
                    : (english ? "Cloud API unavailable · retrying" : "云端 API 暂不可用 · 自动重试")}
            </div>
          </div>
        </div>
        <span className="text-[10px] text-[var(--muted-foreground)]">{english ? `${nodeCount} nodes` : `${nodeCount} 个节点`}</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}

        {messages.length <= 1 && !pendingMindMap && (
          <div className="flex flex-wrap gap-2 animate-fade-in">
            {(english
              ? ["What can this AI knowledge assistant do?", "Remember: RAG answers need traceable sources", "How can I find gaps in this library?"]
              : [CAPABILITY_PROMPT, "记录：RAG 回答需要引用可追溯来源", "如何发现当前知识库的缺口？"]).map((prompt) => (
              <button
                type="button"
                key={prompt}
                onClick={() => setInput(prompt)}
                className="text-left text-[11px] leading-relaxed text-[var(--text-secondary)] bg-[var(--bg-elevated)] hover:text-[var(--primary)] border border-[var(--border)] rounded-xl px-3 py-2 cursor-pointer"
              >
                {prompt}
              </button>
            ))}
          </div>
        )}

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
            disabled={isProcessing || confirming}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={english ? "Add a note, paste a passage, or ask a question…" : "输入知识点、粘贴文章片段..."}
            aria-label={english ? "Add knowledge or ask the library" : "输入知识或向知识库提问"}
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
            type="button"
            onClick={speech.toggle}
            aria-label={speech.isListening ? (english ? "Stop voice input" : "停止语音输入") : (english ? "Start voice input" : "开始语音输入")}
            title={speech.supported ? (speech.isListening ? (english ? "Stop voice input" : "停止语音输入") : (english ? "Voice input" : "语音输入")) : (english ? "Voice input is not supported in this browser" : "当前浏览器不支持语音输入")}
            className={`flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center ${speech.isListening ? "bg-red-500/20 text-red-300" : "bg-[var(--bg-elevated)] text-[var(--text-secondary)]"}`}
          >
            {speech.isListening ? "■" : "🎙"}
          </button>
          <button
            onClick={handleSend}
            disabled={!input.trim() || isProcessing || confirming}
            aria-label={english ? "Send" : "发送"}
            className="flex-shrink-0 w-8 h-8 bg-[var(--primary)] text-[var(--primary-foreground)] rounded-xl flex items-center justify-center hover:opacity-90 transition-opacity disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 2L11 13" /><path d="M22 2L15 22L11 13L2 9L22 2Z" />
            </svg>
          </button>
        </div>
        <div className="flex items-center justify-between mt-1 px-1">
          <span className="text-[10px] text-[var(--muted-foreground)]">{english ? "Enter send · Shift+Enter new line" : "Enter 发送 · Shift+Enter 换行"}</span>
          {speech.interimText && <span className="max-w-[180px] truncate text-[10px] text-[var(--primary)]">{english ? "Recognizing: " : "正在识别："}{speech.interimText}</span>}
        </div>
        {speech.error && <div role="status" className="mt-1 px-1 text-[10px] text-amber-300">{speech.error}</div>}
      </div>
    </div>
  );
}
