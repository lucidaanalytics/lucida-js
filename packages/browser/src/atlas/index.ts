import type { Module } from "../types.js";

type AtlasWin = { Atlas?: { session?: { user?: { id?: string } | null } } };
const POLL_MS = 250;
const POLL_CAP_MS = 10_000;

/**
 * Follows the Atlas browser session (`window.Atlas.session`, `atlas:session` event with `detail: { signedIn, userId }`):
 * identifies the visitor as the Atlas user id on sign-in and resets on sign-out (only when this module identified them).
 * `property` also sets that person property to the id. Pass it in `modules`; the global may appear after init.
 */
export function atlasIdentity(opts: { property?: string } = {}): Module {
  return (host) => {
    let mine: string | null = null;
    const apply = (id: string | null | undefined): void => {
      if (id) {
        if (mine === id) return;
        mine = id;
        host.client.identify(id, opts.property ? { [opts.property]: id } : undefined);
      } else if (mine) {
        mine = null;
        host.client.reset();
      }
    };
    const onEvent = (e: Event): void => {
      const d = (e as CustomEvent<{ signedIn?: boolean; userId?: string | null } | undefined>).detail;
      apply(d?.signedIn ? d.userId : null);
    };
    window.addEventListener("atlas:session", onEvent);
    // The global can appear after init (script order): poll briefly for it, then rely on the event alone.
    let waited = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const look = (): void => {
      const s = (window as unknown as AtlasWin).Atlas?.session;
      if (s) return apply(s.user?.id);
      if ((waited += POLL_MS) < POLL_CAP_MS) timer = setTimeout(look, POLL_MS);
    };
    look();
    return () => {
      window.removeEventListener("atlas:session", onEvent);
      clearTimeout(timer);
    };
  };
}
