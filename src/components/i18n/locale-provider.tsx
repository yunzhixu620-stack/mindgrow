"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { LOCALE_STORAGE_KEY, resolveAppLocale, translate, type AppLocale, type MessageKey } from "@/lib/i18n";

type LocaleContextValue = {
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
  t: (key: MessageKey, values?: Record<string, string | number>) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>("zh-CN");

  useEffect(() => {
    let stored: string | null = null;
    try { stored = window.localStorage.getItem(LOCALE_STORAGE_KEY); } catch { /* Use browser language when storage is unavailable. */ }
    setLocaleState(resolveAppLocale(stored, window.navigator.language));
    document.documentElement.dataset.mindgrowHydrated = "true";
    return () => { delete document.documentElement.dataset.mindgrowHydrated; };
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: AppLocale) => {
    setLocaleState(next);
    try { window.localStorage.setItem(LOCALE_STORAGE_KEY, next); } catch { /* Preference persistence is best effort. */ }
  }, []);

  const value = useMemo<LocaleContextValue>(() => ({
    locale,
    setLocale,
    t: (key, values) => translate(locale, key, values),
  }), [locale, setLocale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const value = useContext(LocaleContext);
  if (!value) throw new Error("useLocale must be used within LocaleProvider");
  return value;
}
