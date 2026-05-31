import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { registerUserIfNeeded } from "@/lib/users";

export interface CurrentUser {
  email: string;
  name: string;
  image: string | null;
  appUser: Awaited<ReturnType<typeof registerUserIfNeeded>>;
}

/**
 * Guard for authenticated pages. Redirects to /login if not signed in.
 * Wrapped in React `cache()` so multiple calls in one render (e.g. the layout
 * and the page) reuse a single auth + user lookup instead of hitting the DB twice.
 */
export const requireUser = cache(async (): Promise<CurrentUser> => {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");
  const email = session.user.email;
  const name = session.user.name ?? "User";
  const appUser = await registerUserIfNeeded(email, name);
  return { email, name, image: session.user.image ?? null, appUser };
});
