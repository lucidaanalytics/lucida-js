/** Hosts match exactly, or as a suffix when they start with a dot (`.example.com`). */
function hostMatches(hosts: readonly string[], host: string): boolean {
  return hosts.some((h) => {
    const x = h.toLowerCase();
    return x.startsWith(".") ? host.endsWith(x) : host === x;
  });
}

const hostOf = (url: string): string | undefined => /^[a-z][a-z0-9+.-]*:\/\/([^/:?#]+)/i.exec(url)?.[1]?.toLowerCase();

/**
 * `X-Lucida-Distinct-Id` / `X-Lucida-Session-Id` for requests to your own backend hosts so server events join this
 * device's session. Never for the Lucida api host, and only while analytics consent is granted.
 * Servers must treat these headers as client-controlled, never as authentication.
 * The same requests carry W3C `baggage: lucida.session_id=<id>` (merged into the app's own baggage) so Watchtower links its
 * spans, network timings and logs to this session: the Watchtower seam, Lucida itself captures no network or log data.
 */
export function tracingHeaders(
  hosts: readonly string[],
  apiHost: string,
  consent: () => boolean,
  ids: () => { distinctId: string; sessionId: string },
): (url: string, baggage?: string | null) => Record<string, string> {
  const api = hostOf(apiHost);
  return (url, baggage) => {
    const host = hostOf(url);
    if (!host || !hosts.length || host === api || !hostMatches(hosts, host) || !consent()) return {};
    const i = ids();
    return { "X-Lucida-Distinct-Id": i.distinctId, "X-Lucida-Session-Id": i.sessionId, baggage: withBaggage(baggage, i.sessionId) };
  };
}

/** `lucida.session_id=<id>` appended to `existing` W3C baggage, replacing a stale Lucida entry. */
export function withBaggage(existing: string | null | undefined, sessionId: string): string {
  const kept = (existing ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("lucida.session_id="));
  return [...kept, `lucida.session_id=${sessionId}`].join(",");
}

/** A fetch that adds the tracing headers when the target host matches; everything else passes through untouched. */
export function tracedFetch(fetchImpl: typeof fetch, headersFor: (url: string, baggage?: string | null) => Record<string, string>): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers ?? (typeof input === "object" && "headers" in input ? input.headers : undefined));
    const extra = headersFor(url, headers.get("baggage"));
    if (!Object.keys(extra).length) return fetchImpl(input, init);
    for (const [k, v] of Object.entries(extra)) headers.set(k, v);
    return fetchImpl(input, { ...init, headers });
  }) as typeof fetch;
}
