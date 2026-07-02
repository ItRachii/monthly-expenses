// Pure settlement math shared by the server action (ids are emails) and the
// client settlement page (ids are masked wire keys). Both sides run the same
// code, so "how much is still owed?" can never disagree between them. Must
// stay free of server-only and client-only imports.

import { SPLIT_EQUAL } from "./constants";

export interface ExpenseLike {
  payer: string;
  split: string;
  amount: number;
}

export interface PaymentLike {
  from: string;
  /** Null on legacy rows recorded before recipients were tracked. */
  to: string | null;
  amount: number;
}

export interface Transfer {
  from: string;
  to: string;
  amount: number;
}

export interface NetBalance {
  id: string;
  paid: number;
  owes: number;
  net: number;
}

/** Amounts within a paisa of zero are treated as settled. */
export const SETTLE_EPS = 0.01;

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Per-member expense balance (paid vs owed) for one month's rows. */
export function computeNets(rows: ExpenseLike[], memberIds: string[]): NetBalance[] {
  const equalPool = rows
    .filter((r) => r.split === SPLIT_EQUAL)
    .reduce((s, r) => s + r.amount, 0);
  const equalShare = memberIds.length ? equalPool / memberIds.length : 0;
  return memberIds.map((id) => {
    const paid = rows
      .filter((r) => r.payer === id)
      .reduce((s, r) => s + r.amount, 0);
    const owes =
      rows.filter((r) => r.split === id).reduce((s, r) => s + r.amount, 0) +
      equalShare;
    return { id, paid: round2(paid), owes: round2(owes), net: round2(paid - owes) };
  });
}

/** Reduce per-member net balances to a minimal set of "X owes Y" transfers. */
export function simplifyDebts(nets: { id: string; net: number }[]): Transfer[] {
  const creditors = nets
    .filter((b) => b.net > SETTLE_EPS)
    .map((b) => ({ id: b.id, amount: b.net }))
    .sort((a, b) => b.amount - a.amount);
  const debtors = nets
    .filter((b) => b.net < -SETTLE_EPS)
    .map((b) => ({ id: b.id, amount: -b.net }))
    .sort((a, b) => b.amount - a.amount);

  const transfers: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amount, creditors[j].amount);
    transfers.push({ from: debtors[i].id, to: creditors[j].id, amount: round2(pay) });
    debtors[i].amount -= pay;
    creditors[j].amount -= pay;
    if (debtors[i].amount <= SETTLE_EPS) i++;
    if (creditors[j].amount <= SETTLE_EPS) j++;
  }
  return transfers;
}

/**
 * Subtracts recorded payments from the expense-derived transfers and returns
 * what is still outstanding. A payment with a recipient reduces that exact
 * pair. A legacy payment without one is applied greedily to the payer's
 * debts, largest first, so months settled under the old system stay settled.
 */
export function applyPayments(transfers: Transfer[], payments: PaymentLike[]): Transfer[] {
  const remaining = transfers.map((t) => ({ ...t }));
  for (const p of payments) {
    if (!(p.amount > 0)) continue;
    if (p.to) {
      const t = remaining.find((x) => x.from === p.from && x.to === p.to);
      if (t) t.amount = round2(Math.max(0, t.amount - p.amount));
    } else {
      let left = p.amount;
      const mine = remaining
        .filter((x) => x.from === p.from)
        .sort((a, b) => b.amount - a.amount);
      for (const t of mine) {
        if (left <= SETTLE_EPS) break;
        const cut = Math.min(t.amount, left);
        t.amount = round2(t.amount - cut);
        left = round2(left - cut);
      }
    }
  }
  return remaining.filter((t) => t.amount > SETTLE_EPS);
}

/** Outstanding amount from one member to another. */
export function pairAmount(transfers: Transfer[], from: string, to: string): number {
  return round2(
    transfers
      .filter((t) => t.from === from && t.to === to)
      .reduce((s, t) => s + t.amount, 0),
  );
}

/** Sum across all transfers. */
export function totalOutstanding(transfers: Transfer[]): number {
  return round2(transfers.reduce((s, t) => s + t.amount, 0));
}

function totalFrom(transfers: Transfer[], from: string): number {
  return round2(
    transfers.filter((t) => t.from === from).reduce((s, t) => s + t.amount, 0),
  );
}

export interface LineageEntry {
  /** What the payer owed (this pair; payer's total for legacy rows). */
  owed: number;
  /** Cumulative amount recovered up to and including this payment. */
  paidToDate: number;
  /** Still outstanding after this payment. */
  remaining: number;
}

/**
 * For each payment (chronological order), where it sits in the debt's
 * lifetime: what was owed, how much had been recovered including it, and what
 * remained after. Powers the lineage column in settlement history.
 */
export function paymentLineage(
  expenseTransfers: Transfer[],
  payments: PaymentLike[],
): LineageEntry[] {
  return payments.map((p, i) => {
    const after = applyPayments(expenseTransfers, payments.slice(0, i + 1));
    const owed = p.to
      ? pairAmount(expenseTransfers, p.from, p.to)
      : totalFrom(expenseTransfers, p.from);
    const remaining = p.to ? pairAmount(after, p.from, p.to) : totalFrom(after, p.from);
    return { owed, paidToDate: round2(owed - remaining), remaining };
  });
}
