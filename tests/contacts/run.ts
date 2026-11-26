// Checks for adding people from contacts (no network, no database).
// Run with `npm run test:contacts`.
// - contact lists from Google and the phone picker become clean rows;
// - what each row offers, and where sign-in may send someone;
// - a join link's state over time;
// - the Google token cookie, and the calls made to Google.
import {
  MAX_CONTACTS,
  filterRows,
  isGroupIdShape,
  isJoinToken,
  joinLinkState,
  parsePeople,
  parsePicked,
  rowAction,
  safeNextPath,
  shareText,
} from "../../src/lib/contacts";
import {
  CONTACTS_SCOPE,
  consentUrl,
  exchangeCode,
  fetchGoogleContacts,
  newFlow,
  openToken,
  sealToken,
} from "../../src/lib/googleContacts";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " | " + detail : ""}`);
  if (!ok) failures++;
};

async function main() {
  // Google People API connections.
  const people = parsePeople([
    {
      names: [{ displayName: "Zoya Khan" }],
      emailAddresses: [{ value: " Zoya@Example.com " }, { value: "zk@work.example" }],
      photos: [{ url: "https://lh3.googleusercontent.com/a/abc", default: false }],
    },
    { names: [{ displayName: "Asha Rao" }], emailAddresses: [{ value: "asha@example.com" }], photos: [{ url: "https://lh3.googleusercontent.com/default", default: true }] },
    { names: [{ displayName: "Only Phone" }] },
    { names: [{ displayName: "Only Phone" }] },
    { emailAddresses: [{ value: "noname@example.com" }] },
    { names: [{ displayName: "Dup" }], emailAddresses: [{ value: "ASHA@example.com" }] },
    { names: [{ displayName: "Bad" }], emailAddresses: [{ value: "not-an-email" }], photos: [{ url: "https://evil.example/x.png" }] },
    {},
    "junk",
  ]);
  const emails = people.map((r) => r.email);
  check("one row per address", emails.filter((e) => e === "zoya@example.com").length === 1 && emails.includes("zk@work.example"));
  check("addresses lowercased and trimmed", emails.includes("zoya@example.com"));
  check("same address listed once", emails.filter((e) => e === "asha@example.com").length === 1);
  check("no-address people listed once by name", people.filter((r) => r.name === "Only Phone" && r.email === null).length === 1);
  check("bad address counts as none", people.some((r) => r.name === "Bad" && r.email === null));
  check("nameless row shows its address", people.some((r) => r.name === "noname@example.com"));
  check("empty people dropped", people.length === 6, String(people.length));
  check("sorted by name", people.map((r) => r.name).join("|") === [...people.map((r) => r.name)].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })).join("|"));
  check("google photo kept", people.find((r) => r.email === "zoya@example.com")?.photo === "https://lh3.googleusercontent.com/a/abc");
  check("default photo dropped", people.find((r) => r.email === "asha@example.com")?.photo === null);
  check("off-site photo dropped", people.find((r) => r.name === "Bad")?.photo === null);
  check("ids unique", new Set(people.map((r) => r.id)).size === people.length);
  check("junk input gives nothing", parsePeople(null).length === 0 && parsePeople("x").length === 0);
  const many = parsePeople(Array.from({ length: MAX_CONTACTS + 50 }, (_, i) => ({ emailAddresses: [{ value: `p${i}@example.com` }] })));
  check("list capped", many.length === MAX_CONTACTS);
  check("control characters stripped from names", parsePeople([{ names: [{ displayName: "A\u0000B\nC" }], emailAddresses: [{ value: "a@example.com" }] }])[0].name === "A B C");

  // Phone contact picker.
  const picked = parsePicked([
    { name: ["Ravi Kumar"], email: ["Ravi@Example.com"] },
    { name: ["Meera"], email: [] },
    { name: [], email: [] },
    { name: ["Two"], email: ["one@example.com", "two@example.com"] },
  ]);
  check("picker rows", picked.length === 4 && picked.some((r) => r.email === "ravi@example.com") && picked.some((r) => r.name === "Meera" && r.email === null));
  check("picker junk gives nothing", parsePicked(undefined).length === 0);

  check("search by name", filterRows(picked, "rav").length === 1);
  check("search by address", filterRows(picked, "TWO@").length === 1);
  check("empty search keeps all", filterRows(picked, "  ").length === picked.length);

  // What a row offers.
  check("registered: add", rowAction("a@example.com", "registered") === "add");
  check("new: invite", rowAction("a@example.com", "new") === "invite");
  check("unknown standing: invite", rowAction("a@example.com", undefined) === "invite");
  check("member: nothing", rowAction("a@example.com", "member") === "member");
  check("invited: nothing", rowAction("a@example.com", "invited") === "invited");
  check("no address: share link", rowAction(null, undefined) === "share");

  // Where sign-in may go, and tokens.
  const token = "A".repeat(43);
  check("token shape", isJoinToken(token) && !isJoinToken("short") && !isJoinToken(token + "/") && !isJoinToken(null));
  check("join path allowed", safeNextPath(`/join/${token}`) === `/join/${token}`);
  check("other pages refused", safeNextPath("/profile") === null && safeNextPath("/") === null);
  check("other sites refused", safeNextPath("https://evil.example/join/" + token) === null && safeNextPath("//evil.example") === null);
  check("extra path refused", safeNextPath(`/join/${token}/../../profile`) === null && safeNextPath(`/join/${token}?x=1`) === null);
  check("non-strings refused", safeNextPath(["/join/" + token]) === null && safeNextPath(undefined) === null);
  check("group id shape", isGroupIdShape("0b8f6c1e-2a4d-4c8e-9f1a-123456789abc") && !isGroupIdShape("a/b") && !isGroupIdShape("") && !isGroupIdShape("x?y=1"));
  check("share text", shareText("Goa\n trip", "https://app.example/join/x") === 'Join "Goa trip" on Ledger to split expenses with us: https://app.example/join/x');

  // A join link over time.
  const now = new Date("2026-11-26T10:00:00Z");
  const link = { expiresAt: new Date("2026-12-03T10:00:00Z"), revokedAt: null as Date | null, useCount: 3, maxUses: 25 };
  check("open link", joinLinkState(link, now) === "open");
  check("expired at the deadline", joinLinkState(link, link.expiresAt) === "expired");
  check("full link", joinLinkState({ ...link, useCount: 25 }, now) === "full");
  check("revoked link", joinLinkState({ ...link, revokedAt: now }, now) === "revoked");

  // The Google token cookie.
  const sealed = sealToken("ya29.secret", "u_me", 2_000);
  check("token opens for its owner", openToken(sealed, "u_me", 1_000) === "ya29.secret");
  check("token hidden in the cookie", !sealed.includes("ya29"));
  check("another user's token refused", openToken(sealed, "u_other", 1_000) === null);
  check("expired token refused", openToken(sealed, "u_me", 2_000) === null);
  check("tampered token refused", openToken(sealed.slice(0, -2) + (sealed.endsWith("AA") ? "BB" : "AA"), "u_me", 1_000) === null);
  check("missing or junk token refused", openToken(undefined, "u_me") === null && openToken("junk", "u_me") === null);

  // The consent address.
  process.env.AUTH_GOOGLE_ID = "client-id";
  process.env.AUTH_GOOGLE_SECRET = "client-secret";
  const flow = newFlow();
  const consent = new URL(consentUrl("https://app.example", flow));
  check("asks for contacts only", consent.searchParams.get("scope") === CONTACTS_SCOPE);
  check("no refresh token asked for", consent.searchParams.get("access_type") === "online");
  check("comes back to the callback", consent.searchParams.get("redirect_uri") === "https://app.example/api/contacts/google/callback");
  check("state and PKCE sent", consent.searchParams.get("state") === flow.state && consent.searchParams.get("code_challenge") === flow.challenge && consent.searchParams.get("code_challenge_method") === "S256");
  check("flows differ", newFlow().state !== flow.state);

  // Trading the code for a token.
  const calls: { url: string; init?: RequestInit }[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fake = (responses: Response[]) =>
    (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return responses.shift()!;
    }) as typeof fetch;

  const before = Date.now();
  const got = await exchangeCode("the-code", flow.verifier, "https://app.example", fake([json({ access_token: "ya29.x", expires_in: 3599, scope: `openid ${CONTACTS_SCOPE}` })]));
  const sent = new URLSearchParams(String(calls[0].init?.body));
  check("token returned", got?.accessToken === "ya29.x");
  check("expiry a minute short", !!got && got.expiresAt >= before + 3538_000 && got.expiresAt <= Date.now() + 3539_000);
  check("code, verifier and secret sent", sent.get("code") === "the-code" && sent.get("code_verifier") === flow.verifier && sent.get("client_secret") === "client-secret" && sent.get("grant_type") === "authorization_code");
  check("contacts not granted: refused", (await exchangeCode("c", "v", "https://app.example", fake([json({ access_token: "t", expires_in: 3600, scope: "openid email" })]))) === null);
  check("google refuses: refused", (await exchangeCode("c", "v", "https://app.example", fake([json({ error: "invalid_grant" }, 400)]))) === null);

  // Reading contacts.
  calls.length = 0;
  const two = await fetchGoogleContacts(
    "ya29.x",
    fake([
      json({ connections: [{ names: [{ displayName: "A" }], emailAddresses: [{ value: "a@example.com" }] }], nextPageToken: "next" }),
      json({ connections: [{ names: [{ displayName: "B" }], emailAddresses: [{ value: "b@example.com" }] }] }),
    ]),
  );
  check("pages followed", two.ok && two.rows.length === 2 && calls.length === 2);
  check("second page asked by token", new URL(calls[1].url).searchParams.get("pageToken") === "next");
  check("names, addresses and photos only", new URL(calls[0].url).searchParams.get("personFields") === "names,emailAddresses,photos");
  check("bearer token sent", new Headers(calls[0].init?.headers).get("authorization") === "Bearer ya29.x");
  const out = await fetchGoogleContacts("t", fake([json({}, 401)]));
  check("expired permission: ask again", !out.ok && out.reason === "denied");
  const off = await fetchGoogleContacts("t", fake([json({}, 403)]));
  check("api off: failed, not asked again", !off.ok && off.reason === "failed");
  const empty = await fetchGoogleContacts("t", fake([json({})]));
  check("no contacts: empty list", empty.ok && empty.rows.length === 0);

  console.log(failures ? `\n${failures} failing` : "\nall passing");
  process.exit(failures ? 1 : 0);
}

main();
