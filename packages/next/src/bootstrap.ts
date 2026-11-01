import { COOKIE_ID, HEADER_FLAGS, HEADER_ID, newDistinctId, resolveFlags } from "./shared.js";
import type { Bootstrap, Flags, LucidaNextOptions } from "./shared.js";

/** Anything with `get(name)`: `Headers`, or the `ReadonlyHeaders` from `next/headers`. */
export interface HeadersLike {
  get(name: string): string | null;
}

export function parseCookie(header: string | null | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return undefined;
}

function parseFlags(raw: string | null): Flags | undefined {
  if (!raw) return undefined;
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Flags) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The visitor's bootstrap for server rendering. Prefers what `lucidaMiddleware` forwarded on this request (only with `middleware: true`);
 * without middleware it reads the distinct-id cookie (or mints an id for this render) and evaluates the flags itself.
 * App Router: `getBootstrap(await headers(), opts)`. Pages Router: see `getServerSideLucida`.
 */
export async function getBootstrap(headers: HeadersLike, o: LucidaNextOptions): Promise<Bootstrap> {
  const id = o.middleware ? headers.get(HEADER_ID) : null;
  const flags = o.middleware ? parseFlags(headers.get(HEADER_FLAGS)) : undefined;
  if (id && flags) return { distinctId: id, flags };
  const distinctId = parseCookie(headers.get("cookie"), COOKIE_ID) ?? newDistinctId();
  return { distinctId, flags: await resolveFlags(o, distinctId) };
}
