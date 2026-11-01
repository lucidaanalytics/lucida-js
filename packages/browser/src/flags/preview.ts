/** URL parameter of experiment QA links (LC-EXT-34): `?lc_preview=flag:variant[,flag:variant]`, `off` clears. */
export const PREVIEW_PARAM = "lc_preview";
const KEY = "lc_preview";

/** Parse `flag:variant,flag:variant` (bad pairs are skipped). */
export function parsePreview(v: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of (v ?? "").split(",")) {
    const i = pair.indexOf(":");
    if (i > 0 && i < pair.length - 1) out[pair.slice(0, i)] = pair.slice(i + 1);
  }
  return out;
}

/**
 * The variants this tab previews: the link's parameter, else what an earlier page of this tab kept
 * (so a multipage experiment can be checked across navigations). Never persisted beyond the tab.
 */
export function readPreview(href: string): { forced: Record<string, string>; persist(): void } {
  const raw = new URL(href).searchParams.get(PREVIEW_PARAM);
  let kept: string | null = null;
  try {
    kept = sessionStorage.getItem(KEY);
  } catch {
    /* storage blocked */
  }
  const value = raw === "off" ? null : (raw ?? kept);
  return {
    forced: parsePreview(value),
    /** Call after consent: remember (or clear) the preview for the rest of this tab. */
    persist() {
      try {
        if (raw === "off") sessionStorage.removeItem(KEY);
        else if (raw) sessionStorage.setItem(KEY, raw);
      } catch {
        /* storage blocked: the preview lasts for this page only */
      }
    },
  };
}
