/** Result of one transport attempt. status 0 means a network failure. */
export interface TransportResult {
  status: number;
  /** The response's Retry-After in ms (429/503), when the transport can read it. The queue waits at least this long (capped at 60 s). */
  retryAfterMs?: number;
}

export interface SendOptions {
  /** Fire-and-forget delivery that survives page unload (navigator.sendBeacon). */
  beacon?: boolean;
}

/** Port: how bytes leave the SDK. Adapters live in the platform SDKs. */
export interface Transport {
  send(url: string, body: string, opts?: SendOptions): Promise<TransportResult>;
}

/** Port: synchronous string key/value persistence (cookie, localStorage, memory). */
export interface Storage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export type Props = Record<string, unknown>;

/** Wire event v1 (docs/plan/03-data-model.md). */
export interface WireEvent {
  uuid: string;
  event: string;
  /** Omitted in cookieless mode until identify(): the gateway then derives the daily cookieless id. */
  distinct_id?: string;
  timestamp: string;
  properties: Props;
  $set?: Props;
  $set_once?: Props;
  $unset?: string[];
  $groups?: Record<string, string>;
}

export interface Clock {
  now(): number;
}
