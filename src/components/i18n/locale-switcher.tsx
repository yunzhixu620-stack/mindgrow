"use client";

import { useLocale } from "@/components/i18n/locale-provider";

export function LocaleSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t } = useLocale();
  return (
    <select
      aria-label={t("locale.label")}
      title={t("locale.label")}
      value={locale}
      onChange={(event) => setLocale(event.target.value === "en" ? "en" : "zh-CN")}
      className={`${compact ? "h-7 w-[58px] px-1 text-[10px]" : "h-8 w-[66px] px-1.5 text-[11px]"} rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] outline-none`}
    >
      <option value="zh-CN">中文</option>
      <option value="en">EN</option>
    </select>
  );
}
