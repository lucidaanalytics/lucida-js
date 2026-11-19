import { LIB_VERSION } from "./client.js";

export interface CaptureImmediateInput {
  event: string;
  distinctId: string;
  properties?: Record<string, unknown>;
  $set?: Record<string, unknown>;
  uuid?: string;
  timestamp?: Date | string;
}
export interface CaptureImmediateOptions {
  apiKey?: string;
  host?: string;
}
export interface CaptureImmediateResult {
  ok: boolean;
  status?: number;
  error?: string;
}

const TIMEOUT_MS = 5000;

/**
 * Send one event now with a single POST: no client, no queue, no retries, no timers left behind. Never throws.
 * Key from `opts.apiKey` or `LUCIDA_SECRET_KEY`; host from `opts.host`, `LUCIDA_HOST`, else Lucida cloud.
 */
export async function captureImmediate(i: CaptureImmediateInput, opts: CaptureImmediateOptions = {}): Promise<CaptureImmediateResult> {
  const apiKey = opts.apiKey ?? process.env.LUCIDA_SECRET_KEY;
  if (!apiKey) return { ok: false, error: "no api key (opts.apiKey or LUCIDA_SECRET_KEY)" };
  const host = (opts.host ?? process.env.LUCIDA_HOST ?? "https://capture.lucidace.com").replace(/\/+$/, "");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const e = {
      uuid: i.uuid ?? crypto.randomUUID(),
      event: i.event,
      distinct_id: i.distinctId,
      timestamp: i.timestamp instanceof Date ? i.timestamp.toISOString() : (i.timestamp ?? new Date().toISOString()),
      properties: { ...i.properties, $lib: "lucida-node", $lib_version: LIB_VERSION },
      ...(i.$set ? { $set: i.$set } : {}),
    };
    const r = await fetch(`${host}/v1/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: apiKey, batch: [e], sent_at: new Date().toISOString() }),
      signal: ctl.signal,
    });
    return r.ok ? { ok: true, status: r.status } : { ok: false, status: r.status, error: `status ${r.status}` };
  } catch (err) {
    return { ok: false, error: ctl.signal.aborted ? "timeout" : err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}
