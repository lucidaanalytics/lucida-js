import { init } from "@lucida-analytics/browser";
import type { BrowserConfig, Client, FlagValue, Module } from "@lucida-analytics/browser";
import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useIdentityTransition } from "./identity.js";

export type Flags = Record<string, FlagValue>;

export interface LucidaContextValue {
  /** null during SSR and when neither client nor apiKey was given. */
  client: Client | null;
  flags: Flags;
}

export const LucidaContext = createContext<LucidaContextValue | null>(null);

export interface LucidaProviderProps {
  client?: Client;
  apiKey?: string;
  options?: BrowserConfig;
  /** Browser modules passed as the third `init` argument, e.g. `[cookieMunchConsent]` from `@lucida-analytics/browser/consent`. Read once, when the client is created. */
  modules?: Module[];
  /** Server-resolved flags: rendered on the server and first client render (no flicker). */
  bootstrapFlags?: Flags;
  /** Your signed-in user id: identifies when it becomes a non-empty string, resets when it goes from a string to null/undefined/"" (never on an initial signed-out render). */
  identify?: string | null;
  /** Person properties sent with `identify`. */
  identifyProps?: Record<string, unknown>;
  children?: ReactNode;
}

// Owned clients are cached per apiKey so StrictMode double renders do not create two clients.
const owned = new Map<string, Client>();

function resolveClient(p: LucidaProviderProps): Client | null {
  if (p.client) return p.client;
  if (!p.apiKey || typeof window === "undefined") return null; // SSR: never touch the browser SDK
  let c = owned.get(p.apiKey);
  if (!c) {
    const config: BrowserConfig = {
      ...p.options,
      ...(p.bootstrapFlags ? { bootstrap: { ...p.options?.bootstrap, flags: p.bootstrapFlags } } : {}),
    };
    c = init(p.apiKey, config, p.modules);
    owned.set(p.apiKey, c);
  }
  return c;
}

export function LucidaProvider(p: LucidaProviderProps) {
  const client = resolveClient(p);
  const [flags, setFlags] = useState<Flags>(p.bootstrapFlags ?? {});
  useIdentityTransition(client, p.identify, p.identifyProps);
  useEffect(() => client?.onFlags((f) => setFlags(f)), [client]);
  return <LucidaContext.Provider value={{ client, flags }}>{p.children}</LucidaContext.Provider>;
}

export function useLucidaContext(): LucidaContextValue {
  const v = useContext(LucidaContext);
  if (!v) throw new Error("Lucida hooks must be used inside <LucidaProvider>");
  return v;
}
