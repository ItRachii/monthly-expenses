"use client";

import { ArrowLeftIcon, ChevronDownIcon, SettingsIcon } from "@/components/Icons";
import { BalanceHeadline, BalanceLines } from "@/components/BalanceSummary";
import { AddExpenseButton } from "@/components/AddExpense";
import { useLiveRefresh } from "@/lib/useLiveRefresh";
import Link from "next/link";
import { useState } from "react";
import type { ExpenseDTO } from "@/lib/expenses";
import type { SettlementDTO } from "@/lib/settlements";
import type { BalanceLine } from "@/lib/balances";
import type { GroupView } from "@/lib/groupView";
import { GroupSettingsOverlay } from "@/components/GroupSettings";
import { Tabs } from "@/components/Tabs";
import { FinanceCard, financeFor, type FinanceData } from "@/components/PersonalFinance";
import { ExpenseFeed } from "./ExpenseFeed";
import { Settlement } from "../../settlement/Settlement";
import { Summary } from "../../summary/Summary";
import { PeopleProvider } from "@/components/Person";
import type { CardView } from "@/lib/cards";
import type { LoanView } from "@/lib/loans";
import type { NotificationFocus } from "@/lib/notifications";
import { CardStatements } from "./CardStatements";

interface Member {
  key: string;
  displayName: string;
}
interface Opt {
  value: string;
  label: string;
}

export type SpaceTab = "expenses" | "statements" | "balances" | "summary";

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
  focus,
  rows,
  settlements,
  nameMap,
  imageMap,
  members,
  categories,
  payerOptions,
  splitOptions,
  selfKey,
  settings,
  finance,
  cards,
  loans,
}: {
  ctx: string;
  name: string;
  isPersonal: boolean;
  memberCount: number;
  /** All-months net for the signed-in user (groups only). */
  heroNet: number;
  heroLines: BalanceLine[];
  initialTab: SpaceTab;
  /** Opened from a notification: the record to land on. */
  focus: NotificationFocus | null;
  rows: ExpenseDTO[];
  settlements: SettlementDTO[];
  nameMap: Record<string, string>;
  /** Member key -> Google photo URL. */
  imageMap: Record<string, string>;
  members: Member[];
  categories: string[];
  payerOptions: Opt[];
  splitOptions: Opt[];
  selfKey: string;
  /** Group settings for the gear overlay; null for Personal. */
  settings: GroupView | null;
  /** Income and group shares for savings; Personal only. */
  finance: FinanceData | null;
  /** Saved card statements; Personal only, null when the feature is off. */
  cards: CardView[] | null;
  /** EMIs on record; Personal only. */
  loans: LoanView[];
}) {
  const tabs: { id: SpaceTab; label: string }[] = isPersonal
    ? [
        { id: "expenses", label: "Expenses" },
        ...(cards ? [{ id: "statements" as const, label: "Statements" }] : []),
        { id: "summary", label: "Summary" },
      ]
    : [
        { id: "expenses", label: "Expenses" },
        { id: "balances", label: "Balances" },
        { id: "summary", label: "Summary" },
      ];
  const validInitial = tabs.some((t) => t.id === initialTab) ? initialTab : "expenses";
  const [tab, setTab] = useState<SpaceTab>(validInitial);
  // Picks up expenses and settlements added elsewhere (other members, other
  // tabs) without reloading the page.
  useLiveRefresh(ctx);
  const [linesOpen, setLinesOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <PeopleProvider names={nameMap} images={imageMap}>
      <div className="space-y-5">
        {/* Hero */}
        <div className="space-y-3">
          {/* One row: back, name, settings. */}
          <div className="flex items-center gap-2">
            <Link href="/" aria-label="Back to home" className="icon-btn -ml-2">
              <ArrowLeftIcon />
            </Link>
            <h1 className="min-w-0 flex-1 truncate text-2xl font-semibold">{name}</h1>
            {settings ? (
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                aria-label="Group settings"
                title="Group settings"
                aria-haspopup="dialog"
                className="icon-btn"
              >
                <SettingsIcon />
              </button>
            ) : null}
          </div>

          {!isPersonal ? (
            <div className="card space-y-2">
              <button
                type="button"
                className="-my-2 flex min-h-11 w-full items-center justify-between gap-2 py-2 text-left"
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

          {finance ? <FinanceCard f={financeFor(finance, rows, finance.currentMonth)} incomeSet={finance.incomeSet} /> : null}

          <div>
            <AddExpenseButton ctx={ctx} lock className="btn-primary px-3 py-1.5 text-sm">
              + Add expense
            </AddExpenseButton>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-ink/10">
          <Tabs label={isPersonal ? "Personal expenses" : "Group"} tabs={tabs} value={tab} onChange={setTab} />
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
            focus={focus}
          />
        ) : null}

        {tab === "statements" && cards ? <CardStatements cards={cards} loans={loans} /> : null}

        {tab === "balances" && !isPersonal ? (
          <Settlement
            ctx={ctx}
            rows={rows}
            settlements={settlements}
            isPersonal={isPersonal}
            nameMap={nameMap}
            members={members}
            payerOptions={payerOptions}
            focus={focus}
          />
        ) : null}

        {tab === "summary" ? (
          <Summary
            rows={rows}
            finance={finance}
            isPersonal={isPersonal}
            members={members}
          />
        ) : null}

        {settings && settingsOpen ? (
          <GroupSettingsOverlay group={settings} onClose={() => setSettingsOpen(false)} />
        ) : null}
      </div>
    </PeopleProvider>
  );
}
