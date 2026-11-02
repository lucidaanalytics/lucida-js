import type { Transport } from "@lucida-analytics/sdk-core";

/** Bodies under this size are not worth compressing. */
const MIN_GZIP_BYTES = 1024;

async function gzip(body: string): Promise<Uint8Array<ArrayBuffer> | undefined> {
  if (typeof CompressionStream === "undefined" || typeof Response === "undefined") return undefined;
  try {
    const stream = new Response(body).body?.pipeThrough(new CompressionStream("gzip"));
    return stream ? new Uint8Array(await new Response(stream).arrayBuffer()) : undefined;
  } catch {
    return undefined;
  }
}

export interface TransportOptions {
  compress?: boolean;
  /** Extra headers on every ingest request. Any header beyond the defaults triggers a CORS preflight to the ingest host. */
  headers?: Record<string, string> | undefined;
  /** Called when a request fails (status 0) or the server answers with an error status. */
  onError?: ((e: { url: string; status: number }) => void) | undefined;
  /** Never use sendBeacon (some proxies and ad blockers break it); unload flushes use keepalive fetch instead. */
  disableBeacon?: boolean | undefined;
}

/**
 * fetch + sendBeacon transport. text/plain bodies avoid CORS preflights (gateway accepts it).
 * Large bodies are gzipped when CompressionStream exists and flagged with `?compression=gzip`
 * (a query param, not Content-Encoding, so no preflight; go/gateway/body.go honours both).
 * Beacons are sent uncompressed because sendBeacon must be synchronous.
 */
export function browserTransport(fetchImpl: typeof fetch, o: TransportOptions = {}): Transport {
  const compress = o.compress ?? true;
  const fail = (url: string, status: number): { status: number } => {
    o.onError?.({ url, status });
    return { status };
  };
  return {
    async send(url, body, opts) {
      if (opts?.beacon && !o.disableBeacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
        const ok = navigator.sendBeacon(url, new Blob([body], { type: "text/plain" }));
        return ok ? { status: 200 } : fail(url, 0);
      }
      try {
        const z = compress && body.length >= MIN_GZIP_BYTES ? await gzip(body) : undefined;
        const r = await fetchImpl(z ? `${url}${url.includes("?") ? "&" : "?"}compression=gzip` : url, {
          method: "POST",
          body: z ?? body,
          headers: { ...o.headers, "Content-Type": "text/plain;charset=UTF-8" },
          credentials: "omit",
          keepalive: (z?.length ?? body.length) < 60_000,
        });
        return r.status >= 400 ? fail(url, r.status) : { status: r.status };
      } catch {
        return fail(url, 0);
      }
    },
  };
}

export const noopTransport: Transport = { send: async () => ({ status: 200 }) };
