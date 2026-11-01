import type { FlagValue } from "./flags.js";

/**
 * Migration flags (LC-FLG-24): a multivariate flag whose variants are the six stages of moving a data
 * path from an old system to a new one. The stage decides which side is read and written, and which
 * side is authoritative.
 */
export const MIGRATION_STAGES = ["off", "dualwrite", "shadow", "live", "rampdown", "complete"] as const;
export type MigrationStage = (typeof MIGRATION_STAGES)[number];

/** The stage a flag value names; anything else (flag off, unknown) is the safe default `off`. */
export const migrationStage = (v: FlagValue | undefined): MigrationStage =>
  (MIGRATION_STAGES as readonly unknown[]).includes(v) ? (v as MigrationStage) : "off";

export interface MigrationReport {
  op: "read" | "write";
  stage: MigrationStage;
  /** Shadow / live reads: did both sides agree (by `compare`)? */
  consistent?: boolean;
  errors: { old?: string; new?: string };
  latency_ms: { old?: number; new?: number };
}

export interface MigrationOps<R, W> {
  readOld: () => Promise<R>;
  readNew: () => Promise<R>;
  writeOld: () => Promise<W>;
  writeNew: () => Promise<W>;
  /** Equality for shadow / live reads. Default: JSON equality. */
  compare?: (oldValue: R, newValue: R) => boolean;
  /** Called once per operation, e.g. to capture a `$migration_op` event. */
  onReport?: (r: MigrationReport) => void;
}

const READ: Record<MigrationStage, { auth: "old" | "new"; both: boolean }> = {
  off: { auth: "old", both: false },
  dualwrite: { auth: "old", both: false },
  shadow: { auth: "old", both: true },
  live: { auth: "new", both: true },
  rampdown: { auth: "new", both: false },
  complete: { auth: "new", both: false },
};
const WRITE: Record<MigrationStage, { auth: "old" | "new"; both: boolean }> = {
  off: { auth: "old", both: false },
  dualwrite: { auth: "old", both: true },
  shadow: { auth: "old", both: true },
  live: { auth: "new", both: true },
  rampdown: { auth: "new", both: true },
  complete: { auth: "new", both: false },
};

type Side = "old" | "new";
const other = (s: Side): Side => (s === "old" ? "new" : "old");
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function timed<T>(r: MigrationReport, side: Side, f: () => Promise<T>): Promise<{ ok: true; v: T } | { ok: false; e: unknown }> {
  const t = Date.now();
  try {
    return { ok: true, v: await f() };
  } catch (e) {
    r.errors[side] = msg(e);
    return { ok: false, e };
  } finally {
    r.latency_ms[side] = Date.now() - t;
  }
}

/** Read through the stage: the authoritative side's result (or error) is returned; shadow / live also read the other side and compare. */
export async function migrateRead<R, W>(stage: MigrationStage, ops: MigrationOps<R, W>): Promise<R> {
  const plan = READ[stage];
  const r: MigrationReport = { op: "read", stage, errors: {}, latency_ms: {} };
  const fn = (s: Side) => (s === "old" ? ops.readOld : ops.readNew);
  const [auth, shadow] = await Promise.all([timed(r, plan.auth, fn(plan.auth)), plan.both ? timed(r, other(plan.auth), fn(other(plan.auth))) : undefined]);
  if (auth.ok && shadow?.ok) {
    const [o, n] = plan.auth === "old" ? [auth.v, shadow.v] : [shadow.v, auth.v];
    r.consistent = ops.compare ? ops.compare(o, n) : JSON.stringify(o) === JSON.stringify(n);
  }
  ops.onReport?.(r);
  if (!auth.ok) throw auth.e;
  return auth.v;
}

/** Write through the stage: the authoritative side first; the other side only after it succeeded (its failure is reported, not thrown). */
export async function migrateWrite<R, W>(stage: MigrationStage, ops: MigrationOps<R, W>): Promise<W> {
  const plan = WRITE[stage];
  const r: MigrationReport = { op: "write", stage, errors: {}, latency_ms: {} };
  const fn = (s: Side) => (s === "old" ? ops.writeOld : ops.writeNew);
  const auth = await timed(r, plan.auth, fn(plan.auth));
  if (auth.ok && plan.both) await timed(r, other(plan.auth), fn(other(plan.auth)));
  ops.onReport?.(r);
  if (!auth.ok) throw auth.e;
  return auth.v;
}
