import { requireUser } from "@/lib/session";
import { doSignOut } from "@/lib/actions/auth";
import { ProfileForm } from "./ProfileForm";

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
      <h1>User Profile</h1>
      <p className="text-muted">Customize your display name across the application.</p>
      <ProfileForm
        email={user.appUser.email}
        firstName={user.appUser.firstName}
        username={user.appUser.username}
      />

      <form action={doSignOut} className="border-t border-white/10 pt-4">
        <button type="submit" className="btn-secondary">
          Sign out
        </button>
      </form>
    </div>
  );
}
