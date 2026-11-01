/**
 * Live selector check for guide pre-launch (G122). The app opens the page with the toolbar token and
 * `__lc_check=<json>`: `{ origin, steps: [{ step, url?, selectors }] }`. Inside an authorized toolbar session the
 * toolbar resolves every step's selectors (primary, then fallbacks) on the live page and posts only the counts
 * back to the opening app window, at the exact origin it named. No page content leaves the page.
 */
export const CHECK_PARAM = "__lc_check";
export const CHECK_MESSAGE = "lc:guide-check";

export interface CheckRequest {
  origin: string;
  steps: Array<{ step: number; url?: string; selectors: string[] }>;
}

export interface StepResult {
  step: number;
  /** The selector that matched (first of primary + fallbacks), or null. */
  selector: string | null;
  matches: number;
  visible: boolean;
  /** False when the step lives on another page (its `url` is not part of this page's URL). */
  onPage: boolean;
  /** Selectors that are not valid CSS. */
  invalid: string[];
}

/** The request, or null when the param is malformed (wrong shape, non-http origin, oversized). */
export function parseCheck(raw: string | null): CheckRequest | null {
  if (!raw || raw.length > 20_000) return null;
  try {
    const v = JSON.parse(raw) as Partial<CheckRequest>;
    const origin = typeof v.origin === "string" ? new URL(v.origin).origin : "";
    if (!/^https?:\/\//.test(origin) || !Array.isArray(v.steps)) return null;
    const steps = v.steps
      .filter((s) => s && typeof s.step === "number" && Array.isArray(s.selectors))
      .slice(0, 50)
      .map((s) => ({ step: s.step, ...(typeof s.url === "string" && s.url ? { url: s.url } : {}), selectors: s.selectors.filter((x) => typeof x === "string" && x.trim()).slice(0, 10) }));
    return { origin, steps };
  } catch {
    return null;
  }
}

const shown = (el: Element): boolean => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};

/** Resolves each step on the current document. */
export function resolveSteps(req: CheckRequest, href = location.href): StepResult[] {
  return req.steps.map((s) => {
    const invalid: string[] = [];
    let hit: { selector: string; els: Element[] } | null = null;
    for (const sel of s.selectors) {
      try {
        const els = Array.from(document.querySelectorAll(sel));
        if (els.length && !hit) hit = { selector: sel, els };
      } catch {
        invalid.push(sel);
      }
    }
    return {
      step: s.step,
      selector: hit?.selector ?? null,
      matches: hit?.els.length ?? 0,
      visible: !!hit?.els.some(shown),
      onPage: !s.url || href.includes(s.url),
      invalid,
    };
  });
}

export const describeResult = (r: StepResult): string =>
  `Step ${r.step}: ${!r.onPage ? "on another page" : r.selector ? `${r.selector} - ${r.matches} match${r.matches === 1 ? "" : "es"}${r.visible ? "" : " (hidden)"}` : "no selector matched"}${r.invalid.length ? `; invalid: ${r.invalid.join(", ")}` : ""}`;

/** Waits for the page to render (SPAs), resolves, reports in the toolbar and posts the results to the opener. */
export async function runCheck(req: CheckRequest, note: (t: string) => void, waitMs = 1500): Promise<StepResult[]> {
  note("Checking guide selectors on this page...");
  await new Promise((r) => setTimeout(r, waitMs));
  const results = resolveSteps(req);
  note(results.map(describeResult).join("\n") || "The guide has no anchored steps");
  try {
    (window.opener as Window | null)?.postMessage({ type: CHECK_MESSAGE, url: location.href, results }, req.origin);
  } catch {
    /* opener gone or cross-origin restrictions: the toolbar panel still shows the results */
  }
  return results;
}
