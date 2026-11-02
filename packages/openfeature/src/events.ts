/** OpenFeature provider event types (structural copy of the spec's names). */
export type ProviderEventType =
  | "PROVIDER_READY"
  | "PROVIDER_ERROR"
  | "PROVIDER_CONFIGURATION_CHANGED"
  | "PROVIDER_STALE"
  | "PROVIDER_CONTEXT_CHANGED";

export interface EventDetails {
  message?: string;
  flagsChanged?: string[];
  eventMetadata?: Record<string, string | number | boolean>;
}

export type EventHandler = (details?: EventDetails) => void;

/**
 * Shaped like the `events` emitter OpenFeature SDKs read from a provider (`addHandler` / `removeHandler` /
 * `removeAllHandlers` / `getHandlers` / `emit`), without depending on them.
 */
export class ProviderEvents {
  private readonly handlers = new Map<ProviderEventType, EventHandler[]>();

  addHandler(type: ProviderEventType, handler: EventHandler): void {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]);
  }
  removeHandler(type: ProviderEventType, handler: EventHandler): void {
    this.handlers.set(type, (this.handlers.get(type) ?? []).filter((h) => h !== handler));
  }
  removeAllHandlers(type?: ProviderEventType): void {
    if (type) this.handlers.delete(type);
    else this.handlers.clear();
  }
  getHandlers(type: ProviderEventType): EventHandler[] {
    return this.handlers.get(type) ?? [];
  }
  emit(type: ProviderEventType, details?: EventDetails): void {
    for (const h of this.getHandlers(type)) {
      try {
        h(details);
      } catch {
        /* a failing handler must not break the loader */
      }
    }
  }
}

/** Client hooks the providers use to turn definition reloads into events. Either callback may fire any time. */
export interface FlagsListener {
  changed(): void;
  stale(error?: unknown): void;
}

/**
 * State machine over reload signals: the first `changed` is silent (the SDK announces READY when initialize
 * resolves), later ones are CONFIGURATION_CHANGED, `stale` after a success is STALE and the next `changed`
 * recovers with READY; `stale` before any success is ERROR.
 */
export function listenerFor(events: ProviderEvents): FlagsListener & { loaded(): boolean } {
  let loaded = false;
  let isStale = false;
  return {
    loaded: () => loaded,
    changed() {
      const first = !loaded;
      const recovered = isStale;
      loaded = true;
      isStale = false;
      if (recovered) events.emit("PROVIDER_READY", { message: "flag definitions reloaded" });
      else if (!first) events.emit("PROVIDER_CONFIGURATION_CHANGED", { message: "flag definitions changed" });
    },
    stale(error) {
      const message = error instanceof Error ? error.message : error === undefined ? "flags unavailable" : String(error);
      if (!loaded) events.emit("PROVIDER_ERROR", { message });
      else if (!isStale) {
        isStale = true;
        events.emit("PROVIDER_STALE", { message });
      }
    },
  };
}
