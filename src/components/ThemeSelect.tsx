"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { AutoThemeIcon, MoonIcon, SunIcon } from "./Icons";
import { THEME_EVENT } from "./ThemeSync";
import { DEFAULT_THEME, readThemeChoice, saveThemeChoice, type ThemeChoice } from "@/lib/theme";

const OPTIONS: { id: ThemeChoice; label: string; Icon: typeof SunIcon }[] = [
  { id: "system", label: "System", Icon: AutoThemeIcon },
  { id: "light", label: "Light", Icon: SunIcon },
  { id: "dark", label: "Dark", Icon: MoonIcon },
];

/**
 * Light, dark, or follow the device. Saved on this device and applied at
 * once. A radio group: Left and Right move the choice, as native radios do.
 */
export function ThemeSelect() {
  const [choice, setChoice] = useState<ThemeChoice>(DEFAULT_THEME);
  const group = useRef<HTMLDivElement>(null);

  useEffect(() => setChoice(readThemeChoice()), []);

  function pick(next: ThemeChoice) {
    setChoice(next);
    saveThemeChoice(next);
    window.dispatchEvent(new Event(THEME_EVENT));
  }

  function onKeyDown(e: KeyboardEvent) {
    const i = OPTIONS.findIndex((o) => o.id === choice);
    const to = e.key === "ArrowRight" || e.key === "ArrowDown" ? i + 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? i - 1 : null;
    if (to === null) return;
    e.preventDefault();
    const next = OPTIONS[(to + OPTIONS.length) % OPTIONS.length].id;
    pick(next);
    group.current?.querySelector<HTMLElement>(`[data-theme-option="${next}"]`)?.focus();
  }

  return (
    <div
      ref={group}
      role="radiogroup"
      aria-label="Theme"
      onKeyDown={onKeyDown}
      className="inline-flex rounded-xl border border-ink/10 bg-background p-1"
    >
      {OPTIONS.map(({ id, label, Icon }) => {
        const on = choice === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            data-theme-option={id}
            onClick={() => pick(id)}
            className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm outline-none transition active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-primary/70 ${
              on ? "bg-surface font-semibold text-ink shadow-sm ring-1 ring-ink/10" : "text-muted hover:text-ink"
            }`}
          >
            <Icon className={`h-4 w-4 ${on ? "text-primary-light" : ""}`} />
            {label}
          </button>
        );
      })}
    </div>
  );
}
