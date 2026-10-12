import { useEffect, useState } from "react";

export type ThemeId = "ember" | "abyss" | "paper" | "mono" | "valorant";

const STORAGE_KEY = "core-theme";
const THEME_EVENT = "core-theme-change";

interface ThemeMeta {
  id: ThemeId;
  label: string;
  blurb: string;
  /** [canvas, accent] swatches for the chooser */
  swatches: [string, string];
  /** canvas-particle hex (canvas API needs a real color) */
  particle: string;
}

export const THEMES: ThemeMeta[] = [
  {
    id: "ember",
    label: "Ember Craft",
    blurb: "Espresso + terracotta",
    swatches: ["#141110", "#e26d4d"],
    particle: "#e26d4d",
  },
  {
    id: "abyss",
    label: "Abyss Blue",
    blurb: "Deep blue + signal teal",
    swatches: ["#0a0e1a", "#00e5cc"],
    particle: "#00e5cc",
  },
  {
    id: "paper",
    label: "Warm Paper",
    blurb: "Cream + terracotta ink",
    swatches: ["#fafaf9", "#c2410c"],
    particle: "#c2410c",
  },
  {
    id: "mono",
    label: "Mono Pop",
    blurb: "Off-black + electric lime",
    swatches: ["#0e0e0e", "#c8ff2e"],
    particle: "#c8ff2e",
  },
  {
    id: "valorant",
    label: "Valorant Tech",
    blurb: "Gunmetal HUD + tactical red",
    swatches: ["#0f1923", "#ff4655"],
    particle: "#ff4655",
  },
];

export function isThemeId(v: string | null): v is ThemeId {
  return v === "ember" || v === "abyss" || v === "paper" || v === "mono" || v === "valorant";
}

export function getStoredTheme(): ThemeId {
  if (typeof document !== "undefined") {
    const attr = document.documentElement.dataset.theme;
    if (attr && isThemeId(attr)) return attr;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (isThemeId(raw)) return raw;
  } catch {
    /* private mode — fall through to default */
  }
  return "ember";
}

export function applyTheme(id: ThemeId) {
  document.documentElement.dataset.theme = id;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", themeMeta(id).swatches[0]);
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* private mode — theme still applies for the session */
  }
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: id }));
}

/** Reactive current theme id; re-renders on chooser changes. */
export function useTheme(): [ThemeId, (id: ThemeId) => void] {
  const [theme, setTheme] = useState<ThemeId>(getStoredTheme);

  useEffect(() => {
    const onChange = (e: Event) => {
      const id = (e as CustomEvent).detail;
      if (isThemeId(id)) setTheme(id);
    };
    window.addEventListener(THEME_EVENT, onChange);
    return () => window.removeEventListener(THEME_EVENT, onChange);
  }, []);

  return [theme, applyTheme];
}

export function themeMeta(id: ThemeId): ThemeMeta {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}
