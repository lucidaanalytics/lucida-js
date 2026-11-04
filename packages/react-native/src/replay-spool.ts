import type { Storage } from "@lucida-analytics/sdk-core";

export const SPOOL_KEY = "lc_replay";
export const DEFAULT_SPOOL_BUDGET_BYTES = 10 * 1024 * 1024;

export interface SpoolEntry {
  id: number;
  sid: string;
  seq: number;
  /** Waiting for the minimum session duration (dropped if the session ends first); false = waiting for upload. */
  held: boolean;
  /** Body size in bytes. */
  n: number;
  /** Number of parts the body is split into (`lc_replay.<id>.<i>`). */
  p: number;
  /** Body length in UTF-16 units: a torn or truncated body no longer adds up and is discarded. */
  len: number;
}

/** Android AsyncStorage rows break past ~2 MB; a part is at most 300k UTF-16 units, i.e. under 1 MB even at 3 bytes each. */
export const SPOOL_PART_CHARS = 300_000;
const PENDING_KEY = "lc_replay.pending";

const byteLength = (s: string): number => {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xd800 && c < 0xdc00 ? (i++, 4) : 3;
  }
  return n;
};

/**
 * Durable, ordered spill for replay chunks that cannot be sent yet (min duration, offline, upload backoff).
 * `lc_replay` is the index (JSON list of entries), `lc_replay.<id>.<i>` holds part i of one chunk body (no api key), split
 * into parts under 1 MB. Write order: `lc_replay.pending` names the entry in flight, then its parts, then the index, then
 * pending is cleared; a crash in between leaves parts the index never lists, which load deletes. Pass a storage
 * wrapped with `encryptedStorage(..., [SPOOL_KEY], [`${SPOOL_KEY}.`])` to encrypt at rest. Over `budget` bytes the oldest
 * whole session is dropped (never single chunks, so a kept session has no hole) and `onDrop` reports it.
 */
export function createReplaySpool(
  storage: Storage,
  budget = DEFAULT_SPOOL_BUDGET_BYTES,
  onDrop?: (sid: string, chunks: number, bytes: number) => void,
) {
  let items: SpoolEntry[] = [];
  let nextId = 0;
  const partKey = (id: number, i: number): string => `${SPOOL_KEY}.${id}.${i}`;
  const removeParts = (id: number, count: number): void => {
    for (let i = 0; i < count; i++) storage.remove(partKey(id, i));
  };
  const complete = (e: SpoolEntry): boolean => {
    for (let i = 0; i < e.p; i++) if (storage.get(partKey(e.id, i)) === null) return false;
    return true;
  };
  let listed: SpoolEntry[] = [];
  try {
    const raw = storage.get(SPOOL_KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    if (Array.isArray(parsed)) listed = parsed as SpoolEntry[];
  } catch {
    listed = []; // a corrupt index starts empty
  }
  items = listed.filter((e) => typeof e.p === "number" && complete(e));
  for (const e of listed) if (!items.includes(e)) removeParts(e.id, typeof e.p === "number" ? e.p : 0);
  const pending = storage.get(PENDING_KEY); // a write that never reached the index
  if (pending !== null) {
    const [pid, pcount] = pending.split(":").map(Number);
    if (pid !== undefined && pcount !== undefined && !items.some((e) => e.id === pid)) removeParts(pid, pcount);
    storage.remove(PENDING_KEY);
  }
  nextId = Math.max(listed.reduce((m, e) => Math.max(m, e.id + 1), 0), items.reduce((m, e) => Math.max(m, e.id + 1), 0));
  if (items.length !== listed.length) storage.set(SPOOL_KEY, JSON.stringify(items));
  const save = (): void => (items.length === 0 ? storage.remove(SPOOL_KEY) : storage.set(SPOOL_KEY, JSON.stringify(items)));
  const drop = (gone: SpoolEntry[]): void => {
    for (const e of gone) removeParts(e.id, e.p);
    items = items.filter((e) => !gone.includes(e));
  };

  return {
    entries: (): readonly SpoolEntry[] => items,
    totalBytes: (): number => items.reduce((a, e) => a + e.n, 0),
    add(sid: string, seq: number, held: boolean, body: string): void {
      const parts: string[] = [];
      for (let at = 0; at < body.length || parts.length === 0; ) {
        let end = Math.min(body.length, at + SPOOL_PART_CHARS);
        const last = body.charCodeAt(end - 1);
        if (end < body.length && last >= 0xd800 && last < 0xdc00) end -= 1; // never cut a surrogate pair
        parts.push(body.slice(at, end));
        at = end;
      }
      const e: SpoolEntry = { id: nextId++, sid, seq, held, n: byteLength(body), p: parts.length, len: body.length };
      storage.set(PENDING_KEY, `${e.id}:${e.p}`);
      parts.forEach((part, i) => storage.set(partKey(e.id, i), part));
      items.push(e);
      const dropped: Array<[string, number, number]> = [];
      while (items.length > 0 && items.reduce((a, x) => a + x.n, 0) > budget) {
        const first = items[0] as SpoolEntry;
        const gone = items.filter((x) => x.sid === first.sid);
        drop(gone);
        dropped.push([first.sid, gone.length, gone.reduce((a, x) => a + x.n, 0)]);
      }
      save();
      storage.remove(PENDING_KEY);
      for (const [s, c, b] of dropped) onDrop?.(s, c, b);
    },
    /** The whole body, or null when a part is missing or the length does not add up (torn write): the caller discards it. */
    read(e: SpoolEntry): string | null {
      let out = "";
      for (let i = 0; i < e.p; i++) {
        const part = storage.get(partKey(e.id, i));
        if (part === null) return null;
        out += part;
      }
      return out.length === e.len ? out : null;
    },
    remove(e: SpoolEntry): void {
      drop([e]);
      save();
    },
    /** Held chunks of every session except `keep`; returned so the caller can give their seq numbers back. */
    removeHeld(keep?: string): SpoolEntry[] {
      const gone = items.filter((e) => e.held && e.sid !== keep);
      drop(gone);
      save();
      return gone;
    },
    /** The session reached its minimum duration: its held chunks become plain pending uploads. */
    release(sid: string): void {
      items = items.map((e) => (e.held && e.sid === sid ? { ...e, held: false } : e));
      save();
    },
    nextSeq: (sid: string): number => items.filter((e) => e.sid === sid).reduce((m, e) => Math.max(m, e.seq), -1) + 1,
    clear(): void {
      drop([...items]);
      save();
    },
  };
}

export type ReplaySpool = ReturnType<typeof createReplaySpool>;
