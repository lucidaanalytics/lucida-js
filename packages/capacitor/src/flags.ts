import type { Core, FlagValue } from "@lucida/sdk-core";

const CACHE_KEY = "lc_flags";

/** Shape of go/gateway POST /v1/flags: per-flag objects (or bare values); payload is per flag. */
interface FlagOut {
  enabled?: boolean;
  variant?: string;
  value?: FlagValue;
  payload?: unknown;
}

export interface FlagsService {
  get(key: string): FlagValue | undefined;
  payload(key: string): unknown;
  all(): Record<string, FlagValue>;
  reload(): Promise<void>;
}

const norm = (x: FlagOut | FlagValue): FlagValue =>
  typeof x === "object" && x !== null ? (x.value ?? x.variant ?? !!x.enabled) : x;

/**
 * Remote flags (POST /v1/flags) with the last response cached through the core's consent-gated storage, so a cold
 * start has values offline. No request before analytics consent. A read emits `$feature_flag_called` once per value.
 */
export function createFlags(d: { core: Core; fetch: typeof fetch; apiHost: string; apiKey: string; appVersion?: string | undefined }): FlagsService {
  const { core } = d;
  let values: Record<string, FlagValue> = {};
  let payloads: Record<string, unknown> = {};
  let seq = 0;
  const called = new Set<string>();
  try {
    const c = JSON.parse(core.storage.get(CACHE_KEY) ?? "{}") as { values?: Record<string, FlagValue>; payloads?: Record<string, unknown> };
    values = c.values ?? {};
    payloads = c.payloads ?? {};
  } catch {
    /* corrupt cache: start empty */
  }

  const reload = async (): Promise<void> => {
    const mine = ++seq;
    if (!core.hasConsent("analytics")) return;
    try {
      const r = await d.fetch(`${d.apiHost}/v1/flags`, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify({
          api_key: d.apiKey,
          distinct_id: core.distinctId,
          ...(core.anonDistinctId ? { anon_distinct_id: core.anonDistinctId } : {}),
          groups: core.groups ?? {},
          person_properties: {},
          ...(d.appVersion ? { app_version: d.appVersion } : {}),
        }),
      });
      if (!r.ok) return; // keep cached values
      const j = (await r.json()) as { flags?: Record<string, FlagOut | FlagValue>; quota_limited?: boolean };
      if (mine !== seq || j.quota_limited) return;
      const v: Record<string, FlagValue> = {};
      const p: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(j.flags ?? {})) {
        v[k] = norm(x);
        if (typeof x === "object" && x !== null && x.payload !== undefined) p[k] = x.payload;
      }
      values = v;
      payloads = p;
      core.storage.set(CACHE_KEY, JSON.stringify({ values, payloads }));
    } catch {
      /* network failure: keep cached values */
    }
  };

  return {
    get(key) {
      const v = values[key];
      const mark = `${key}=${String(v)}`;
      if (!called.has(mark)) {
        called.add(mark);
        core.capture("$feature_flag_called", { $feature_flag: key, $feature_flag_response: v ?? false });
      }
      return v;
    },
    payload: (key) => payloads[key],
    all: () => ({ ...values }),
    reload,
  };
}
