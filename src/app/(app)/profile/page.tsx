import { requireUser } from "@/lib/session";
import { doSignOut } from "@/lib/actions/auth";
import { ProfileForm } from "./ProfileForm";
import { ownEmail } from "@/lib/users";
import { getIncomeHistory } from "@/lib/income";
import { monthKey } from "@/lib/format";

export default async function ProfilePage() {
  const user = await requireUser();

  if (!user.appUser) {
    return (
      <div className="alert-error">
        User profile not found. Please try signing in again.
      </div>
    );
  }

  const currentMonth = monthKey(new Date());
  // Only whether an income exists: the amount stays on the server until
  // the user presses the eye button.
  const hasIncome = (await getIncomeHistory(user.email)).length > 0;

  return (
    <div className="space-y-4">
      <h1>My Profile</h1>
      <ProfileForm
        email={ownEmail(user.appUser) ?? "Sign in again to show your email"}
        firstName={user.appUser.firstName}
        lastName={user.appUser.lastName}
        hasIncome={hasIncome}
        currentMonth={currentMonth}
        image={user.image}
      />

      <form action={doSignOut}>
        <button type="submit" className="btn-danger">
          Sign out
        </button>
      </form>
    </div>
  );
}
