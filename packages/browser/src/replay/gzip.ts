import { gzipSync, strToU8 } from "fflate";

/** gzip via CompressionStream when present, else fflate. */
export async function gzipAsync(body: string): Promise<Uint8Array<ArrayBuffer>> {
  if (typeof CompressionStream !== "undefined" && typeof Response !== "undefined") {
    try {
      const s = new Response(body).body?.pipeThrough(new CompressionStream("gzip"));
      if (s) return new Uint8Array(await new Response(s).arrayBuffer());
    } catch {
      /* fall through to fflate */
    }
  }
  return gzipBytes(body);
}

/** Synchronous gzip for the pagehide beacon (sendBeacon cannot wait). */
export function gzipBytes(body: string): Uint8Array<ArrayBuffer> {
  return gzipSync(strToU8(body)) as Uint8Array<ArrayBuffer>;
}
