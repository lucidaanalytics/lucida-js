import { gunzipSync } from "node:zlib";

export interface Posted {
  url: string;
  chunk: { api_key: string; session_id: string; window_id: string; seq: number; events: Array<{ type: number; data?: unknown }> };
  raw: string;
}

export function decode(url: string, body: Uint8Array): Posted {
  const raw = gunzipSync(body).toString("utf8");
  return { url, chunk: JSON.parse(raw), raw };
}

/** fetch stub: /v1/config answers `config`, /v1/replay is captured (gunzipped), anything else 404. */
export function replayFetch(config: unknown = {}, replayStatus: () => number = () => 200) {
  const posts: Posted[] = [];
  const urls: string[] = [];
  const fn = (async (url: string, init?: RequestInit) => {
    urls.push(url);
    if (url.includes("/v1/config")) return new Response(JSON.stringify(config), { status: 200 });
    if (url.includes("/v1/replay")) {
      const status = replayStatus();
      if (status === 200) posts.push(decode(url, init?.body as Uint8Array));
      return new Response("{}", { status });
    }
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
  return { fn, posts, urls };
}

export const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function until(cond: () => boolean, ms = 8000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await wait(20);
}
