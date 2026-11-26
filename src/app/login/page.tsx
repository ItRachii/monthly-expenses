import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { doSignIn } from "@/lib/actions/auth";
import { Showreel } from "@/components/showreel/Showreel";
import { ClearAppBadge } from "@/components/AppBadge";
import { safeNextPath } from "@/lib/contacts";

export const dynamic = "force-dynamic";

function Logo() {
  return (
    <div className="flex items-center gap-2 text-ink">
      <svg viewBox="0 0 40 40" className="h-8 w-8" fill="none" aria-hidden>
        <circle cx="20" cy="20" r="16" stroke="currentColor" strokeWidth="3" />
        <path d="M4 20a16 16 0 0 0 32 0Z" fill="currentColor" />
      </svg>
      <span className="text-lg font-bold tracking-tight">Ledger</span>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden>
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Sent here while opening a join link: go on to it once signed in.
  const next = safeNextPath((await searchParams).next);
  const session = await auth();
  if (session?.user) redirect(next ?? "/");

  return (
    // The sign-in artwork is drawn for a dark page, so this screen keeps the
    // dark theme whatever the device is set to.
    <main data-theme="dark" className="relative flex min-h-svh items-center justify-center overflow-hidden bg-background p-4 text-ink sm:p-6">
      <ClearAppBadge />
      {/* Ambient gradient glows behind the card. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-40 -top-40 h-96 w-96 rounded-full bg-primary/25 blur-3xl" />
        <div className="absolute -right-40 bottom-0 h-96 w-96 rounded-full bg-emerald-500/15 blur-3xl" />
      </div>

      <div className="relative grid w-full max-w-5xl overflow-hidden rounded-3xl border border-white/10 bg-surface shadow-2xl md:h-[600px] md:grid-cols-2">
        {/* LEFT — sign in */}
        <section className="flex flex-col justify-center gap-8 px-8 py-14 sm:px-12">
          <Logo />

          <div className="space-y-2">
            <h1 className="text-3xl font-bold text-ink">Welcome Back!</h1>
            <p className="text-sm text-muted">
              {next
                ? "Sign in with Google to join the group you were invited to."
                : "Sign in with Google to continue to your dashboard."}
            </p>
          </div>

          <form action={doSignIn.bind(null, next)}>
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-3 rounded-xl border border-white/15 bg-white px-4 py-3.5 text-sm font-semibold text-gray-800 shadow-sm transition hover:bg-white/90"
            >
              <GoogleIcon />
              Log in with Google
            </button>
          </form>

          <p className="text-xs text-muted">
            New here? Signing in with Google creates your account
            automatically.
          </p>
        </section>

        {/* RIGHT: the showreel, hidden on phones like the panel it replaces. */}
        <div className="relative hidden md:block">
          <Showreel />
        </div>
      </div>
    </main>
  );
}
