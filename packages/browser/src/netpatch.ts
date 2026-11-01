/**
 * Adds request headers to outgoing fetch and XHR calls. `decorate` sees the absolute-or-relative URL and a
 * Headers object (prefilled for fetch, empty for XHR, whose existing headers cannot be read) and sets what it wants.
 * Returns the undo function. Shared by the Watchtower correlation and the tracing-headers modules.
 */
export function patchRequests(decorate: (url: string, headers: Headers) => void): () => void {
  const realFetch = window.fetch;
  window.fetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
    const url = input instanceof Request ? input.url : String(input);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const before = [...headers.entries()].join("|");
    decorate(url, headers);
    if ([...headers.entries()].join("|") === before) return realFetch.call(this, input, init);
    return realFetch.call(this, input, { ...init, headers });
  } as typeof fetch;

  const proto = XMLHttpRequest.prototype;
  const { open, send } = proto;
  const urls = new WeakMap<XMLHttpRequest, string>();
  proto.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    urls.set(this, String(url));
    return (open as (...a: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof open;
  proto.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    const url = urls.get(this);
    if (url) {
      const headers = new Headers();
      decorate(url, headers);
      headers.forEach((v, k) => this.setRequestHeader(k, v));
    }
    return send.call(this, body);
  };

  return () => {
    window.fetch = realFetch;
    proto.open = open;
    proto.send = send;
  };
}
