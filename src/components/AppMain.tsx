"use client";

import type { ReactNode } from "react";
import { useSidebar } from "./SidebarContext";

// When the sidebar collapses to the rail, drop the reading-width cap so the
// page fills the freed horizontal space instead of leaving empty margin.
export function AppMain({ children }: { children: ReactNode }) {
  const { collapsed } = useSidebar();
  return (
    <main className="flex-1 overflow-x-hidden p-5 pb-[calc(5rem+env(safe-area-inset-bottom))] md:p-8 md:pb-8">
      <div
        className={`space-y-6 ${collapsed ? "max-w-none" : "mx-auto max-w-5xl"}`}
      >
        {children}
      </div>
    </main>
  );
}
