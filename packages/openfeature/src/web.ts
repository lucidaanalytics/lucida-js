import { listenerFor, ProviderEvents } from "./events.js";
import { splitContext, toDetails } from "./resolve.js";
import type { EvaluationContext, Kind, LucidaDetails, ResolutionDetails } from "./resolve.js";
import type { TrackingEventDetails } from "./server.js";

/** The slice of the browser `Client` from @lucida-analytics/browser the provider uses; optional members degrade when absent. */
export interface WebClient {
  identify(id: string): void;
  reset(): void;
  getFlag(key: string): boolean | string | undefined;
  getFlagPayload(key: string): unknown;
  reloadFlags(): Promise<void>;
  /** Real reason, condition index and request id; without it reasons read as UNKNOWN. */
  getFeatureFlagDetails?(key: string): LucidaDetails | undefined;
  /** Called after flags change (reload, SSE push); returns an unsubscribe. Drives CONFIGURATION_CHANGED. */
  onFeatureFlags?(cb: () => void): () => void;
  capture?(event: string, properties?: Record<string, unknown>): void;
  group?(type: string, key: string, properties?: Record<string, unknown>): void;
  setPersonProperties?(set: Record<string, unknown>): void;
}

/**
 * OpenFeature web (static-context) provider: `await OpenFeature.setContext({ targetingKey })` identifies
 * the visitor, applies groups and person properties, and reloads flags; evaluations are then synchronous
 * reads of the loaded flags.
 */
export class LucidaWebProvider {
  readonly metadata = { name: "lucida-web" } as const;
  readonly runsOn = "client" as const;
  readonly events = new ProviderEvents();
  private readonly listener = listenerFor(this.events);
  private unsubscribe: (() => void) | undefined;

  constructor(private readonly client: WebClient) {
    this.unsubscribe = client.onFeatureFlags?.(() => this.listener.changed());
  }

  private async apply(ctx: EvaluationContext): Promise<void> {
    const c = this.client;
    const { personProperties, groups, groupProperties } = splitContext(ctx);
    if (ctx.targetingKey) c.identify(ctx.targetingKey);
    for (const [type, key] of Object.entries(groups ?? {})) c.group?.(type, key, groupProperties?.[type]);
    if (Object.keys(personProperties).length) c.setPersonProperties?.(personProperties);
    try {
      await c.reloadFlags();
      if (!this.listener.loaded() || !c.onFeatureFlags) this.listener.changed(); // else onFeatureFlags reports it
    } catch (e) {
      this.listener.stale(e);
      if (!this.listener.loaded()) throw e; // first load failed: the SDK reports ERROR; later failures keep the loaded values (STALE)
    }
  }

  initialize(ctx: EvaluationContext = {}): Promise<void> {
    return this.apply(ctx);
  }

  onContextChange(_old: EvaluationContext, next: EvaluationContext): Promise<void> {
    return this.apply(next);
  }

  async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  private read<T>(kind: Kind, key: string, def: T): ResolutionDetails<T> {
    const c = this.client;
    let d = c.getFeatureFlagDetails?.(key);
    if (!d) {
      const value = c.getFlag(key);
      d = value === undefined ? undefined : { value, payload: c.getFlagPayload(key) };
    }
    return toDetails(kind, def, d);
  }

  resolveBooleanEvaluation(key: string, def: boolean): ResolutionDetails<boolean> {
    return this.read("boolean", key, def);
  }
  resolveStringEvaluation(key: string, def: string): ResolutionDetails<string> {
    return this.read("string", key, def);
  }
  resolveNumberEvaluation(key: string, def: number): ResolutionDetails<number> {
    return this.read("number", key, def);
  }
  resolveObjectEvaluation<T extends object>(key: string, def: T): ResolutionDetails<T> {
    return this.read("object", key, def);
  }

  /** OpenFeature tracking: a client capture of `trackingEventName` with the details' fields and `$value` = details.value. */
  track(trackingEventName: string, _ctx: EvaluationContext, details: TrackingEventDetails = {}): void {
    const { value, ...rest } = details;
    this.client.capture?.(trackingEventName, { ...rest, ...(value !== undefined ? { $value: value } : {}) });
  }
}
