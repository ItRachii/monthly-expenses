"use server";

import { signIn, signOut } from "@/auth";

export async function doSignIn() {
  await signIn("google", { redirectTo: "/" });
}

export async function doSignOut() {
  await signOut({ redirectTo: "/login" });
}
