// Checks for Web Push (no network). Run with `npm run test:push`.
// - the payload the server builds and the subscriptions it accepts;
// - a payload encrypted by web-push for a made-up device decrypts back
//   to the same JSON with that device's keys, as a browser would.
import { createECDH, randomBytes } from "crypto";
import webpush from "web-push";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ece = require("http_ece") as { decrypt: (buf: Buffer, opts: Record<string, unknown>) => Buffer };
import { buildPushPayload, parseSubscription } from "../../src/lib/pushPayload";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " | " + detail : ""}`);
  if (!ok) failures++;
};

const p = buildPushPayload({ groupId: "g1", groupName: "Goa trip", message: 'Asha added "Dinner" (₹1,200)', url: "/g/g1?tab=expenses&n=7", unread: 3 });
check("title is the group", p.title === "Goa trip");
check("body is the message", p.body === 'Asha added "Dinner" (₹1,200)');
check("url kept", p.url === "/g/g1?tab=expenses&n=7");
check("badge is the unread count", p.badge === 3);
check("tag per group", p.tag === "group-g1");
check("long message cut", buildPushPayload({ groupId: "g", groupName: "x", message: "a".repeat(1000), url: "/", unread: 0 }).body.length === 240);
check("offsite url falls back", buildPushPayload({ groupId: "g", groupName: "x", message: "m", url: "https://evil.example/", unread: 0 }).url === "/notifications");
check("no group name falls back", buildPushPayload({ groupId: "g", groupName: "", message: "m", url: "/", unread: 0 }).title === "Ledger");

const device = createECDH("prime256v1");
device.generateKeys();
const authSecret = randomBytes(16);
const good = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
  keys: { p256dh: device.getPublicKey().toString("base64url"), auth: authSecret.toString("base64url") },
};
check("browser subscription accepted", parseSubscription(good)?.endpoint === good.endpoint);
check("http endpoint refused", parseSubscription({ ...good, endpoint: "http://x.example/" }) === null);
check("missing keys refused", parseSubscription({ endpoint: good.endpoint }) === null);
check("junk refused", parseSubscription("nope") === null && parseSubscription(null) === null);
check("bad key characters refused", parseSubscription({ ...good, keys: { p256dh: "<script>".repeat(5), auth: good.keys.auth } }) === null);

const vapid = webpush.generateVAPIDKeys();
const details = webpush.generateRequestDetails(good, JSON.stringify(p), {
  vapidDetails: { subject: "mailto:test@example.com", publicKey: vapid.publicKey, privateKey: vapid.privateKey },
  TTL: 60,
});
check("sent to the endpoint", details.endpoint === good.endpoint && details.method === "POST");
check("aes128gcm encoding", details.headers["Content-Encoding"] === "aes128gcm");
check("vapid signed", /^vapid t=.+, k=/.test(String(details.headers.Authorization)));
const plain = ece.decrypt(details.body as Buffer, { version: "aes128gcm", privateKey: device, authSecret });
check("device decrypts the payload", JSON.stringify(JSON.parse(plain.toString("utf8"))) === JSON.stringify(p), plain.toString("utf8"));

console.log(failures ? `\n${failures} failing` : "\nall passing");
process.exit(failures ? 1 : 0);
