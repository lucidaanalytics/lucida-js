import type { Host, WatchtowerLike } from "../types.js";

/** Watchtower `error` hook payload (needs `@watchtowerobservability/browser` 0.5.0 or later). */
export interface WtErrorEvent {
  event_id: string;
  trace_id?: string;
  message: string;
  handled: boolean;
  issue_id?: string;
}

/** Watchtower `vital` hook payload. */
export interface WtVital {
  name: "LCP" | "INP" | "CLS" | "FCP" | "TTFB";
  value: number;
  rating: "good" | "needs-improvement" | "poor";
  navigation_id: string;
  url: string;
  final: boolean;
}


const RANK = { good: 0, "needs-improvement": 1, poor: 2 } as const;
const RATINGS = ["good", "needs-improvement", "poor"] as const;
const FIELD = { LCP: "lcp_ms", INP: "inp_ms", CLS: "cls", FCP: "fcp_ms", TTFB: "ttfb_ms" } as const;

interface Page {
  props: Record<string, unknown>;
  worst: number;
  final: Set<string>;
}

/** Find the Watchtower client now or when `watchtower:ready` fires; `use` runs once with a client that has `on`. */
function withClient(host: Host, use: (wt: WatchtowerLike) => () => void): () => void {
  const find = () => host.config.watchtower?.client ?? (globalThis as { watchtower?: WatchtowerLike }).watchtower;
  let off: (() => void) | undefined;
  const attempt = (): void => {
    const wt = find();
    if (off || typeof wt?.on !== "function") return;
    off = use(wt);
  };
  attempt();
  window.addEventListener("watchtower:ready", attempt);
  return () => (window.removeEventListener("watchtower:ready", attempt), off?.());
}

/**
 * Feature-detected Watchtower hooks (needs `@watchtowerobservability/browser` 0.5.0 or later). With `wt.on` present: each Watchtower
 * error becomes `$exception_seen`, and each page view's vitals become one `$web_vitals`. Nothing is subscribed until
 * analytics consent is held; absent hooks do nothing. Returns the teardown.
 */
export function watchtowerHooks(host: Host): () => void {
  let stop: (() => void) | undefined;
  let closed = false;
  host.whenConsented(() => {
    if (!closed) stop = withClient(host, (wt) => subscribe(host, wt));
  });
  return () => ((closed = true), stop?.());
}

function subscribe(host: Host, wt: WatchtowerLike): () => void {
  const pages = new Map<string, Page>();
  const sent = new Set<string>();
  const emit = (id: string): void => {
    const p = pages.get(id);
    pages.delete(id);
    if (!p || sent.has(id)) return;
    sent.add(id);
    host.client.capture("$web_vitals", { ...p.props, rating_worst: RATINGS[p.worst] });
  };

  const onError = (e: WtErrorEvent): void => {
    host.client.capture("$exception_seen", {
      wt_event_id: e.event_id,
      wt_trace_id: e.trace_id,
      message: String(e.message ?? "").slice(0, 300),
      handled: e.handled,
      ...(e.issue_id ? { wt_issue_id: e.issue_id } : {}),
    });
  };
  const onVital = (v: WtVital): void => {
    const field = FIELD[v.name];
    if (!field || sent.has(v.navigation_id)) return;
    for (const id of [...pages.keys()]) if (id !== v.navigation_id) emit(id); // a new page view ends the old ones
    const p = pages.get(v.navigation_id) ?? { props: { $current_url: v.url }, worst: 0, final: new Set<string>() };
    pages.set(v.navigation_id, p);
    p.props[field] = v.value;
    p.worst = Math.max(p.worst, RANK[v.rating] ?? 0);
    if (v.final) p.final.add(v.name);
    if (p.final.size === 5) emit(v.navigation_id);
  };

  const safe =
    <T>(fn: (x: T) => void) =>
    (x: T): void => {
      try {
        fn(x);
      } catch {
        /* a hook never throws into the host app */
      }
    };
  const offs = [wt.on?.("error", safe(onError) as never), wt.on?.("vital", safe(onVital) as never)];
  host.onUnload(() => [...pages.keys()].forEach(emit));
  return () => offs.forEach((f) => f?.());
}
