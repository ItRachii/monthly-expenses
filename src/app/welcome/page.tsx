import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { getIncomeHistory } from "@/lib/income";
import { incomePromptFor } from "@/lib/incomeMath";
import { WelcomeForm } from "./WelcomeForm";

export const metadata: Metadata = { title: "Welcome - Ledger" };
export const dynamic = "force-dynamic";

// New-user onboarding, outside the app shell: confirm the name from Google
// and set the monthly income. The app layout sends new users here until done.
export default async function WelcomePage() {
  const user = await requireUser();
  const history = await getIncomeHistory(user.email);
  if (!user.appUser || incomePromptFor(user.appUser, history.length > 0, new Date()) !== "onboarding")
    redirect("/");

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <WelcomeForm firstName={user.appUser.firstName} lastName={user.appUser.lastName ?? ""} />
    </div>
  );
}
