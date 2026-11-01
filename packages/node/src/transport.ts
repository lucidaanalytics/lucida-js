import { promisify } from "node:util";
import { gzip } from "node:zlib";
import type { Transport } from "@lucida/sdk-core";

const gz = promisify(gzip);
/** Bodies under this size are not worth compressing. */
const MIN_GZIP_BYTES = 1024;

export interface NodeTransportOptions {
  fetch: typeof fetch;
  timeoutMs: number;
  headers?: Record<string, string>;
}

/** fetch transport: JSON body, gzip above 1 KB flagged with `?compression=gzip`, per-request timeout. */
export function nodeTransport(o: NodeTransportOptions): Transport {
  return {
    async send(url, body) {
      try {
        const z = body.length >= MIN_GZIP_BYTES ? await gz(body) : undefined;
        const r = await o.fetch(z ? `${url}${url.includes("?") ? "&" : "?"}compression=gzip` : url, {
          method: "POST",
          body: z ?? body,
          headers: { "Content-Type": "application/json", ...o.headers },
          signal: AbortSignal.timeout(o.timeoutMs),
        });
        return { status: r.status };
      } catch {
        return { status: 0 };
      }
    },
  };
}
