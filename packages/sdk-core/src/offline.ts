import type { Storage, Transport, TransportResult } from "./ports.js";

export interface OfflineOptions {
  key?: string;
  /** Oldest batches are dropped beyond either bound. */
  maxBatches?: number;
  maxBytes?: number;
  retryMs?: number;
  isOnline?: () => boolean;
}

export type OfflineTransport = Transport & { drain(): Promise<void> };

interface Stored {
  url: string;
  body: string;
}

/**
 * Transport decorator: batches that cannot be delivered (network failure or offline) are kept in
 * storage (bounded) and replayed by drain() - call it on the `online` event and at startup. Events
 * only reach the transport after consent, so persisting them respects the consent gate. Delivery
 * is at-least-once; event uuids dedupe server-side.
 */
export function offlineTransport(inner: Transport, storage: Storage, o: OfflineOptions = {}): OfflineTransport {
  const key = o.key ?? "lc_offline";
  const maxBatches = o.maxBatches ?? 50;
  const maxBytes = o.maxBytes ?? 1_000_000;
  const online = o.isOnline ?? (() => true);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let draining: Promise<void> | undefined;

  const read = (): Stored[] => {
    try {
      const v: unknown = JSON.parse(storage.get(key) ?? "[]");
      return Array.isArray(v) ? (v as Stored[]) : [];
    } catch {
      return [];
    }
  };
  const write = (items: Stored[]): void => {
    let bytes = items.reduce((n, i) => n + i.body.length, 0);
    while (items.length > maxBatches || (bytes > maxBytes && items.length > 1)) bytes -= (items.shift() as Stored).body.length;
    if (items.length) storage.set(key, JSON.stringify(items));
    else storage.remove(key);
  };
  const park = (items: Stored[]): void => {
    write([...read(), ...items]);
    timer ??= setTimeout(() => {
      timer = undefined;
      void t.drain();
    }, o.retryMs ?? 30_000);
  };

  const t: OfflineTransport = {
    async send(url, body, opts): Promise<TransportResult> {
      if (!online()) {
        park([{ url, body }]);
        return { status: 200 };
      }
      const r = await inner.send(url, body, opts);
      if (r.status !== 0) return r;
      park([{ url, body }]);
      return { status: 200 };
    },
    drain() {
      draining ??= (async () => {
        const items = read();
        if (!items.length || !online()) return;
        storage.remove(key);
        const failed: Stored[] = [];
        for (const [i, it] of items.entries()) {
          if ((await inner.send(it.url, it.body)).status === 0) {
            failed.push(...items.slice(i));
            break;
          }
        }
        if (failed.length) park(failed);
      })().finally(() => {
        draining = undefined;
      });
      return draining;
    },
  };
  return t;
}
