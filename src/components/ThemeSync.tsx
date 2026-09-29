"use client";

import { useEffect } from "react";
import { THEME_KEY, applyTheme, readThemeChoice, resolveTheme } from "@/lib/theme";

/** Fired on window when the choice changes in this tab (ThemeSelect). */
export const THEME_EVENT = "ledger:theme";

/**
 * Keeps the page on the chosen theme after the first paint: follows the
 * device when the choice is "system" and it switches between light and
 * dark, picks up a choice made in another tab, and sets the browser colour
 * (the head script can run before Next adds the theme-color meta).
 */
export function ThemeSync() {
  useEffect(() => {
    const sync = () => applyTheme(resolveTheme(readThemeChoice()));
    sync();
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_KEY) sync();
    };
    mq.addEventListener("change", sync);
    window.addEventListener("storage", onStorage);
    window.addEventListener(THEME_EVENT, sync);
    return () => {
      mq.removeEventListener("change", sync);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(THEME_EVENT, sync);
    };
  }, []);
  return null;
}
