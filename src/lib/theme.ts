export const THEME_STORAGE_KEY = "mindgrow.theme.v1";
export const THEME_CHANGE_EVENT = "mindgrow:theme-change";

export type Theme = "light" | "dark";

export function resolveInitialTheme(storedTheme: string | null, prefersDark: boolean): Theme {
  if (storedTheme === "light" || storedTheme === "dark") return storedTheme;
  return prefersDark ? "dark" : "light";
}

export function applyThemeToRoot(root: HTMLElement, theme: Theme) {
  root.dataset.theme = theme;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}

// This runs before React and CSS paint so a saved or system theme never flashes
// as the opposite theme. It contains no user-controlled interpolation.
export const THEME_BOOTSTRAP_SCRIPT = `(()=>{try{const k=${JSON.stringify(THEME_STORAGE_KEY)};const s=localStorage.getItem(k);const t=s==='light'||s==='dark'?s:(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');const r=document.documentElement;r.dataset.theme=t;r.classList.toggle('dark',t==='dark');r.style.colorScheme=t}catch{document.documentElement.dataset.theme='dark';document.documentElement.classList.add('dark')}})()`;
