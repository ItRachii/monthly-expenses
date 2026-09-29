// Light and dark themes. The choice is per device (localStorage), applied as
// <html data-theme="light|dark"> before first paint by THEME_SCRIPT, so the
// page never flashes the other theme. "system" follows the device setting.

export type ThemeChoice = "system" | "light" | "dark";
export type Theme = "light" | "dark";

export const THEME_KEY = "ledger.theme";
/** The app was dark-only: stay dark until someone picks otherwise. */
export const DEFAULT_THEME: ThemeChoice = "dark";

/** The page background of each theme, for the browser and status bar colour. */
export const THEME_BACKGROUND: Record<Theme, string> = {
  dark: "#0E1117",
  light: "#F3F5F8",
};

/**
 * Inline, render-blocking script for <head>: reads the stored choice and sets
 * data-theme and the theme-color meta before anything paints. Kept tiny and
 * dependency-free; storage may be blocked, in which case the default holds.
 */
export const THEME_SCRIPT = `(function(){try{var c=localStorage.getItem(${JSON.stringify(THEME_KEY)})||${JSON.stringify(DEFAULT_THEME)};var t=c==="system"?(matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"):c;if(t!=="light"&&t!=="dark")t="dark";document.documentElement.dataset.theme=t;var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",t==="light"?${JSON.stringify(THEME_BACKGROUND.light)}:${JSON.stringify(THEME_BACKGROUND.dark)});}catch(e){}})();`;

export function readThemeChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" || v === "system" ? v : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function resolveTheme(choice: ThemeChoice): Theme {
  if (choice !== "system") return choice;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/** Applies a theme to the page now: the attribute and the browser colour. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_BACKGROUND[theme]);
}

export function saveThemeChoice(choice: ThemeChoice): void {
  try {
    localStorage.setItem(THEME_KEY, choice);
  } catch {
    // Not remembered on this device; still applied for this visit.
  }
}
