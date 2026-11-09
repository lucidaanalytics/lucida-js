import { matches, redactBody, redactHeaders, truncate } from "./redact.js";
import type { Pattern } from "./redact.js";

/** Headers and body of one side; each only when captured (JSON drops undefined). */
export interface NetworkPart {
  headers?: Record<string, string> | undefined;
  body?: string | undefined;
}

export interface NetworkEntry {
  method: string;
  url: string;
  /** 0 = the request failed before a response (network error, CORS, abort). */
  status: number;
  /** Epoch ms. */
  start: number;
  duration: number;
  size?: number | undefined;
  type: "fetch" | "xhr";
  error?: string;
  req?: NetworkPart | undefined;
  res?: NetworkPart | undefined;
}

export interface NetworkOptions {
  /** Record request/response headers (Authorization, Cookie, Set-Cookie and similar are always redacted). Default false. */
  headers?: boolean;
  /** Record request/response bodies (password-like JSON/form fields always redacted, 4 KB cap). Default false. */
  body?: boolean;
  /** Requests whose URL matches are never recorded (string = substring). */
  deny?: Pattern[];
  /** When set, only matching URLs are recorded. Deny wins. */
  allow?: Pattern[];
  /** Last look at a built entry, after the built-in redaction. Return null to drop it. */
  redact?: (e: NetworkEntry) => NetworkEntry | null;
}

type Hdrs = Record<string, string>;
const fromHeaders = (h: Headers): Hdrs => {
  const o: Hdrs = {};
  h.forEach((v, k) => (o[k] = v));
  return o;
};
const fromRaw = (raw: string): Hdrs => {
  const o: Hdrs = {};
  for (const line of raw.trim().split(/[\r\n]+/)) {
    const i = line.indexOf(":");
    if (i > 0) o[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return o;
};
const abs = (u: string): string => {
  try {
    return new URL(u, location.href).href;
  } catch {
    return u;
  }
};

/**
 * Records fetch and XMLHttpRequest calls into the recording. `own(url)` is true for the SDK's own requests
 * (never recorded). `emit` receives only finished, redacted entries. Returns the undo function.
 */
export function captureNetwork(emit: (e: NetworkEntry) => void, o: NetworkOptions, own: (absUrl: string) => boolean): () => void {
  const keep = (e: NetworkEntry): void => {
    try {
      if (own(e.url) || matches(o.deny, e.url) || (o.allow && !matches(o.allow, e.url))) return;
      if (!o.headers) (delete e.req?.headers, delete e.res?.headers);
      if (!o.body) (delete e.req?.body, delete e.res?.body);
      if (e.req && !e.req.headers && !e.req.body) delete e.req;
      if (e.res && !e.res.headers && !e.res.body) delete e.res;
      const out = o.redact ? o.redact(e) : e;
      if (out) emit(out);
    } catch {
      /* a throwing redact hook drops the entry, never the request */
    }
  };
  const ignored = (u: string): boolean => own(abs(u)) || matches(o.deny, abs(u)) || (!!o.allow && !matches(o.allow, abs(u)));

  const realFetch = window.fetch;
  window.fetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const p = realFetch.call(this, input, init);
    try {
      const url = abs(input instanceof Request ? input.url : String(input));
      if (ignored(url)) return p;
      const start = Date.now();
      const t0 = performance.now();
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      const req = o.headers || o.body
        ? { headers: redactHeaders(fromHeaders(new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)))), body: redactBody(init?.body) }
        : undefined;
      const done = (e: Partial<NetworkEntry>): void =>
        keep({ method, url, status: 0, start, duration: Math.round(performance.now() - t0), type: "fetch", req, ...e });
      p.then(
        (res) => {
          const size = Number(res.headers.get("content-length")) || undefined;
          const base = { status: res.status, size, res: o.headers ? { headers: redactHeaders(fromHeaders(res.headers)) } : undefined };
          if (!o.body) return done(base);
          res.clone().text().then(
            (t) => done({ ...base, size: size ?? t.length, res: { ...base.res, body: redactBody(t) } }),
            () => done(base),
          );
        },
        (err: unknown) => done({ error: truncate(String((err as Error)?.message ?? err), 200) }),
      );
    } catch {
      /* recording must never break the page's request */
    }
    return p;
  } as typeof fetch;
  const mineFetch = window.fetch;

  interface Xhr { method: string; url: string; headers: Hdrs; body?: unknown }
  const proto = XMLHttpRequest.prototype;
  const { open, send, setRequestHeader } = proto;
  const state = new WeakMap<XMLHttpRequest, Xhr>();
  proto.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    state.set(this, { method: method.toUpperCase(), url: abs(String(url)), headers: {} });
    return (open as (...a: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof open;
  proto.setRequestHeader = function (this: XMLHttpRequest, k: string, v: string) {
    const s = state.get(this);
    if (s) s.headers[k.toLowerCase()] = v;
    return setRequestHeader.call(this, k, v);
  };
  proto.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    const s = state.get(this);
    if (s && !ignored(s.url)) {
      const start = Date.now();
      const t0 = performance.now();
      this.addEventListener("loadend", () => {
        try {
          const text = o.body && (this.responseType === "" || this.responseType === "text") ? this.responseText : undefined;
          keep({
            method: s.method,
            url: s.url,
            status: this.status,
            start,
            duration: Math.round(performance.now() - t0),
            size: Number(this.getResponseHeader("content-length")) || text?.length || undefined,
            type: "xhr",
            ...(this.status === 0 && { error: "network error" }),
            req: { headers: redactHeaders(s.headers), body: redactBody(body) },
            res: { headers: redactHeaders(fromRaw(this.getAllResponseHeaders())), body: text === undefined ? undefined : redactBody(text) },
          });
        } catch {
          /* ignore */
        }
      });
    }
    return send.call(this, body);
  };

  return () => {
    if (window.fetch === mineFetch) window.fetch = realFetch; // only if still ours
    proto.open = open;
    proto.send = send;
    proto.setRequestHeader = setRequestHeader;
  };
}
