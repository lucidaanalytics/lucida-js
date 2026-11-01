/** Cross-origin iframe capture helpers (LC-EXP-24). rrweb trusts any `type:"rrweb"` message whose origin matches its own claim, so the allowlists live here. */

export const inIframe = (): boolean => window.parent !== window;

/** Origin of the embedding page: ancestorOrigins where available (Chromium/Safari), else the referrer. */
export function parentOrigin(): string | undefined {
  const anc = (location as { ancestorOrigins?: ArrayLike<string> }).ancestorOrigins;
  if (anc?.length) return anc[0];
  try {
    return document.referrer ? new URL(document.referrer).origin : undefined;
  } catch {
    return undefined;
  }
}

/** Iframe side: may this frame post its events to the embedding page? */
export const mayPostToParent = (allowed: string[]): boolean => {
  const o = parentOrigin();
  return !!o && allowed.includes(o);
};

/**
 * Parent side: drops rrweb messages from origins off the allowlist before rrweb's own listener
 * sees them (ours is registered first and stops propagation). Returns the unregister function.
 */
export function guardIframeMessages(allowed: string[]): () => void {
  const h = (e: MessageEvent): void => {
    const d = e.data as { type?: unknown } | null;
    if (d && typeof d === "object" && d.type === "rrweb" && !allowed.includes(e.origin)) e.stopImmediatePropagation();
  };
  window.addEventListener("message", h);
  return () => window.removeEventListener("message", h);
}
