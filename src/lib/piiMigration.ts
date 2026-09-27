// One-time rewrite of stored email addresses into user ids (see piiCrypto.ts).
//
// Runs from the app, not from a SQL script, because the hash and encryption
// keys live only in the app's environment. It runs on the first authenticated
// request a server instance handles, in one transaction under an advisory
// lock, so concurrent instances wait for it and then see the finished data.
//
// Only the production deployment may run it: previews share the database but
// may not carry the same key, and running there would rewrite production data
// ahead of the production code. Until it has run, other deployments refuse
// signed-in requests instead of writing ids next to raw addresses.
//
// Once recorded, each new server instance re-runs the same pass once as a
// cheap sweep. It finds nothing normally, but converts any raw address an
// older deployment wrote after the migration.

import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { emailId } from "./piiCrypto";
import { encryptEmail } from "./piiStore";

const MIGRATION_ID = "email-v1";
const LOCK_KEY = 7_311_902_411; // arbitrary, fixed

// Plain columns that hold one email per value.
const COLUMNS: [table: string, column: string][] = [
  ["group_members", "email"],
  ["groups", "created_by"],
  ["group_name_history", "changed_by"],
  ["group_invites", "invited_by"],
  ["expenses", "payer"],
  ["expenses", "split"],
  ["expenses", "owner_email"],
  ["settlements", "settled_by"],
  ["settlements", "settled_to"],
  ["settlements", "owner_email"],
  ["receipts", "owner_email"],
  ["receipts", "created_by"],
  ["notifications", "recipient_email"],
  ["notifications", "actor_email"],
];
// Row snapshots in the change log; emails appear as whole JSON string values.
const JSON_COLUMNS: [table: string, column: string][] = [
  ["expense_changes", "old_data"],
  ["expense_changes", "new_data"],
];

export class PiiNotReadyError extends Error {
  constructor() {
    super(
      "Email protection has not been applied to the database yet. It runs automatically on the production deployment.",
    );
  }
}

function mayMigrate(): boolean {
  if (process.env.PII_MIGRATE === "1") return true;
  if (process.env.VERCEL_ENV) return process.env.VERCEL_ENV === "production";
  return process.env.NODE_ENV !== "production";
}

let ready: Promise<void> | null = null;

/** Resolves once stored emails are user ids. Cached per server instance. */
export function ensurePiiMigrated(): Promise<void> {
  ready ??= run().catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}

async function run(): Promise<void> {
  const done = await prisma.piiMigration.findUnique({ where: { id: MIGRATION_ID } });
  if (!done && !mayMigrate()) throw new PiiNotReadyError();
  const stats = await migrate();
  if (!done || stats.rows > 0) {
    console.info(`PII email migration (${done ? "sweep" : "initial"}):`, stats);
  }
}

type Tx = Prisma.TransactionClient;

async function migrate(): Promise<{ emails: number; rows: number }> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`select pg_advisory_xact_lock(${LOCK_KEY})`);
      // Rewriting emails is not an edit: keep it out of the change log.
      await tx.$executeRawUnsafe(`set local app.skip_cdc = 'on'`);

      const emails = await collectEmails(tx);
      let rows = 0;
      if (emails.length > 0) {
        const ids = await Promise.all(emails.map((e) => emailId(e)));
        const encs = emails.map((e) => encryptEmail(e));
        rows += await migrateUsers(tx, emails, ids, encs);
        rows += await migrateInvites(tx, emails, ids, encs);
        for (const [table, column] of COLUMNS) {
          rows += await tx.$executeRawUnsafe(
            `update public.${table} t set ${column} = m.id
               from unnest($1::text[], $2::text[]) as m(email, id)
              where t.${column} = m.email`,
            emails,
            ids,
          );
        }
        for (const [table, column] of JSON_COLUMNS) {
          for (let i = 0; i < emails.length; i++) {
            const from = JSON.stringify(emails[i]);
            rows += await tx.$executeRawUnsafe(
              `update public.${table}
                  set ${column} = replace(${column}::text, $1, $2)::jsonb
                where strpos(${column}::text, $1) > 0`,
              from,
              JSON.stringify(ids[i]),
            );
          }
        }
      }
      await tx.$executeRawUnsafe(
        `insert into public.pii_migrations (id) values ($1) on conflict (id) do nothing`,
        MIGRATION_ID,
      );
      return { emails: emails.length, rows };
    },
    { timeout: 120_000, maxWait: 60_000 },
  );
}

/** Every distinct raw address still stored anywhere we migrate. */
async function collectEmails(tx: Tx): Promise<string[]> {
  const sources = [
    `select email as v from public.app_users`,
    `select invited_email from public.group_invites`,
    ...COLUMNS.map(([t, c]) => `select ${c} from public.${t}`),
    ...JSON_COLUMNS.map(([t, c]) => `select ${c}::text from public.${t}`),
  ];
  const found = await tx.$queryRawUnsafe<{ email: string }[]>(
    `select distinct m[1] as email
       from (${sources.join(" union all ")}) s(v),
            regexp_matches(s.v, '([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,})', 'g') as m
      where s.v like '%@%'`,
  );
  return found.map((r) => r.email);
}

async function migrateUsers(tx: Tx, emails: string[], ids: string[], encs: string[]) {
  let rows = 0;
  for (let i = 0; i < emails.length; i++) {
    const plain = await tx.appUser.findUnique({ where: { email: emails[i] } });
    if (!plain) continue;
    const existing = await tx.appUser.findUnique({ where: { email: ids[i] } });
    if (existing) {
      // An older deployment re-created a raw row after the migration: keep
      // the migrated row, repoint invites, and drop the duplicate.
      rows += await tx.groupInvite.updateMany({
        where: { invitedBy: emails[i] },
        data: { invitedBy: ids[i] },
      }).then((r) => r.count);
      await tx.appUser.delete({ where: { email: emails[i] } });
      if (!existing.emailEnc) {
        await tx.appUser.update({ where: { email: ids[i] }, data: { emailEnc: encs[i] } });
      }
    } else {
      // ON UPDATE CASCADE carries group_invites.invited_by along.
      await tx.appUser.update({
        where: { email: emails[i] },
        data: { email: ids[i], emailEnc: encs[i] },
      });
    }
    rows++;
  }
  return rows;
}

async function migrateInvites(tx: Tx, emails: string[], ids: string[], encs: string[]) {
  let rows = 0;
  for (let i = 0; i < emails.length; i++) {
    const r = await tx.groupInvite.updateMany({
      where: { invitedEmail: emails[i] },
      data: { invitedEmail: ids[i], invitedEmailEnc: encs[i] },
    });
    rows += r.count;
  }
  return rows;
}
