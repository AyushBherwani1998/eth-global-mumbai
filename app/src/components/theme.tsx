"use client";

// Appearance setting (UI.md section 4, UX.md 3.10): system | light | dark.
// Persisted in localStorage("theme"); applied as data-theme on <html>.
// The pre-paint script in app/layout.tsx (THEME_SCRIPT) applies the same rule
// before React hydrates, so there is no flash. A `?theme=light|dark` URL
// override wins for that page load (screenshots) and is not persisted.

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";

export type ThemeSetting = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_KEY = "theme";
export const THEME_COLORS: Record<ResolvedTheme, string> = { light: "#FFFFFF", dark: "#121212" };

/** Inline, pre-paint. Keep in sync with applyTheme() below. */
export const THEME_SCRIPT = `(function(){try{var q=new URLSearchParams(location.search).get("theme");var t=q==="light"||q==="dark"?q:localStorage.getItem("theme");var d=document.documentElement;if(t==="light"||t==="dark"){d.setAttribute("data-theme",t)}else{d.removeAttribute("data-theme")}var r=t==="light"||t==="dark"?t:(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");var ms=document.querySelectorAll('meta[name="theme-color"]');for(var i=0;i<ms.length;i++){var m=ms[i].getAttribute("media");if(t==="light"||t==="dark"){ms[i].setAttribute("content",r==="dark"?"#121212":"#FFFFFF")}else if(m&&m.indexOf("dark")>-1){ms[i].setAttribute("content","#121212")}else{ms[i].setAttribute("content","#FFFFFF")}}}catch(e){}})()`;

function readStored(): ThemeSetting {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function readOverride(): ResolvedTheme | null {
  try {
    const q = new URLSearchParams(window.location.search).get("theme");
    return q === "light" || q === "dark" ? q : null;
  } catch {
    return null;
  }
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Writes data-theme and the theme-color meta tags. */
function applyTheme(setting: ThemeSetting) {
  const d = document.documentElement;
  if (setting === "light" || setting === "dark") d.setAttribute("data-theme", setting);
  else d.removeAttribute("data-theme");
  const resolved = setting === "system" ? systemTheme() : setting;
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    const media = m.getAttribute("media");
    if (setting !== "system") m.content = THEME_COLORS[resolved];
    else m.content = media && media.includes("dark") ? THEME_COLORS.dark : THEME_COLORS.light;
  });
}

type ThemeCtx = {
  /** The user's setting. */
  theme: ThemeSetting;
  /** What is actually on screen right now. */
  resolved: ResolvedTheme;
  setTheme: (t: ThemeSetting) => void;
};

const Ctx = createContext<ThemeCtx | null>(null);

// Tiny external store: localStorage + the OS preference. useSyncExternalStore
// keeps the server snapshot ("system" / light) until hydration, then reads the
// real value without a setState-in-effect cascade or a hydration error (the
// pre-paint script already stamped the attribute, so nothing visibly changes).
const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onStorage = (e: StorageEvent) => {
    if (e.key === THEME_KEY) {
      applyTheme(readStored());
      cb();
    }
  };
  mq.addEventListener("change", cb);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    mq.removeEventListener("change", cb);
    window.removeEventListener("storage", onStorage);
  };
}
const getSetting = (): ThemeSetting => readStored();
const getResolved = (): ResolvedTheme => {
  const effective = readOverride() ?? readStored();
  return effective === "system" ? systemTheme() : effective;
};

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore(subscribe, getSetting, () => "system" as ThemeSetting);
  const resolved = useSyncExternalStore(subscribe, getResolved, () => "light" as ResolvedTheme);

  const setTheme = useCallback((t: ThemeSetting) => {
    try {
      if (t === "system") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, t);
    } catch {}
    applyTheme(t);
    emit();
  }, []);

  // Keep the theme-color metas in step when the OS preference flips while on "system".
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => {
      if ((readOverride() ?? readStored()) === "system") applyTheme("system");
    };
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const value = useMemo(() => ({ theme, resolved, setTheme }), [theme, resolved, setTheme]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTheme outside ThemeProvider");
  return v;
}

/**
 * Fires `cb` whenever the effective theme changes: the data-theme attribute on
 * <html> (in-app toggle) or the OS preference while on "system". Charts use it
 * to re-read tokens.
 */
export function useOnThemeChange(cb: () => void) {
  useEffect(() => {
    const obs = new MutationObserver(cb);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", cb);
    return () => {
      obs.disconnect();
      mq.removeEventListener("change", cb);
    };
  }, [cb]);
}
