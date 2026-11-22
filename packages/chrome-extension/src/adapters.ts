import type { Props, Storage, Transport } from "@lucida-analytics/sdk-core";
import type { StorageAreaLike } from "./chrome.js";

const PREFIX = "lc_";

/**
 * chrome.storage.local as the core's synchronous Storage: every `lc_*` key is read once at start, reads are served from
 * memory and writes go behind. Only the background worker writes, so there is no cross-context race.
 */
export function extensionStorage(area: StorageAreaLike): { storage: Storage; ready: Promise<void> } {
  const m = new Map<string, string>();
  const ready = area.get(null).then(
    (all) => {
      for (const [k, v] of Object.entries(all)) if (k.startsWith(PREFIX) && typeof v === "string" && !m.has(k)) m.set(k, v);
    },
    () => undefined,
  );
  return {
    ready,
    storage: {
      get: (k) => m.get(k) ?? null,
      set(k, v) {
        m.set(k, v);
        void area.set({ [k]: v }).catch(() => undefined);
      },
      remove(k) {
        m.delete(k);
        void area.remove(k).catch(() => undefined);
      },
    },
  };
}

export function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v), remove: (k) => void m.delete(k) };
}

/** fetch-based transport; status 0 on network failure (retried by the queue, parked by the offline store). */
export function fetchTransport(fetchImpl: typeof fetch): Transport {
  return {
    async send(url, body) {
      try {
        const r = await fetchImpl(url, { method: "POST", body, headers: { "Content-Type": "text/plain;charset=UTF-8" }, keepalive: true });
        return { status: r.status };
      } catch {
        return { status: 0 };
      }
    },
  };
}

/** Drops caller-supplied `$lc_*` keys: they are reserved for the gateway and never sent by the client. */
export function stripReserved(props: Props | undefined): Props {
  const out: Props = {};
  if (props) for (const [k, v] of Object.entries(props)) if (!k.startsWith("$lc_")) out[k] = v;
  return out;
}

const OS: Record<string, string> = { mac: "Mac OS X", win: "Windows", linux: "Linux", cros: "Chrome OS", android: "Android", openbsd: "OpenBSD", fuchsia: "Fuchsia" };
export const osName = (os: string | undefined): string | undefined => (os ? (OS[os] ?? os) : undefined);

/** `$browser` / `$browser_version` from User-Agent Client Hints (Chromium), else the user agent string. */
export function browserInfo(nav: { userAgent?: string; userAgentData?: { brands?: { brand: string; version: string }[] } } | undefined): Props {
  const brands = nav?.userAgentData?.brands?.filter((b) => !/not.?a.?brand|chromium/i.test(b.brand)) ?? [];
  const b = brands[0] ?? nav?.userAgentData?.brands?.find((x) => /chromium/i.test(x.brand));
  if (b) return { $browser: b.brand === "Chromium" ? "Chrome" : b.brand.replace(/^Google /, ""), $browser_version: b.version };
  const ua = nav?.userAgent ?? "";
  const m = /(Firefox|Edg|OPR|Chrome)\/(\d+)/.exec(ua);
  if (!m) return {};
  const name = { Edg: "Microsoft Edge", OPR: "Opera" }[m[1]!] ?? m[1]!;
  return { $browser: name, $browser_version: m[2] };
}
