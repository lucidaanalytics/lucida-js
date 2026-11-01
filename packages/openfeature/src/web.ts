import { toDetails } from "./resolve.js";
import type { EvaluationContext, ResolutionDetails } from "./resolve.js";

/** The slice of the browser `Client` from @lucida/browser the provider uses. */
export interface WebClient {
  identify(id: string): void;
  reset(): void;
  getFlag(key: string): boolean | string | undefined;
  getFlagPayload(key: string): unknown;
  reloadFlags(): Promise<void>;
}

/**
 * OpenFeature web (static-context) provider: `await OpenFeature.setContext({ targetingKey })` identifies
 * the visitor and reloads flags; evaluations are then synchronous reads of the loaded flags.
 */
export class LucidaWebProvider {
  readonly metadata = { name: "lucida-web" } as const;
  readonly runsOn = "client" as const;

  constructor(private readonly client: WebClient) {}

  private async apply(ctx: EvaluationContext): Promise<void> {
    if (ctx.targetingKey) this.client.identify(ctx.targetingKey);
    await this.client.reloadFlags();
  }

  initialize(ctx: EvaluationContext = {}): Promise<void> {
    return this.apply(ctx);
  }

  onContextChange(_old: EvaluationContext, next: EvaluationContext): Promise<void> {
    return this.apply(next);
  }

  private read<T>(kind: "boolean" | "string" | "number" | "object", key: string, def: T): ResolutionDetails<T> {
    return toDetails(kind, def, this.client.getFlag(key), this.client.getFlagPayload(key));
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
}
