"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  contactStatusAction,
  createJoinLinkAction,
  inviteAction,
  listGoogleContactsAction,
} from "@/lib/actions/groups";
import { ArrowLeftIcon, GroupAddIcon, MailIcon, PeopleIcon, SearchIcon } from "@/components/Icons";
import { PeopleProvider, PersonAvatar } from "@/components/Person";
import {
  JOIN_LINK_DAYS,
  JOIN_LINK_MAX_USES,
  filterRows,
  parsePicked,
  rowAction,
  shareText,
  type ContactRow,
  type ContactStatus,
} from "@/lib/contacts";

// Adding people to a group: by typed address, from Google Contacts, from the
// phone's contact picker (where the browser has one), or with a join link
// posted to a chat. Someone who already has an account joins at once; anyone
// else gets an invite by email.

type Message = { level: "success" | "warning" | "error"; text: string };
type Source = "google" | "phone";

/** Rows drawn at once: a long address book is narrowed by searching. */
const SHOWN = 100;

interface ContactsManager {
  select(props: string[], opts: { multiple: boolean }): Promise<unknown>;
}

function phonePicker(): ContactsManager | null {
  const c = (navigator as Navigator & { contacts?: Partial<ContactsManager> }).contacts;
  return c && typeof c.select === "function" ? (c as ContactsManager) : null;
}

const ALERT = { success: "alert-success", warning: "alert-warning", error: "alert-error" } as const;

