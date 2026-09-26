"use client";

import { ArrowLeftIcon, SettingsIcon } from "@/components/Icons";
import Link from "next/link";
import { useState } from "react";
import type { ExpenseDTO } from "@/lib/expenses";
import type { SettlementDTO } from "@/lib/settlements";
import type { BalanceLine } from "@/lib/balances";
import { SETTLE_EPS } from "@/lib/settlementMath";
import { formatINR } from "@/lib/format";
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
        <div className="flex items-center justify-between gap-2">
          <Link
            href="/"
            aria-label="Back to home"
            className="icon-btn"
          >
            <ArrowLeftIcon />
          </Link>
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
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{name}</h1>
          {!isPersonal ? (
            <span className="pill shrink-0">👥 {memberCount} people</span>
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
              <span className="text-sm font-medium">
                {heroNet > SETTLE_EPS ? (
                  <>
                    You are owed{" "}
                    <span className="text-emerald-400">{formatINR(heroNet)}</span>{" "}
                    overall
                  </>
                ) : heroNet < -SETTLE_EPS ? (
                  <>
                    You owe{" "}
                    <span className="text-orange-400">
                      {formatINR(Math.abs(heroNet))}
                    </span>{" "}
                    overall
                  </>
                ) : (
                  "You are settled up in this group"
                )}
              </span>
              {heroLines.length > 0 ? (
                <span
                  aria-hidden
                  className={`inline-block text-muted transition-transform ${
                    linesOpen ? "rotate-180" : ""
                  }`}
                >
                  ▾
                </span>
              ) : null}
            </button>
            {linesOpen && heroLines.length > 0 ? (
              <div className="space-y-0.5 border-l-2 border-white/10 pl-3">
                {heroLines.map((l) => (
                  <p key={`${l.key}-${l.direction}`} className="text-sm text-muted">
                    {l.direction === "owes_you" ? (
                      <>
                        {l.name} owes you{" "}
                        <span className="text-emerald-400">{formatINR(l.amount)}</span>
                      </>
                    ) : (
                      <>
                        You owe {l.name}{" "}
                        <span className="text-orange-400">{formatINR(l.amount)}</span>
                      </>
                    )}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Quick actions */}
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/add?ctx=${encodeURIComponent(ctx)}`}
            className="btn-primary px-3 py-1.5 text-sm"
          >
            + Add expense
          </Link>
          {!isPersonal ? (
            <button
              type="button"
              className="btn-secondary px-3 py-1.5 text-sm"
              onClick={() => setTab("balances")}
            >
              Settle up
            </button>
          ) : null}
          <button
            type="button"
            className="btn-secondary px-3 py-1.5 text-sm"
            onClick={() => setTab("summary")}
          >
            Charts
          </button>
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
          contextSelector={<div aria-hidden />}
        />
      ) : null}

      {tab === "summary" ? (
        <Summary
          rows={rows}
          isPersonal={isPersonal}
          nameMap={nameMap}
          members={members}
          contextSelector={<div aria-hidden />}
        />
      ) : null}
    </div>
  );
}
