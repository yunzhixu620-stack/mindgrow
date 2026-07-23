"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { useLocale } from "@/components/i18n/locale-provider";
import { apiFetch } from "@/lib/client-api";
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_CATEGORY_LABELS,
  FEEDBACK_CLIENT_VERSION,
  FEEDBACK_SEVERITIES,
  FEEDBACK_SEVERITY_LABELS,
  FEEDBACK_STATUS_LABELS,
  normalizeFeedbackRow,
  type FeedbackCategory,
  type FeedbackSeverity,
  type ProductFeedback,
} from "@/lib/product-feedback";
import { useMindGrowStore } from "@/store/mindgrow-store";

function safeDeviceClass() {
  if (typeof window === "undefined") return "unknown";
  return window.innerWidth < 640 ? "mobile" : window.innerWidth < 1024 ? "tablet" : "desktop";
}

export function FeedbackCenter({ compact = false }: { compact?: boolean }) {
  const { locale, t } = useLocale();
  const { user } = useAuth();
  const { currentMode, currentMapId } = useMindGrowStore();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"new" | "history">("new");
  const [category, setCategory] = useState<FeedbackCategory>("ux");
  const [severity, setSeverity] = useState<FeedbackSeverity>("normal");
  const [message, setMessage] = useState("");
  const [allowContact, setAllowContact] = useState(false);
  const [items, setItems] = useState<ProductFeedback[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const pendingFollowUps = useMemo(() => items.filter((item) => (
    (item.status === "resolved" || item.status === "closed") && item.resolvedVersion && !item.followUpAcknowledgedAt
  )).length, [items]);

  const loadFeedback = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await apiFetch("/api/knowledge?action=feedback");
      if (!response.ok) throw new Error("feedback unavailable");
      const body = await response.json();
      setItems((Array.isArray(body.feedback) ? body.feedback : []).map(normalizeFeedbackRow).filter(Boolean) as ProductFeedback[]);
    } catch {
      setError(t("feedback.failure"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadFeedback();
  }, [loadFeedback]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  async function submitFeedback(nextCategory = category, nextMessage = message, communityRequest = false) {
    const productArea = window.location.pathname.startsWith("/universe") ? "universe" : currentMode;
    setNotice("");
    setError("");
    if (communityRequest && !allowContact) {
      setError(t("feedback.groupNeedsContact"));
      return;
    }
    if (!communityRequest && nextMessage.trim().length < 20) {
      setError(locale === "en" ? "Please provide at least 20 characters." : "请至少填写 20 个字，便于准确处理。" );
      return;
    }
    setSending(true);
    try {
      const response = await apiFetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "submitFeedback",
          category: nextCategory,
          severity: communityRequest ? "low" : severity,
          message: communityRequest
            ? (locale === "en" ? "Request an invitation to the international MindGrow feedback group." : "申请加入 MindGrow 国际用户反馈群。")
            : nextMessage.trim(),
          locale,
          productArea,
          allowContact,
          contactEmail: allowContact ? user?.email || "" : "",
          clientVersion: FEEDBACK_CLIENT_VERSION,
          context: {
            route: window.location.pathname,
            mode: productArea,
            mapId: currentMapId || "",
            deviceClass: safeDeviceClass(),
          },
        }),
      });
      if (!response.ok) throw new Error("feedback rejected");
      const body = await response.json();
      const created = normalizeFeedbackRow(body.feedback);
      if (created) setItems((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      if (!communityRequest) setMessage("");
      setNotice(communityRequest ? t("feedback.groupSent") : t("feedback.success"));
      setTab("history");
    } catch {
      setError(t("feedback.failure"));
    } finally {
      setSending(false);
    }
  }

  async function acknowledge(item: ProductFeedback) {
    try {
      const response = await apiFetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "acknowledgeFeedback", feedbackId: item.id }),
      });
      if (!response.ok) throw new Error("acknowledge failed");
      const body = await response.json();
      const updated = normalizeFeedbackRow(body.feedback);
      if (updated) setItems((current) => current.map((candidate) => candidate.id === updated.id ? updated : candidate));
    } catch {
      setError(t("feedback.failure"));
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("feedback.open")}
        title={t("feedback.open")}
        className={`${compact ? "h-7 px-1.5 text-[10px]" : "h-8 px-2 text-xs"} relative rounded-lg text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]`}
      >
        💬{!compact && <span className="ml-1">{t("feedback.open")}</span>}
        {pendingFollowUps > 0 && <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-emerald-400 px-1 text-[9px] font-bold text-slate-950">{pendingFollowUps}</span>}
      </button>

      {open && (
        <div className="fixed inset-0 z-[500] flex items-end justify-center bg-black/65 p-0 backdrop-blur-sm md:items-center md:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="feedback-title" className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-[var(--border-strong)] bg-[var(--bg-surface)] shadow-2xl md:rounded-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] px-5 py-4">
              <div>
                <h2 id="feedback-title" className="text-base font-semibold text-[var(--text-primary)]">{t("feedback.title")}</h2>
                <p className="mt-1 text-xs leading-5 text-[var(--text-tertiary)]">{t("feedback.subtitle")}</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label={t("feedback.close")} className="h-8 w-8 rounded-lg text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]">×</button>
            </div>

            <div className="grid grid-cols-2 gap-1 border-b border-[var(--border-subtle)] p-2">
              <button type="button" onClick={() => setTab("new")} className={`rounded-lg px-3 py-2 text-xs font-medium ${tab === "new" ? "bg-[var(--primary)] text-[var(--primary-foreground)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"}`}>{t("feedback.new")}</button>
              <button type="button" onClick={() => { setTab("history"); void loadFeedback(); }} className={`relative rounded-lg px-3 py-2 text-xs font-medium ${tab === "history" ? "bg-[var(--primary)] text-[var(--primary-foreground)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"}`}>{t("feedback.history")}{pendingFollowUps > 0 ? ` · ${pendingFollowUps}` : ""}</button>
            </div>

            <div className="overflow-y-auto p-5">
              {tab === "new" ? (
                <div className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="text-xs text-[var(--text-secondary)]">
                      <span className="mb-1.5 block">{t("feedback.category")}</span>
                      <select value={category} onChange={(event) => setCategory(event.target.value as FeedbackCategory)} className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg-base)] px-3 py-2.5 outline-none focus:border-[var(--primary)]">
                        {FEEDBACK_CATEGORIES.filter((item) => item !== "community").map((item) => <option key={item} value={item}>{FEEDBACK_CATEGORY_LABELS[item][locale]}</option>)}
                      </select>
                    </label>
                    <label className="text-xs text-[var(--text-secondary)]">
                      <span className="mb-1.5 block">{t("feedback.severity")}</span>
                      <select value={severity} onChange={(event) => setSeverity(event.target.value as FeedbackSeverity)} className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg-base)] px-3 py-2.5 outline-none focus:border-[var(--primary)]">
                        {FEEDBACK_SEVERITIES.map((item) => <option key={item} value={item}>{FEEDBACK_SEVERITY_LABELS[item][locale]}</option>)}
                      </select>
                    </label>
                  </div>
                  <textarea value={message} onChange={(event) => setMessage(event.target.value.slice(0, 4000))} rows={7} placeholder={t("feedback.message")} className="w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--bg-base)] px-3 py-3 text-sm leading-6 outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--primary)]" />
                  <div className="flex items-start gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
                    <input id="feedback-contact" type="checkbox" checked={allowContact} onChange={(event) => setAllowContact(event.target.checked)} className="mt-0.5" />
                    <label htmlFor="feedback-contact" className="text-xs leading-5 text-[var(--text-secondary)]">{t("feedback.contact")}</label>
                  </div>
                  <p className="text-[11px] leading-5 text-[var(--text-muted)]">{t("feedback.privacy")}</p>
                  {(notice || error) && <p role="status" className={`rounded-xl px-3 py-2 text-xs ${error ? "bg-red-500/10 text-red-300" : "bg-emerald-500/10 text-emerald-300"}`}>{error || notice}</p>}
                  <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                    <button type="button" disabled={sending} onClick={() => void submitFeedback("community", "", true)} className="rounded-xl border border-violet-400/30 bg-violet-400/10 px-4 py-2.5 text-xs font-medium text-violet-200 disabled:opacity-50">🌍 {t("feedback.group")}</button>
                    <button type="button" data-testid="feedback-submit" aria-label={locale === "en" ? "Submit feedback" : "提交反馈"} disabled={sending} onClick={() => void submitFeedback()} className="rounded-xl bg-[var(--primary)] px-5 py-2.5 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50">{sending ? t("feedback.sending") : t("feedback.send")}</button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {loading && <p className="text-xs text-[var(--text-tertiary)]">{t("feedback.loading")}</p>}
                  {!loading && items.length === 0 && <p className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-xs text-[var(--text-tertiary)]">{t("feedback.empty")}</p>}
                  {items.map((item) => {
                    const hasFollowUp = (item.status === "resolved" || item.status === "closed") && item.resolvedVersion;
                    return (
                      <article key={item.id} className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap gap-1.5 text-[10px]">
                            <span className="rounded-full bg-[var(--primary-subtle)] px-2 py-1 text-[var(--primary-hover)]">{FEEDBACK_CATEGORY_LABELS[item.category][locale]}</span>
                            <span className="rounded-full border border-[var(--border)] px-2 py-1 text-[var(--text-secondary)]">{FEEDBACK_STATUS_LABELS[item.status][locale]}</span>
                            {hasFollowUp && <span className="rounded-full bg-emerald-400/15 px-2 py-1 font-semibold text-emerald-300">{t("feedback.fixedIn", { version: item.resolvedVersion })}</span>}
                          </div>
                          <time className="text-[10px] text-[var(--text-muted)]">{item.createdAt ? new Date(item.createdAt).toLocaleDateString(locale) : item.id}</time>
                        </div>
                        <p className="mt-3 whitespace-pre-wrap text-xs leading-5 text-[var(--text-secondary)]">{item.message}</p>
                        {item.resolutionNote && <p className="mt-3 rounded-lg border-l-2 border-emerald-400 bg-emerald-400/5 px-3 py-2 text-xs leading-5 text-[var(--text-secondary)]">{item.resolutionNote}</p>}
                        {hasFollowUp && !item.followUpAcknowledgedAt && <button type="button" onClick={() => void acknowledge(item)} className="mt-3 rounded-lg border border-emerald-400/30 px-3 py-1.5 text-[11px] font-medium text-emerald-300 hover:bg-emerald-400/10">{t("feedback.ack")}</button>}
                      </article>
                    );
                  })}
                  {error && <p role="status" className="rounded-xl bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
