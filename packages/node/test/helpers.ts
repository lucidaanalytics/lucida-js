import { gunzipSync } from "node:zlib";
import type { FlagDefinition } from "@lucida-analytics/sdk-core";

export interface Req {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  raw: Buffer | undefined;
}

export interface FakeOpts {
  defs?: FlagDefinition[];
  etag?: string;
  /** Remote /v1/flags response body. */
  remote?: unknown;
  /** Remote-config payloads served by GET /v1/flags/{key}/remote-config (missing key = 404). */
  remoteConfigs?: Record<string, unknown>;
  defsStatus?: number;
}

/** fetch stub standing in for the gateway: records requests, serves definitions / flags / batch. */
export function fakeGateway(o: FakeOpts = {}) {
  const reqs: Req[] = [];
  const state = { ...o };
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    let raw: Buffer | undefined;
    let body: unknown;
    if (init?.body !== undefined) {
      raw = Buffer.from(init.body as string | Uint8Array);
      const text = url.includes("compression=gzip") ? gunzipSync(raw).toString() : raw.toString();
      body = JSON.parse(text);
    }
    reqs.push({ url, method: init?.method ?? "GET", headers, body, raw });
    const rc = /\/v1\/flags\/([^/]+)\/remote-config$/.exec(url);
    if (rc) {
      const key = decodeURIComponent(rc[1]!);
      if (!state.remoteConfigs || !(key in state.remoteConfigs)) return new Response("", { status: 404 });
      return new Response(JSON.stringify({ key, enabled: true, payload: state.remoteConfigs[key] }), { status: 200 });
    }
    if (url.includes("/v1/flags/stream")) return new Response("", { status: 404 }); // polling-only fakes
    if (url.includes("/v1/flags/definitions")) {
      if (state.defsStatus) return new Response("", { status: state.defsStatus });
      if (state.etag && headers["If-None-Match"] === state.etag) return new Response(null, { status: 304 });
      return new Response(JSON.stringify({ flags: state.defs ?? [] }), {
        status: 200,
        headers: state.etag ? { ETag: state.etag } : {},
      });
    }
    if (url.includes("/v1/flags")) return new Response(JSON.stringify(state.remote ?? { flags: {} }), { status: 200 });
    return new Response('{"status":1}', { status: 200 });
  }) as typeof fetch;
  const events = () =>
    reqs
      .filter((r) => /\/v1\/(s2s\/)?batch/.test(r.url))
      .flatMap((r) => (r.body as { batch: Array<Record<string, any>> }).batch); // eslint-disable-line -- test helper reads arbitrary event JSON
  return { fetch: fetchImpl, reqs, state, events };
}

export const flag = (key: string, p: Partial<FlagDefinition> = {}): FlagDefinition => ({
  key,
  type: "boolean",
  active: true,
  salt: "s",
  aggregation: { kind: "person" },
  conditions: [{ rollout_pct: 100 }],
  ...p,
});
