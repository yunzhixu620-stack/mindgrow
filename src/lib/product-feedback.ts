import type { AppLocale } from "@/lib/i18n";

export const FEEDBACK_CLIENT_VERSION = "10.18.0";
export const FEEDBACK_CATEGORIES = ["retrieval", "answer", "citation", "performance", "ux", "account", "feature", "community", "other"] as const;
export const FEEDBACK_SEVERITIES = ["low", "normal", "high", "blocker"] as const;
export const FEEDBACK_STATUSES = ["new", "triaged", "planned", "resolved", "closed"] as const;

export type FeedbackCategory = typeof FEEDBACK_CATEGORIES[number];
export type FeedbackSeverity = typeof FEEDBACK_SEVERITIES[number];
export type FeedbackStatus = typeof FEEDBACK_STATUSES[number];

export type ProductFeedback = {
  id: string;
  category: FeedbackCategory;
  severity: FeedbackSeverity;
  message: string;
  locale: AppLocale;
  productArea: string;
  issueTags: string[];
  status: FeedbackStatus;
  resolutionNote: string;
  resolvedVersion: string;
  followUpAcknowledgedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export const FEEDBACK_CATEGORY_LABELS: Record<FeedbackCategory, Record<AppLocale, string>> = {
  retrieval: { "zh-CN": "检索不准", en: "Retrieval" },
  answer: { "zh-CN": "回答质量", en: "Answer quality" },
  citation: { "zh-CN": "引用与证据", en: "Citations" },
  performance: { "zh-CN": "速度与稳定性", en: "Performance" },
  ux: { "zh-CN": "界面与操作", en: "UI & usability" },
  account: { "zh-CN": "登录与账号", en: "Account" },
  feature: { "zh-CN": "功能建议", en: "Feature request" },
  community: { "zh-CN": "国际反馈群", en: "Feedback group" },
  other: { "zh-CN": "其他", en: "Other" },
};

export const FEEDBACK_SEVERITY_LABELS: Record<FeedbackSeverity, Record<AppLocale, string>> = {
  low: { "zh-CN": "轻微", en: "Low" },
  normal: { "zh-CN": "一般", en: "Normal" },
  high: { "zh-CN": "影响主要任务", en: "High" },
  blocker: { "zh-CN": "无法继续使用", en: "Blocker" },
};

export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, Record<AppLocale, string>> = {
  new: { "zh-CN": "已收到", en: "Received" },
  triaged: { "zh-CN": "已分诊", en: "Triaged" },
  planned: { "zh-CN": "已排期", en: "Planned" },
  resolved: { "zh-CN": "已解决", en: "Resolved" },
  closed: { "zh-CN": "已关闭", en: "Closed" },
};

export function normalizeFeedbackRow(value: unknown): ProductFeedback | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (!FEEDBACK_CATEGORIES.includes(row.category as FeedbackCategory) || !FEEDBACK_SEVERITIES.includes(row.severity as FeedbackSeverity)) return null;
  const status = FEEDBACK_STATUSES.includes(row.status as FeedbackStatus) ? row.status as FeedbackStatus : "new";
  const id = String(row.id || "").slice(0, 100);
  if (!id) return null;
  return {
    id,
    category: row.category as FeedbackCategory,
    severity: row.severity as FeedbackSeverity,
    message: String(row.message || "").slice(0, 4000),
    locale: row.locale === "en" ? "en" : "zh-CN",
    productArea: String(row.productArea || row.product_area || "knowledge").slice(0, 40),
    issueTags: (Array.isArray(row.issueTags) ? row.issueTags : Array.isArray(row.issue_tags) ? row.issue_tags : []).map(String).slice(0, 12),
    status,
    resolutionNote: String(row.resolutionNote || row.resolution_note || "").slice(0, 1000),
    resolvedVersion: String(row.resolvedVersion || row.resolved_version || "").slice(0, 40),
    followUpAcknowledgedAt: row.followUpAcknowledgedAt || row.follow_up_acknowledged_at ? String(row.followUpAcknowledgedAt || row.follow_up_acknowledged_at) : null,
    createdAt: String(row.createdAt || row.created_at || ""),
    updatedAt: String(row.updatedAt || row.updated_at || ""),
  };
}
