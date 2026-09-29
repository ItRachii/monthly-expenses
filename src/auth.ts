import NextAuth from "next-auth";
import { authConfig } from "./auth.config";
import { upsertUserOnSignIn } from "@/lib/users";
import { ensurePiiMigrated } from "@/lib/piiMigration";

const nextAuth = NextAuth({
  ...authConfig,
  events: {
    // The only moment the app sees the address: store it encrypted on the
    // user's row, keyed by user id.
    async signIn({ user }) {
      if (user.email) await upsertUserOnSignIn(user.email, user.name ?? "User", user.image ?? null);
    },
  },
});

export const { handlers, signIn, signOut } = nextAuth;

/**
 * The signed-in session for server code. `session.user.email` is the user id,
 * not the address. Waits for the one-time email migration, so no request ever
 * mixes ids with raw addresses.
 */
export async function auth() {
  await ensurePiiMigrated();
  return nextAuth.auth();
}
