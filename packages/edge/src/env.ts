import type { EdgeOptions } from "./client.js";

/** A Workers/Vercel `env` object, `process.env`, or a getter-style store (Deno.env, Fastly ConfigStore). */
export type EnvSource = Record<string, unknown> | { get(name: string): string | null | undefined };

const read = (src: EnvSource, name: string): string | undefined => {
  const v = typeof (src as { get?: unknown }).get === "function" ? (src as { get(n: string): unknown }).get(name) : (src as Record<string, unknown>)[name];
  return typeof v === "string" && v ? v : undefined;
};

/**
 * Options from the platform's env bindings: LUCIDA_API_KEY (required), LUCIDA_SECRET_KEY, LUCIDA_HOST.
 * Cloudflare: `optionsFromEnv(env, { waitUntil: (p) => ctx.waitUntil(p) })`; Deno: `optionsFromEnv(Deno.env)`.
 */
export function optionsFromEnv(env: EnvSource, extra: Partial<EdgeOptions> = {}): EdgeOptions {
  const apiKey = read(env, "LUCIDA_API_KEY");
  if (!apiKey) throw new Error("LUCIDA_API_KEY is not set");
  const secretKey = read(env, "LUCIDA_SECRET_KEY");
  const host = read(env, "LUCIDA_HOST");
  return { ...extra, apiKey, ...(secretKey ? { secretKey } : {}), ...(host ? { host } : {}) };
}
