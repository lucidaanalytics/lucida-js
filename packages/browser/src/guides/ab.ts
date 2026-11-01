import type { Guide } from "../types.js";

/** Stable position in [0,1) for a (person, salt) pair (FNV-1a; not security relevant). */
export function bucket(key: string, salt: string): number {
  let h = 0x811c9dc5;
  for (const c of `${salt}:${key}`) h = Math.imul(h ^ c.codePointAt(0)!, 0x01000193);
  h ^= h >>> 16; // final avalanche: sequential ids must still spread evenly
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 2 ** 32;
}

/** The A/B variant this person gets from the guides sharing the group of `g` (weights; ids sorted so every browser agrees). */
export function variantOf(g: Guide, all: Guide[], key: string): Guide {
  const grp = g.conditions.ab_group;
  if (!grp) return g;
  const peers = all.filter((x) => x.conditions.ab_group === grp).sort((a, b) => (a.id < b.id ? -1 : 1));
  const total = peers.reduce((n, x) => n + (x.conditions.ab_weight ?? 1), 0);
  let at = bucket(key, `ab:${grp}`) * total;
  for (const p of peers) {
    at -= p.conditions.ab_weight ?? 1;
    if (at < 0) return p;
  }
  return peers[peers.length - 1]!;
}

/** Held back as the control group of `g` (the same people for the whole A/B group). */
export function heldOut(g: Guide, key: string): boolean {
  const pct = g.conditions.holdout_pct ?? 0;
  return pct > 0 && bucket(key, `holdout:${g.conditions.ab_group ?? g.id}`) * 100 < pct;
}
