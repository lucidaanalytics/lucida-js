import type { Client } from "@lucida-analytics/browser";
import { useEffect, useRef } from "react";

/**
 * Keep the Lucida identity in step with your session: identify when `id` becomes a non-empty string different from
 * the last one, reset only on a signed-in to signed-out transition (never on a first or repeated signed-out render).
 * `props` are sent with identify; changing them alone does not re-identify.
 */
export function useIdentityTransition(client: Client | null, id?: string | null, props?: Record<string, unknown>): void {
  const prev = useRef<string | null>(null);
  useEffect(() => {
    if (!client) return;
    const next = id || null;
    if (next && next !== prev.current) client.identify(next, props);
    else if (!next && prev.current) client.reset();
    prev.current = next;
    // props are read when the id changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, id]);
}
