import type { EvalResult } from "./flags.js";

/**
 * AI Config flags (LC-FLG-25): a multivariate flag whose variations carry a versioned model and
 * prompt. The SDK only selects and renders the variation; evaluating model output is Watchtower's job.
 * A variation is either completion mode (chat `messages`) or agent mode (`instructions` plus `tools`, P-M49).
 */
export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** A tool an agent-mode variation offers the model; `parameters` is a JSON Schema object. */
export interface AiTool {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface AiConfig {
  /** False when the flag served nothing (off, unknown); `fallback` is then returned. */
  enabled: boolean;
  variation?: string;
  version?: number;
  /** `completion` (messages) or `agent` (instructions + tools). */
  mode: "completion" | "agent";
  model: string;
  provider?: string;
  messages: AiMessage[];
  /** Agent mode: the system instructions, placeholders filled. */
  instructions?: string;
  /** Agent mode: tools offered to the model. */
  tools: AiTool[];
  parameters: Record<string, unknown>;
}

/** The fallback a caller passes: `mode` and `tools` may be left out. */
export type AiConfigFallback = Omit<AiConfig, "enabled" | "mode" | "tools"> & Partial<Pick<AiConfig, "mode" | "tools">>;

const fill = (s: string, vars: Record<string, string>) => s.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (m, k: string) => vars[k] ?? m);

/** The AI config served by `result` with `{{var}}` placeholders in messages and instructions filled from `vars`. */
export function aiConfig(result: EvalResult | undefined, fallback: AiConfigFallback, vars: Record<string, string> = {}): AiConfig {
  const p = result?.variant ? (result.payload as Partial<AiConfig> | undefined) : undefined;
  const base: AiConfig = p && typeof p.model === "string"
    ? {
        enabled: true,
        ...(result?.variant ? { variation: result.variant } : {}),
        ...(typeof p.version === "number" ? { version: p.version } : {}),
        mode: p.mode === "agent" ? "agent" : "completion",
        model: p.model,
        ...(p.provider ? { provider: p.provider } : {}),
        messages: Array.isArray(p.messages) ? p.messages : [],
        ...(typeof p.instructions === "string" ? { instructions: p.instructions } : {}),
        tools: Array.isArray(p.tools) ? p.tools : [],
        parameters: p.parameters ?? {},
      }
    : { ...fallback, mode: fallback.mode ?? (fallback.instructions !== undefined ? "agent" : "completion"), tools: fallback.tools ?? [], enabled: false };
  return {
    ...base,
    messages: base.messages.map((m) => ({ role: m.role, content: fill(m.content, vars) })),
    ...(base.instructions !== undefined ? { instructions: fill(base.instructions, vars) } : {}),
  };
}
