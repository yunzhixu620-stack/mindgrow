import { describe, expect, it } from "vitest";
import { resolveAppLocale, translate } from "@/lib/i18n";
import { normalizeFeedbackRow } from "@/lib/product-feedback";

describe("S2.17 interface locale", () => {
  it("prefers an explicit stored locale and otherwise follows the browser", () => {
    expect(resolveAppLocale("en", "zh-CN")).toBe("en");
    expect(resolveAppLocale("zh-CN", "en-US")).toBe("zh-CN");
    expect(resolveAppLocale(null, "zh-HK")).toBe("zh-CN");
    expect(resolveAppLocale(null, "fr-FR")).toBe("en");
  });

  it("renders parameterized Chinese and English shell copy", () => {
    expect(translate("zh-CN", "header.nodes", { count: 12 })).toBe("12 节点");
    expect(translate("en", "header.nodes", { count: 12 })).toBe("12 nodes");
    expect(translate("zh-CN", "auth.resendCooldown", { seconds: 42 })).toBe("42 秒后可再次发送");
    expect(translate("en", "auth.resendCooldown", { seconds: 42 })).toBe("Resend in 42s");
    expect(translate("en", "feedback.fixedIn", { version: "10.17.0" })).toBe("Fixed in 10.17.0");
  });
});
describe("S2.17 feedback contract", () => {
  it("normalizes a tagged release follow-up without exposing unknown fields", () => {
    const feedback = normalizeFeedbackRow({
      id: "feedback_1",
      category: "retrieval",
      severity: "high",
      message: "The wrong document was returned.",
      locale: "en",
      product_area: "article",
      issue_tags: ["category:retrieval", "area:article"],
      status: "resolved",
      resolution_note: "Hybrid retrieval now prioritizes the grounded article.",
      resolved_version: "10.17.0",
      follow_up_acknowledged_at: null,
      created_at: "2026-07-23T00:00:00.000Z",
      updated_at: "2026-07-23T01:00:00.000Z",
      contact_email: "must-not-be-returned@example.com",
    });
    expect(feedback).toMatchObject({
      id: "feedback_1",
      category: "retrieval",
      productArea: "article",
      status: "resolved",
      resolvedVersion: "10.17.0",
    });
    expect(feedback).not.toHaveProperty("contactEmail");
  });

  it("drops rows with invalid categories instead of inventing issue tags", () => {
    expect(normalizeFeedbackRow({ id: "feedback_2", category: "secret", severity: "normal" })).toBeNull();
  });
});
