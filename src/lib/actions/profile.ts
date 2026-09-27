"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { updateName } from "@/lib/users";
import { getIncomeHistory, setMonthlyIncome } from "@/lib/income";
import { incomeForMonth } from "@/lib/incomeMath";
import { monthKey } from "@/lib/format";
import { cleanText, isValidMonth, parseMoney } from "@/lib/validate";

export async function saveProfileAction(
  firstName: string,
  lastName: string,
  monthlyIncome: string,
  /** YYYY-MM the new income applies from; only read when it changed. */
  incomeFrom?: string,
): Promise<{ ok: boolean; message?: string; error?: string }> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false, error: "Not signed in." };

  const first = cleanText(firstName, 40);
  if (!first) return { ok: false, error: "Please enter a first name." };

  // Income may stay blank while it has never been set (the popup is
  // skippable); once set it can be changed but not cleared.
  const current = monthKey(new Date());
  const history = await getIncomeHistory(email);
  const incomeText = typeof monthlyIncome === "string" ? monthlyIncome.trim() : "";
  const income = incomeText ? parseMoney(incomeText) : null;
  if (incomeText && income === null)
    return { ok: false, error: "Monthly income must be an amount like 50000 or 50000.50." };
  if (!incomeText && history.length > 0)
    return { ok: false, error: "Please enter your monthly income." };
  const changed = income !== null && income !== incomeForMonth(history, current);
  let from = current;
  if (changed && history.length > 0 && incomeFrom) {
    if (!isValidMonth(incomeFrom) || incomeFrom > current)
      return { ok: false, error: "Pick this month or an earlier one for the new income." };
    from = incomeFrom;
  }

  await updateName(email, first, cleanText(lastName, 40) || null);
  if (changed) await setMonthlyIncome(email, income, from);
  revalidatePath("/", "layout");
  return { ok: true, message: "Profile updated successfully!" };
}
