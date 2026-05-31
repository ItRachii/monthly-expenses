import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

// Auth.js v5 reads AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET / AUTH_SECRET from env.
// JWT session strategy means no database adapter or extra auth tables are
// needed — the app's own app_users row is created lazily on first sign-in.
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  session: { strategy: "jwt" },
  trustHost: true,
  pages: {
    signIn: "/login",
  },
});
