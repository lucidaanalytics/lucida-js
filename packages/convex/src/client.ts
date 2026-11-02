import { uuidv7 } from "@lucida-analytics/sdk-core";
import type { CaptureArgs, FlagArgs } from "./component/handlers.js";

/** `components.lucida` from the app's generated api (function references are opaque here). */
export interface LucidaComponent {
  lib: { capture: unknown; flags: unknown };
}

/** A mutation ctx: it may not fetch, so captures are scheduled (they run only if the mutation commits). */
interface SchedulerCtx {
  scheduler: { runAfter(ms: number, fn: never, args: CaptureArgs): Promise<unknown> };
}
/** An action ctx: it may call the component directly. */
interface ActionCtx {
  runAction(fn: never, args: CaptureArgs | FlagArgs): Promise<unknown>;
}

export interface LucidaConvexOptions {
  /** Public key (lc_pk_...). Default: process.env.LUCIDA_API_KEY, read at call time (components do not see app env). */
  apiKey?: string;
  host?: string;
}

const env = (k: string): string | undefined => (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env[k];

/**
 * App-side client for the Lucida Convex component:
 * `const lucida = new Lucida(components.lucida); await lucida.capture(ctx, userId, "signed_up", {plan})`.
 */
export class Lucida {
  constructor(
    private readonly component: LucidaComponent,
    private readonly o: LucidaConvexOptions = {},
  ) {}

  private key(): { apiKey: string; host?: string } {
    const apiKey = this.o.apiKey ?? env("LUCIDA_API_KEY");
    if (!apiKey) throw new Error("Lucida: set LUCIDA_API_KEY in the Convex dashboard or pass { apiKey }");
    const host = this.o.host ?? env("LUCIDA_HOST");
    return { apiKey, ...(host ? { host } : {}) };
  }

  /** From a mutation the capture is scheduled; from an action it is sent now. The uuid is fixed here, so retries dedupe. */
  async capture(ctx: SchedulerCtx | ActionCtx, distinctId: string, event: string, properties: Record<string, unknown> = {}): Promise<void> {
    const args: CaptureArgs = { ...this.key(), distinctId, event, properties, uuid: uuidv7(), timestamp: new Date().toISOString() };
    const ref = this.component.lib.capture as never;
    if ("runAction" in ctx) await ctx.runAction(ref, args);
    else await ctx.scheduler.runAfter(0, ref, args);
  }

  /** One flag (undefined when unknown). Actions only: flag evaluation needs the network. */
  async getFeatureFlag(ctx: ActionCtx, key: string, distinctId: string, o: Pick<FlagArgs, "personProperties" | "groups"> = {}): Promise<unknown> {
    const v = await ctx.runAction(this.component.lib.flags as never, { ...this.key(), key, distinctId, ...o });
    return v ?? undefined;
  }

  async isFeatureEnabled(ctx: ActionCtx, key: string, distinctId: string, o: Pick<FlagArgs, "personProperties" | "groups"> = {}): Promise<boolean> {
    const v = await this.getFeatureFlag(ctx, key, distinctId, o);
    return v !== undefined && v !== false;
  }

  async getAllFlags(ctx: ActionCtx, distinctId: string, o: Pick<FlagArgs, "personProperties" | "groups"> = {}): Promise<Record<string, unknown>> {
    return (await ctx.runAction(this.component.lib.flags as never, { ...this.key(), distinctId, ...o })) as Record<string, unknown>;
  }
}
