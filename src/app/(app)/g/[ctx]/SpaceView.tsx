"use client";

import { ArrowLeftIcon, ChevronDownIcon, SettingsIcon } from "@/components/Icons";
import { BalanceHeadline, BalanceLines } from "@/components/BalanceSummary";
import Link from "next/link";
import { useState } from "react";
import type { ExpenseDTO } from "@/lib/expenses";
import type { SettlementDTO } from "@/lib/settlements";
import type { BalanceLine } from "@/lib/balances";
import { ExpenseFeed } from "./ExpenseFeed";
import { Settlement } from "../../settlement/Settlement";
import { Summary } from "../../summary/Summary";

interface Member {
  key: string;
  displayName: string;
}
interface Opt {
  value: string;
  label: string;
}

export type SpaceTab = "expenses" | "balances" | "summary";

// One screen per group (or Personal) — Splitwise-style hero with the overall
// balance, then Expenses / Balances / Summary as tabs.
export function SpaceView({
  ctx,
  name,
  isPersonal,
  memberCount,
  heroNet,
  heroLines,
  initialTab,
  rows,
  settlements,
  nameMap,
  members,
  categories,
  payerOptions,
  splitOptions,
  selfKey,
}: {
  ctx: string;
  name: string;
  isPersonal: boolean;
  memberCount: number;
  /** All-months net for the signed-in user (groups only). */
  heroNet: number;
  heroLines: BalanceLine[];
  initialTab: SpaceTab;
  rows: ExpenseDTO[];
  settlements: SettlementDTO[];
  nameMap: Record<string, string>;
  members: Member[];
  categories: string[];
  payerOptions: Opt[];
  splitOptions: Opt[];
  selfKey: string;
}) {
  const tabs: { id: SpaceTab; label: string }[] = isPersonal
    ? [
        { id: "expenses", label: "Expenses" },
        { id: "summary", label: "Summary" },
      ]
    : [
        { id: "expenses", label: "Expenses" },
        { id: "balances", label: "Balances" },
        { id: "summary", label: "Summary" },
      ];
  const validInitial = tabs.some((t) => t.id === initialTab) ? initialTab : "expenses";
  const [tab, setTab] = useState<SpaceTab>(validInitial);
  const [linesOpen, setLinesOpen] = useState(true);

  return (
    <div className="space-y-5">
      {/* Hero */}
      <div className="space-y-3">
        {/* One row: back, name, settings. */}
        <div className="flex items-center gap-2">
          <Link href="/" aria-label="Back to home" className="icon-btn -ml-2">
            <ArrowLeftIcon />
          </Link>
          <h1 className="min-w-0 flex-1 truncate text-2xl font-semibold">{name}</h1>
          {!isPersonal ? (
            <Link
              href="/groups"
              aria-label="Group settings"
              title="Group settings"
              className="icon-btn"
            >
              <SettingsIcon />
            </Link>
          ) : null}
        </div>

        {!isPersonal ? (
          <div className="card space-y-2">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 text-left"
              aria-expanded={linesOpen}
              onClick={() => setLinesOpen((v) => !v)}
            >
              <BalanceHeadline net={heroNet} />
              {heroLines.length > 0 ? (
                <ChevronDownIcon
                  className={`h-4 w-4 text-muted transition-transform ${
                    linesOpen ? "rotate-180" : ""
                  }`}
                />
              ) : null}
            </button>
            {linesOpen ? <BalanceLines lines={heroLines} /> : null}
          </div>
        ) : null}

        <div>
          <Link
            href={`/add?ctx=${encodeURIComponent(ctx)}`}
            className="btn-primary px-3 py-1.5 text-sm"
          >
            + Add expense
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/10" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`-mb-px border-b-2 px-4 py-2 text-sm transition ${
              tab === t.id
                ? "border-primary font-semibold text-ink"
                : "border-transparent text-muted hover:text-ink"
            }`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "expenses" ? (
        <ExpenseFeed
          ctx={ctx}
          rows={rows}
          nameMap={nameMap}
          categories={categories}
          payerOptions={payerOptions}
          splitOptions={splitOptions}
          isPersonal={isPersonal}
          selfKey={selfKey}
          memberCount={memberCount}
        />
      ) : null}

      {tab === "balances" && !isPersonal ? (
        <Settlement
          ctx={ctx}
          rows={rows}
          settlements={settlements}
          isPersonal={isPersonal}
          nameMap={nameMap}
          members={members}
          payerOptions={payerOptions}
        />
      ) : null}

      {tab === "summary" ? (
        <Summary
          rows={rows}
          isPersonal={isPersonal}
          nameMap={nameMap}
          members={members}
        />
      ) : null}
    </div>
  );
}
