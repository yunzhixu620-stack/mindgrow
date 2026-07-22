import { describe, expect, it } from "vitest";
import { MOBILE_NAV_MODES } from "@/components/mobile/bottom-nav";
import { MODE_LIBRARY_CONFIG } from "@/lib/mode-libraries";

describe("mobile bottom navigation", () => {
  it("contains exactly the three product boards in the intended order", () => {
    expect(MOBILE_NAV_MODES).toEqual(["knowledge", "article", "meeting"]);
    expect(MOBILE_NAV_MODES.map((mode) => MODE_LIBRARY_CONFIG[mode].shortLabel)).toEqual(["知识", "文章", "会议"]);
  });

  it("keeps every create action scoped to a real product library", () => {
    expect(MOBILE_NAV_MODES.every((mode) => Boolean(MODE_LIBRARY_CONFIG[mode].marker || mode === "knowledge"))).toBe(true);
  });
});
