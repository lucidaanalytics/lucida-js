import type { Client } from "./types.js";

/** Publish `client` as `target[name]` (default `globalThis.lucida`, the classic script's `window.lucida`) and fire `lucida:ready` on it. */
export function exposeGlobal(client: Client, opt: boolean | string | undefined, target: Window | typeof globalThis = globalThis): void {
  if (!opt) return;
  (target as unknown as Record<string, unknown>)[typeof opt === "string" ? opt : "lucida"] = client;
  if (typeof CustomEvent === "function") target.dispatchEvent?.(new CustomEvent("lucida:ready", { detail: client }));
}
