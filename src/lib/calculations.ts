import { round2 } from "./format";

// Ported from legacy-streamlit/utils/calculations.py

/**
 * Returns [personAOwes, personBOwes] — each person's share of an expense.
 * Reflects financial responsibility, not who physically paid.
 */
export function computeOwes(amount: number, split: string): [number, number] {
  if (split === "50-50") {
    const half = round2(amount / 2);
    return [half, half];
  }
  if (split === "Person A") return [round2(amount), 0];
  if (split === "Person B") return [0, round2(amount)];
  return [0, 0];
}

export interface BalanceRow {
  amount: number;
  split: string;
  payer: string;
}

/**
 * Net balance for a two-person (personal) context.
 *  balance > 0  → Person B owes Person A
 *  balance < 0  → Person A owes Person B
 * The description uses the canonical "Person A"/"Person B" labels; callers
 * substitute display names.
 */
export function computeNetBalance(rows: BalanceRow[]): {
  balance: number;
  description: string;
} {
  if (rows.length === 0) return { balance: 0, description: "No expenses recorded." };

  let totalBOwes = 0;
  let totalBPaid = 0;
  for (const r of rows) {
    totalBOwes += computeOwes(r.amount, r.split)[1];
    if (r.payer === "Person B") totalBPaid += r.amount;
  }

  const balance = round2(totalBOwes - totalBPaid);
  let description: string;
  if (Math.abs(balance) < 0.01) description = "All settled up!";
  else if (balance > 0) description = `Person B owes Person A ₹${balance.toFixed(2)}`;
  else description = `Person A owes Person B ₹${Math.abs(balance).toFixed(2)}`;

  return { balance, description };
}
