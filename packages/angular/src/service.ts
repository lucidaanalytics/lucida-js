import { init } from "@lucida-analytics/browser";
import type { BrowserConfig, Client, FlagValue } from "@lucida-analytics/browser";

export type Flags = Record<string, FlagValue>;

/** Anything RxJS, `AsyncPipe` and `toSignal()` can subscribe to (no rxjs dependency here). */
export interface Subscribable<T> {
  subscribe(observer: (value: T) => void): { unsubscribe(): void };
}

export interface LucidaConfig {
  /** An existing client (tests, shared instance). */
  client?: Client;
  apiKey?: string;
  options?: BrowserConfig;
  /** Server-resolved flags for the first render. */
  bootstrapFlags?: Flags;
}

/**
 * Injectable facade over the browser SDK. It is a plain class (no decorators), registered by
 * `provideLucida()`, so it needs no Angular compiler plugin or JIT metadata. The SDK is never
 * touched on the server (no `window`): every call is then a no-op. Angular calls `ngOnDestroy`.
 * Flag changes arrive from SDK callbacks outside Angular's zone; read them through `flags$`
 * with the async pipe (which schedules its own change detection).
 */
export class LucidaService {
  readonly client: Client | null;
  private flags: Flags;
  private readonly listeners = new Set<(f: Flags) => void>();
  private readonly stop: (() => void) | undefined;

  constructor(c: LucidaConfig) {
    this.client =
      c.client ??
      (c.apiKey && typeof window !== "undefined"
        ? init(c.apiKey, { ...c.options, ...(c.bootstrapFlags ? { bootstrap: { ...c.options?.bootstrap, flags: c.bootstrapFlags } } : {}) })
        : null);
    this.flags = c.bootstrapFlags ?? {};
    this.stop = this.client?.onFlags((f) => {
      this.flags = f;
      this.listeners.forEach((l) => l(f));
    });
  }

  /** All flags; emits the current value on subscribe, then on every reload. */
  readonly flags$: Subscribable<Flags> = {
    subscribe: (observer) => {
      this.listeners.add(observer);
      observer(this.flags);
      return { unsubscribe: () => void this.listeners.delete(observer) };
    },
  };

  /** One flag's value, emitting only when it changes. */
  flag$(key: string): Subscribable<FlagValue | undefined> {
    return {
      subscribe: (observer) => {
        let last: FlagValue | undefined | symbol = Symbol();
        return this.flags$.subscribe((f) => {
          if (f[key] === last) return;
          last = f[key];
          observer(f[key]);
        });
      },
    };
  }

  capture(event: string, props?: Parameters<Client["capture"]>[1]): void {
    this.client?.capture(event, props);
  }
  identify(...a: Parameters<Client["identify"]>): void {
    this.client?.identify(...a);
  }
  reset(): void {
    this.client?.reset();
  }
  setConsent(u: Parameters<Client["setConsent"]>[0]): void {
    this.client?.setConsent(u);
  }
  getFlag(key: string): FlagValue | undefined {
    return this.client?.getFlag(key);
  }
  isFeatureEnabled(key: string): boolean {
    return this.client?.isFeatureEnabled(key) ?? false;
  }
  /** Recording control; inert on the server. */
  get replay(): Client["replay"] | undefined {
    return this.client?.replay;
  }

  ngOnDestroy(): void {
    this.stop?.();
    this.listeners.clear();
  }
}
