// Client-side offline queue for expense additions, backed by localStorage.
//
// When the network is down, AddExpenseForm enqueues the (already client-
// validated) action input here instead of losing it. OfflineSync replays the
// queue through the normal addExpenseAction once connectivity returns, so
// every queued item still passes the full server-side validation, membership
// authorization, and participant-key resolution.
//
// Privacy: items contain only what the form sends — context id, date,
// category, item text, amount, and opaque participant keys. No email
// addresses are ever stored. Each item is tagged with an opaque per-user
// `owner` token (an HMAC computed server-side), so on a shared device one
// account's queued expenses are never submitted under another's session.

export interface QueuedExpenseInput {
  ctx: string;
  date: string;
  category: string;
  item: string;
  amount: number;
  payer: string;
  split: string;
}

export interface QueuedExpense extends QueuedExpenseInput {
  id: string;
  owner: string;
  queuedAt: string;
}

export interface FailedExpense extends QueuedExpense {
  error: string;
}

const QUEUE_KEY = "ledger.offlineExpenses.v1";
const FAILED_KEY = "ledger.offlineExpensesFailed.v1";
const LOCK_KEY = "ledger.offlineExpenses.lock";
const CHANGE_EVENT = "ledger-offline-queue-changed";
const MAX_QUEUE = 100;
const MAX_FAILED = 20;
const LOCK_TTL_MS = 20_000;

function read<T>(key: string): T[] {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

function write<T>(key: string, items: T[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(items));
  } catch {
    // Storage full or unavailable — enqueueExpense reports this to the user.
  }
  notify();
}

function notify(): void {
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // non-browser context
  }
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `q${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  }
}

/** Re-renders on queue changes from this tab (custom event) or others (storage). */
export function subscribeQueue(cb: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function listQueued(owner: string): QueuedExpense[] {
  return read<QueuedExpense>(QUEUE_KEY).filter((q) => q.owner === owner);
}

export function listFailed(owner: string): FailedExpense[] {
  return read<FailedExpense>(FAILED_KEY).filter((q) => q.owner === owner);
}

/** Returns false when the queue is full or storage is unusable. */
export function enqueueExpense(owner: string, input: QueuedExpenseInput): boolean {
  const all = read<QueuedExpense>(QUEUE_KEY);
  if (all.length >= MAX_QUEUE) return false;
  const id = newId();
  all.push({ ...input, id, owner, queuedAt: new Date().toISOString() });
  write(QUEUE_KEY, all);
  // Read back: write() swallows quota errors, so confirm it actually landed.
  return read<QueuedExpense>(QUEUE_KEY).some((q) => q.id === id);
}

function removeQueued(id: string): void {
  write(
    QUEUE_KEY,
    read<QueuedExpense>(QUEUE_KEY).filter((q) => q.id !== id),
  );
}

function recordFailed(q: QueuedExpense, error: string): void {
  const all = read<FailedExpense>(FAILED_KEY);
  all.push({ ...q, error });
  write(FAILED_KEY, all.slice(-MAX_FAILED));
}

export function dismissFailed(owner: string, id: string): void {
  write(
    FAILED_KEY,
    read<FailedExpense>(FAILED_KEY).filter((q) => !(q.owner === owner && q.id === id)),
  );
}

export interface FlushResult {
  synced: number;
  failed: number;
  remaining: number;
}

/**
 * Sends queued items (oldest first) via `send`, which wraps addExpenseAction.
 * - resolved ok:true  -> item removed (synced)
 * - resolved ok:false -> item removed and parked in the failed list with the
 *   server's reason (retrying a rejected item would jam the queue forever)
 * - rejected (network) -> stop; everything left stays queued for next time
 * A localStorage timestamp lock keeps two tabs from double-submitting.
 */
export async function flushQueue(
  owner: string,
  send: (q: QueuedExpense) => Promise<{ ok: boolean; error?: string }>,
): Promise<FlushResult> {
  try {
    const lock = Number(window.localStorage.getItem(LOCK_KEY) ?? 0);
    if (Date.now() - lock < LOCK_TTL_MS) {
      return { synced: 0, failed: 0, remaining: listQueued(owner).length };
    }
    window.localStorage.setItem(LOCK_KEY, String(Date.now()));
  } catch {
    // No storage means no queue either; nothing to flush.
    return { synced: 0, failed: 0, remaining: 0 };
  }

  let synced = 0;
  let failed = 0;
  try {
    for (const q of listQueued(owner)) {
      try {
        window.localStorage.setItem(LOCK_KEY, String(Date.now()));
      } catch {
        // keep going — losing the lock only risks a duplicate, not data loss
      }
      let res: { ok: boolean; error?: string };
      try {
        res = await send(q);
      } catch {
        break; // transport failure: still offline, retry on the next flush
      }
      if (res.ok) {
        synced++;
      } else {
        recordFailed(q, res.error ?? "The server rejected this expense.");
        failed++;
      }
      removeQueued(q.id);
    }
  } finally {
    try {
      window.localStorage.removeItem(LOCK_KEY);
    } catch {
      // lock expires via TTL anyway
    }
  }
  return { synced, failed, remaining: listQueued(owner).length };
}
