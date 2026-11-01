import type { EvalResult } from "./flags.js";

/**
 * AI Config flags (LC-FLG-25): a multivariate flag whose variations carry a versioned model and
 * prompt. The SDK only selects and renders the variation; evaluating model output is Watchtower's job.
 */
export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiConfig {
  /** False when the flag served nothing (off, unknown); `fallback` is then returned. */
  enabled: boolean;
  variation?: string;
  version?: number;
  model: string;
  provider?: string;
  messages: AiMessage[];
  parameters: Record<string, unknown>;
}

const fill = (s: string, vars: Record<string, string>) => s.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (m, k: string) => vars[k] ?? m);

/** The AI config served by `result` with `{{var}}` placeholders in messages filled from `vars`. */
export function aiConfig(result: EvalResult | undefined, fallback: Omit<AiConfig, "enabled">, vars: Record<string, string> = {}): AiConfig {
  const p = result?.variant ? (result.payload as Partial<AiConfig> | undefined) : undefined;
  const base: AiConfig = p && typeof p.model === "string"
    ? {
        enabled: true,
        ...(result?.variant ? { variation: result.variant } : {}),
        ...(typeof p.version === "number" ? { version: p.version } : {}),
        model: p.model,
        ...(p.provider ? { provider: p.provider } : {}),
        messages: Array.isArray(p.messages) ? p.messages : [],
        parameters: p.parameters ?? {},
      }
    : { ...fallback, enabled: false };
  return { ...base, messages: base.messages.map((m) => ({ role: m.role, content: fill(m.content, vars) })) };
}
