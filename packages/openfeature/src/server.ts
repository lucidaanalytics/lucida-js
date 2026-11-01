import { fail, personProperties, toDetails } from "./resolve.js";
import type { EvaluationContext, ResolutionDetails } from "./resolve.js";

/** The slice of `Lucida` from @lucida/node the provider uses. */
export interface ServerClient {
  getFeatureFlag(key: string, distinctId: string, o?: { personProperties?: Record<string, unknown> }): Promise<boolean | string | undefined>;
  getFeatureFlagPayload(key: string, distinctId: string, o?: { sendExposure?: boolean }): Promise<unknown>;
}

/** OpenFeature server provider: `OpenFeature.setProvider(new LucidaServerProvider(lucida))`. targetingKey = distinct id. */
export class LucidaServerProvider {
  readonly metadata = { name: "lucida" } as const;
  readonly runsOn = "server" as const;

  constructor(private readonly client: ServerClient) {}

  private async read<T>(kind: "boolean" | "string" | "number" | "object", key: string, def: T, ctx: EvaluationContext): Promise<ResolutionDetails<T>> {
    const id = ctx.targetingKey;
    if (!id) return fail(def, "TARGETING_KEY_MISSING", "targetingKey (distinct id) is required");
    try {
      const value = await this.client.getFeatureFlag(key, id, { personProperties: personProperties(ctx) });
      const payload = kind === "number" || kind === "object" ? await this.client.getFeatureFlagPayload(key, id, { sendExposure: false }) : undefined;
      return toDetails(kind, def, value, payload);
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
}
