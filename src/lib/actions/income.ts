"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getIncomeHistory, setIncomePrompt, setMonthlyIncome } from "@/lib/income";
import { updateName } from "@/lib/users";
import { monthKey } from "@/lib/format";
import { cleanText, isValidMonth, parseMoney } from "@/lib/validate";

type Result = { ok: boolean; error?: string };

const INCOME_ERROR = "Enter your monthly income as an amount like 50000 or 50000.50.";

/** Validates "apply from" for an income change: this month or earlier. */
function checkFromMonth(fromMonth: unknown): string | { error: string } {
  const current = monthKey(new Date());
  if (fromMonth === undefined || fromMonth === null || fromMonth === "") return current;
  if (typeof fromMonth !== "string" || !isValidMonth(fromMonth))
    return { error: "Pick the month the income applies from." };
  if (fromMonth > current) return { error: "Income can't start in a future month." };
  return fromMonth;
}

/**
 * Saves the monthly income from the popup or the Personal page. A first
 * income needs no month (it also covers earlier months); a change applies
 * from `fromMonth`.
 */
export async function saveIncomeAction(amount: string, fromMonth?: string): Promise<Result> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false, error: "Not signed in." };
  const income = parseMoney(amount);
  if (income === null) return { ok: false, error: INCOME_ERROR };
  const from = checkFromMonth(fromMonth);
  if (typeof from !== "string") return { ok: false, error: from.error };
  await setMonthlyIncome(email, income, from);
  revalidatePath("/", "layout");
  return { ok: true };
}

/** "Remind me later" (popup returns on next sign-in) or "Skip" (never pops up again). */
export async function dismissIncomePromptAction(choice: "later" | "skipped"): Promise<Result> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false, error: "Not signed in." };
  if (choice !== "later" && choice !== "skipped") return { ok: false, error: "Unknown choice." };
  await setIncomePrompt(email, choice);
  revalidatePath("/", "layout");
  return { ok: true };
}

/** New-user onboarding: confirm the name and set the (required) income. */
export async function completeOnboardingAction(
  firstName: string,
  lastName: string,
  amount: string,
): Promise<Result> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false, error: "Not signed in." };
  const first = cleanText(typeof firstName === "string" ? firstName : "", 40);
  if (!first) return { ok: false, error: "Please enter a first name." };
  const income = parseMoney(amount);
  if (income === null) return { ok: false, error: INCOME_ERROR };
  await updateName(email, first, cleanText(typeof lastName === "string" ? lastName : "", 40) || null);
  if ((await getIncomeHistory(email)).length === 0) await setMonthlyIncome(email, income);
  revalidatePath("/", "layout");
  return { ok: true };
}