export function AddPeople({
  groupId,
  groupName,
  initial,
  onPickingChange,
}: {
  groupId: string;
  groupName: string;
  /** Back from Google: open its contacts, or say they were not shared. */
  initial: "google" | "denied" | null;
  /** The contact list takes over the sheet while it is open. */
  onPickingChange: (picking: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<Message | null>(
    initial === "denied"
      ? { level: "warning", text: "Google Contacts was not shared. You can still add people by email or with a link." }
      : null,
  );
  const [value, setValue] = useState("");
  const [list, setList] = useState<{ source: Source; rows: ContactRow[] } | null>(null);
  const [statuses, setStatuses] = useState<Record<string, ContactStatus>>({});
  const [query, setQuery] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Known only in the browser, and after hydration.
  const [hasPhonePicker, setHasPhonePicker] = useState(false);
  const [canShare, setCanShare] = useState(false);

  useEffect(() => {
    setHasPhonePicker(phonePicker() !== null);
    setCanShare(typeof navigator.share === "function");
  }, []);

  function show(source: Source, rows: ContactRow[], found: Record<string, ContactStatus>) {
    setStatuses(found);
    setQuery("");
    setList({ source, rows });
    onPickingChange(true);
  }

  function closeList() {
    setList(null);
    onPickingChange(false);
  }

  /** `mayAsk`: go to Google's permission screen when it has not been given. */
  function openGoogle(mayAsk: boolean) {
    setMessage(null);
    startTransition(async () => {
      const res = await listGoogleContactsAction(groupId);
      if (res.ok) return show("google", res.rows, res.statuses);
      if (res.needsConsent && mayAsk) {
        window.location.assign(`/api/contacts/google/start?group=${encodeURIComponent(groupId)}`);
        return;
      }
      setMessage({ level: "error", text: "Google Contacts could not be read. Please try again." });
    });
  }

  // Back from Google's permission screen: open the list it was asked for.
  // Never sends the member to Google again from here, so a failure cannot loop.
  const opened = useRef(false);
  useEffect(() => {
    if (initial !== "google" || opened.current) return;
    opened.current = true;
    openGoogle(false);
    // Runs once, for the value the sheet opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openPhone() {
    const picker = phonePicker();
    if (!picker) return;
    setMessage(null);
    let picked: unknown;
    try {
      // Names and addresses only; phone numbers are never asked for.
      picked = await picker.select(["name", "email"], { multiple: true });
    } catch {
      return; // Closed without choosing, or not allowed here.
    }
    const rows = parsePicked(picked);
    if (rows.length === 0) return;
    const emails = rows.flatMap((r) => r.email ?? []);
    startTransition(async () => {
      const res = emails.length ? await contactStatusAction(groupId, emails) : { ok: true as const, statuses: [] };
      if (!res.ok) return setMessage({ level: "error", text: "Those contacts could not be checked. Please try again." });
      show("phone", rows, Object.fromEntries(emails.map((e, i) => [e, res.statuses[i]])));
    });
  }

  function add(email: string, rowId: string | null) {
    setMessage(null);
    setBusy(rowId);
    startTransition(async () => {
      const res = await inviteAction(groupId, email);
      setBusy(null);
      setMessage({ level: res.level, text: res.message });
      if (res.result)
        setStatuses((s) => ({ ...s, [email]: res.result === "added" || res.result === "already_member" ? "member" : "invited" }));
      if (res.ok && res.level === "success" && rowId === null) setValue("");
      router.refresh();
    });
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(shareText(groupName, url));
      setMessage({ level: "success", text: "Link copied. Paste it in a chat." });
    } catch {
      setMessage({ level: "warning", text: "Could not copy. Select the link and copy it by hand." });
    }
  }

  /** True when the share sheet opened (or was closed by the member). */
  async function share(url: string): Promise<boolean> {
    if (typeof navigator.share !== "function") return false;
    try {
      await navigator.share({ text: shareText(groupName, url) });
      return true;
    } catch (e) {
      return e instanceof DOMException && e.name === "AbortError";
    }
  }

  /** Shares the group's join link, making it on first use. */
  async function shareLink(rowId: string | null) {
    setMessage(null);
    if (link) {
      if (!(await share(link))) await copy(link);
      return;
    }
    setBusy(rowId ?? "link");
    const res = await createJoinLinkAction(groupId);
    setBusy(null);
    if (!res.ok) return setMessage({ level: "error", text: res.error });
    const url = window.location.origin + res.path;
    setLink(url);
    router.refresh();
    // Some browsers only open the share sheet straight from a press; when
    // this one refuses after the wait, the link is shown with its own buttons.
    if (!(await share(url))) setMessage({ level: "success", text: "Link ready. Share or copy it below." });
  }

  const linkBox = link ? (
    <div className="space-y-2 rounded-lg border border-ink/10 bg-ink/5 p-3">
      <input
        className="input text-xs"
        readOnly
        value={link}
        aria-label="Join link"
        onFocus={(e) => e.currentTarget.select()}
      />
      <div className="flex flex-wrap gap-2">
        {canShare ? (
          <button type="button" className="btn-primary px-3 py-1.5 text-sm" onClick={() => shareLink(null)}>
            Share
          </button>
        ) : null}
        <button type="button" className="btn-secondary px-3 py-1.5 text-sm" onClick={() => copy(link)}>
          Copy
        </button>
      </div>
      <p className="text-xs text-muted">
        Anyone who opens this link can join the group and see its expenses. It stops working after{" "}
        {JOIN_LINK_DAYS} days or {JOIN_LINK_MAX_USES} joins, and an admin can revoke it sooner.
      </p>
    </div>
  ) : null;

  const alert = message ? (
    <div className={ALERT[message.level]} role="status">
      {message.text}
    </div>
  ) : null;

  const matches = useMemo(() => (list ? filterRows(list.rows, query) : []), [list, query]);
  const people = useMemo(
    () => ({
      names: Object.fromEntries((list?.rows ?? []).map((r) => [r.id, r.name])),
      images: Object.fromEntries((list?.rows ?? []).flatMap((r) => (r.photo ? [[r.id, r.photo]] : []))),
    }),
    [list],
  );

  if (list) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-1">
          <button type="button" className="icon-btn -ml-2" aria-label="Back to group settings" onClick={closeList}>
            <ArrowLeftIcon />
          </button>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
            {list.source === "google" ? "Google Contacts" : "Phone contacts"}
          </h3>
        </div>
        {alert}
        {linkBox}
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            className="input pl-9"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or email"
            aria-label="Search contacts"
          />
        </div>
        {matches.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">
            {list.rows.length === 0 ? "No contacts found." : "No contacts match that search."}
          </p>
        ) : (
          <PeopleProvider names={people.names} images={people.images}>
            <ul className="divide-y divide-ink/[0.06]">
              {matches.slice(0, SHOWN).map((r) => {
                const action = rowAction(r.email, r.email ? statuses[r.email] : undefined);
                const rowBusy = pending && busy === r.id;
                return (
                  <li key={r.id} className="flex items-center gap-3 py-2">
                    <PersonAvatar id={r.id} size="md" interactive={false} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-ink">{r.name}</div>
                      <div className="truncate text-xs text-muted">{r.email ?? "No email saved"}</div>
                    </div>
                    {action === "member" || action === "invited" ? (
                      <span className="shrink-0 text-xs text-muted">{action === "member" ? "Member" : "Invited"}</span>
                    ) : action === "share" ? (
                      <button
                        type="button"
                        className="btn-secondary shrink-0 px-3 py-1 text-xs"
                        disabled={busy === r.id}
                        onClick={() => shareLink(r.id)}
                      >
                        Share link
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={`${action === "add" ? "btn-primary" : "btn-secondary"} shrink-0 px-3 py-1 text-xs`}
                        disabled={pending}
                        aria-busy={rowBusy || undefined}
                        onClick={() => add(r.email!, r.id)}
                      >
                        {action === "add" ? "Add" : "Invite"}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            {matches.length > SHOWN ? (
              <p className="text-center text-xs text-muted">
                Showing {SHOWN} of {matches.length}. Search to find someone.
              </p>
            ) : null}
          </PeopleProvider>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">Add people</h3>
      {alert}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="chip-btn" disabled={pending} onClick={() => openGoogle(true)}>
          <PeopleIcon className="h-4 w-4" /> Google Contacts
        </button>
        {hasPhonePicker ? (
          <button type="button" className="chip-btn" disabled={pending} onClick={openPhone}>
            <GroupAddIcon className="h-4 w-4" /> Phone contacts
          </button>
        ) : null}
        <button type="button" className="chip-btn" disabled={busy === "link"} onClick={() => shareLink(null)}>
          <MailIcon className="h-4 w-4" /> Share group link
        </button>
      </div>
      {linkBox}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add(value, null);
        }}
      >
        <input
          className="input"
          type="email"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="friend@email.com"
          aria-label="Email address"
        />
        <button type="submit" className="btn-primary shrink-0" disabled={pending}>
          Add
        </button>
      </form>
      <p className="text-xs text-muted">
        Someone who already has an account joins straight away. Anyone else gets an invite by email.
      </p>
    </div>
  );
}
