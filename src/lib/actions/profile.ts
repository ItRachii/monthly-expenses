"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { updateName } from "@/lib/users";
import { setMonthlyIncome } from "@/lib/income";
import { MAX_AMOUNT, cleanText } from "@/lib/validate";

export async function saveProfileAction(
  firstName: string,
  lastName: string,
  monthlyIncome: string,
): Promise<{ ok: boolean; message?: string; error?: string }> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false, error: "Not signed in." };

  const first = cleanText(firstName, 40);
  if (!first) return { ok: false, error: "Please enter a first name." };
  // Required. Zero is allowed (no income this month), blank is not.
  const incomeText = typeof monthlyIncome === "string" ? monthlyIncome.trim() : "";
  const income = /^\d+(\.\d{0,2})?$/.test(incomeText) ? Number(incomeText) : NaN;
  if (!incomeText) return { ok: false, error: "Please enter your monthly income." };
  if (!Number.isFinite(income) || income < 0 || income > MAX_AMOUNT)
    return { ok: false, error: "Monthly income must be an amount like 50000 or 50000.50." };

  await updateName(email, first, cleanText(lastName, 40) || null);
  await setMonthlyIncome(email, income);
  revalidatePath("/", "layout");
  return { ok: true, message: "Profile updated successfully!" };
}
