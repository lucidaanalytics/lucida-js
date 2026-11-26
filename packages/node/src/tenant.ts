import { sha256Hex } from "@lucida-analytics/sdk-core";

/**
 * Tenant analytics (https://lucidace.com/help/tenant-analytics): aggregate, cookieless events a platform sends
 * from its own server for one of its tenants (creator, shop). No person, no distinct id, no IP: send only the
 * fields below.
 */
export interface TenantEvent {
  tenantId: string;
  /** `$pageview`, `click`, `$exposure`, or your own name. */
  event: string;
  /** Page URL; the query string and fragment are dropped by Lucida. */
  url?: string;
  /** Referrer URL or host; only the host is kept. */
  referrer?: string;
  /** ISO 3166 alpha-2, e.g. from your CDN's country header. */
  country?: string;
  uaClass?: "desktop" | "mobile" | "tablet" | "bot" | "other";
  /** What was clicked, e.g. a link id. */
  target?: string;
  /** A number to sum, e.g. revenue. */
  value?: number;
  /** Tenant experiment id and the variant from `assignVariant` (exposures and conversions). */
  experimentId?: string;
  variant?: string;
  /** Dedupe key for retries (a UUID); one is made when absent. */
  uuid?: string;
  timestamp?: Date | string;
}

export interface TenantEventOptions {
  /** Secret key; default `LUCIDA_SECRET_KEY`. */
  apiKey?: string;
  /** Project id; default `LUCIDA_PROJECT_ID`. */
  projectId?: string;
  /** Capture host; default `LUCIDA_HOST`, else Lucida cloud. */
  host?: string;
}

export interface TenantEventResult {
  ok: boolean;
  status?: number;
  accepted?: number;
  rejected?: { index: number; reason: string }[];
  error?: string;
}

const TIMEOUT_MS = 5000;

function wire(e: TenantEvent) {
  return {
    tenant_id: e.tenantId,
    event: e.event,
    url: e.url,
    referrer: e.referrer,
    country: e.country,
    ua_class: e.uaClass,
    target: e.target,
    value: e.value,
    experiment_id: e.experimentId,
    variant: e.variant,
    uuid: e.uuid ?? crypto.randomUUID(),
    timestamp: e.timestamp instanceof Date ? e.timestamp.toISOString() : e.timestamp,
  };
}

/**
 * Send tenant events (one or up to 1000) with a single POST to `/v1/projects/{id}/tenant-events`. Never throws.
 * Call it from your route handler; nothing runs in the visitor's browser.
 */
export async function tenantEvent(events: TenantEvent | TenantEvent[], opts: TenantEventOptions = {}): Promise<TenantEventResult> {
  const apiKey = opts.apiKey ?? process.env.LUCIDA_SECRET_KEY;
  const projectId = opts.projectId ?? process.env.LUCIDA_PROJECT_ID;
  if (!apiKey) return { ok: false, error: "no api key (opts.apiKey or LUCIDA_SECRET_KEY)" };
  if (!projectId) return { ok: false, error: "no project id (opts.projectId or LUCIDA_PROJECT_ID)" };
  const host = (opts.host ?? process.env.LUCIDA_HOST ?? "https://capture.lucidace.com").replace(/\/+$/, "");
  const list = Array.isArray(events) ? events : [events];
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${host}/v1/projects/${encodeURIComponent(projectId)}/tenant-events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ events: list.map(wire) }),
      signal: ctl.signal,
    });
    if (!r.ok) return { ok: false, status: r.status, error: `status ${r.status}` };
    const body = (await r.json().catch(() => ({}))) as { accepted?: number; rejected?: { index: number; reason: string }[] };
    return { ok: true, status: r.status, accepted: body.accepted, rejected: body.rejected ?? [] };
  } catch (err) {
    return { ok: false, error: ctl.signal.aborted ? "timeout" : err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/** A tenant experiment as returned by `GET /v1/projects/{p}/tenant-experiments/{id}` (only these fields are read). */
export interface TenantExperimentDef {
  id: string;
  variants: { key: string; weight?: number }[];
  status?: string;
}

/** The documented bucket in [0,1): first 13 hex chars of sha256(`<experiment id>.<bucket id>`) over 16^13. */
export function tenantBucket(experimentId: string, bucketId: string): number {
  return parseInt(sha256Hex(`${experimentId}.${bucketId}`).slice(0, 13), 16) / 2 ** 52;
}

/**
 * Pick a variant locally, with zero network calls: the first variant whose cumulative normalized weight exceeds
 * `tenantBucket(experiment.id, bucketId)`. `bucketId` is any stable opaque string you derive (e.g. a salted hash of
 * your own visitor key); Lucida never sees how. A stopped experiment, or one without variants, returns the first
 * variant (the control) or undefined.
 */
export function assignVariant(bucketId: string, experiment: TenantExperimentDef): string | undefined {
  const vs = experiment.variants ?? [];
  if (vs.length === 0) return undefined;
  if (experiment.status === "stopped") return vs[0]!.key;
  const total = vs.reduce((s, v) => s + (v.weight ?? 1), 0);
  const h = tenantBucket(experiment.id, bucketId);
  let acc = 0;
  for (const v of vs) {
    acc += (v.weight ?? 1) / total;
    if (h < acc) return v.key;
  }
  return vs[vs.length - 1]!.key;
}
