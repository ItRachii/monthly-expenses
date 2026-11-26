"use server";

import { signIn, signOut } from "@/auth";
import { safeNextPath } from "@/lib/contacts";

/** `next`: the join link the person was opening when asked to sign in. */
export async function doSignIn(next: string | null) {
  await signIn("google", { redirectTo: safeNextPath(next) ?? "/" });
}

export async function doSignOut() {
  await signOut({ redirectTo: "/login" });
}
