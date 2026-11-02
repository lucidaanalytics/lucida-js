import { listenerFor, ProviderEvents } from "./events.js";
import type { FlagsListener } from "./events.js";
import { fail, splitContext, toDetails } from "./resolve.js";
import type { EvaluationContext, Kind, LucidaDetails, ResolutionDetails } from "./resolve.js";

interface ReadOptions {
  personProperties?: Record<string, unknown>;
  groups?: Record<string, string>;
  groupProperties?: Record<string, Record<string, unknown>>;
  sendExposure?: boolean;
}

/** The slice of `Lucida` from @lucida/node the provider uses; the optional members degrade when absent. */
export interface ServerClient {
  getFeatureFlag(key: string, distinctId: string, o?: ReadOptions): Promise<boolean | string | undefined>;
  getFeatureFlagPayload(key: string, distinctId: string, o?: ReadOptions): Promise<unknown>;
  /** Preferred read: real reason, condition index and request id (falls back to getFeatureFlag + payload). */
  getFeatureFlagDetails?(key: string, distinctId: string, o?: ReadOptions): Promise<LucidaDetails | undefined>;
  /** Resolves after the first definitions load; initialize() awaits it. */
  ready?: Promise<void>;
  /** Subscribe to definition reloads; returns an unsubscribe. Without it no change/stale events are emitted. */
  onFlagsChange?(l: FlagsListener): () => void;
  capture?(i: { distinctId: string; event: string; properties?: Record<string, unknown>; groups?: Record<string, string> }): void;
}

/** OpenFeature tracking details: `value` plus free-form fields. */
export type TrackingEventDetails = { value?: number } & Record<string, unknown>;

/** OpenFeature server provider: `OpenFeature.setProvider(new LucidaServerProvider(lucida))`. targetingKey = distinct id. */
export class LucidaServerProvider {
  readonly metadata = { name: "lucida" } as const;
  readonly runsOn = "server" as const;
  readonly events = new ProviderEvents();
  private unsubscribe: (() => void) | undefined;

  constructor(private readonly client: ServerClient) {
    this.unsubscribe = client.onFlagsChange?.(listenerFor(this.events));
  }

  /** Waits for the first definitions load; the SDK then emits PROVIDER_READY. */
  async initialize(): Promise<void> {
    await this.client.ready;
  }

  async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  private async details(key: string, id: string, o: ReadOptions): Promise<LucidaDetails | undefined> {
    if (this.client.getFeatureFlagDetails) return this.client.getFeatureFlagDetails(key, id, o);
    const value = await this.client.getFeatureFlag(key, id, o);
    if (value === undefined) return undefined;
    return { value, payload: await this.client.getFeatureFlagPayload(key, id, { ...o, sendExposure: false }) };
  }

  private async read<T>(kind: Kind, key: string, def: T, ctx: EvaluationContext): Promise<ResolutionDetails<T>> {
    const id = ctx.targetingKey;
    if (!id) return fail(def, "TARGETING_KEY_MISSING", "targetingKey (distinct id) is required");
    try {
      return toDetails(kind, def, await this.details(key, id, splitContext(ctx)));
    } catch (e) {
      return fail(def, "GENERAL", e instanceof Error ? e.message : String(e));
    }
  }

  resolveBooleanEvaluation(key: string, def: boolean, ctx: EvaluationContext): Promise<ResolutionDetails<boolean>> {
    return this.read("boolean", key, def, ctx);
  }
  resolveStringEvaluation(key: string, def: string, ctx: EvaluationContext): Promise<ResolutionDetails<string>> {
    return this.read("string", key, def, ctx);
  }
  resolveNumberEvaluation(key: string, def: number, ctx: EvaluationContext): Promise<ResolutionDetails<number>> {
    return this.read("number", key, def, ctx);
  }
  resolveObjectEvaluation<T extends object>(key: string, def: T, ctx: EvaluationContext): Promise<ResolutionDetails<T>> {
    return this.read("object", key, def, ctx);
  }

  /** OpenFeature tracking: event = trackingEventName, distinct id = targetingKey, properties = details, `$value` = details.value. */
  track(trackingEventName: string, ctx: EvaluationContext, details: TrackingEventDetails = {}): void {
    const id = ctx.targetingKey;
    if (!id || !this.client.capture) return;
    const { value, ...rest } = details;
    const { groups } = splitContext(ctx);
    this.client.capture({
      distinctId: id,
      event: trackingEventName,
      properties: { ...rest, ...(value !== undefined ? { $value: value } : {}) },
      ...(groups ? { groups } : {}),
    });
  }
}
