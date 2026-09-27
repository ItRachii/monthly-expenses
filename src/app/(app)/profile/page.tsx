import { requireUser } from "@/lib/session";
import { doSignOut } from "@/lib/actions/auth";
import { ProfileForm } from "./ProfileForm";
import { ownEmail } from "@/lib/users";

export default async function ProfilePage() {
  const user = await requireUser();

  if (!user.appUser) {
    return (
      <div className="alert-error">
        User profile not found. Please try signing in again.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1>My Profile</h1>
      <ProfileForm
        email={ownEmail(user.appUser) ?? "Sign in again to show your email"}
        firstName={user.appUser.firstName}
        lastName={user.appUser.lastName}
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
