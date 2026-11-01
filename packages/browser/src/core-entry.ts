import { createClient } from "./client.js";
import type { BrowserConfig, Client } from "./types.js";

/** Core-only client: capture, identity, sessions, consent, transport. No autocapture, no flags. */
export function init(apiKey: string, config: BrowserConfig = {}): Client {
  return createClient(apiKey, config);
}

export { createClient } from "./client.js";
export type { BrowserConfig, Client, Host, Module, Persistence, FlagValue } from "./types.js";
