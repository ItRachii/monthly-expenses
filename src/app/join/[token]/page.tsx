import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { previewJoinLink } from "@/lib/joinLinks";
import { JoinButton } from "./JoinButton";

export const metadata: Metadata = { title: "Join a group - Ledger" };
export const dynamic = "force-dynamic";

// Where a shared join link lands, outside the app shell so that someone new
// reaches it straight after signing in (the shell sends new users to
// onboarding first). Joining takes a press: opening the link, or a chat app
// previewing it, changes nothing.
export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await requireUser();
  // A link that cannot be read (table not there yet) is shown as not valid.
  const link = await previewJoinLink(token, user.email).catch(() => null);
  if (link?.isMember) redirect(`/g/${encodeURIComponent(link.groupId)}`);

  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <div className="card w-full max-w-sm space-y-4">
        {link ? (
          <>
            <div className="space-y-1">
              <h1 className="section-title">Join &ldquo;{link.groupName}&rdquo;?</h1>
              <p className="text-sm text-muted">
                {link.sharedBy} shared this link. Members of a group see its expenses and who owes whom.
              </p>
            </div>
            <JoinButton token={token} />
          </>
        ) : (
          <>
            <div className="space-y-1">
              <h1 className="section-title">This link is no longer valid</h1>
              <p className="text-sm text-muted">
                It may have expired, been used up or been revoked. Ask the person who sent it for a new one.
              </p>
            </div>
            <Link href="/" className="btn-secondary">
              Go to home
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
