import { init } from "@lucida-analytics/browser";
import type { BrowserConfig, Client, FlagValue } from "@lucida-analytics/browser";
import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

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
  /** Server-resolved flags: rendered on the server and first client render (no flicker). */
  bootstrapFlags?: Flags;
  children?: ReactNode;
}

// Owned clients are cached per apiKey so StrictMode double renders do not create two clients.
const owned = new Map<string, Client>();

function resolveClient(p: LucidaProviderProps): Client | null {
  if (p.client) return p.client;
  if (!p.apiKey || typeof window === "undefined") return null; // SSR: never touch the browser SDK
  let c = owned.get(p.apiKey);
  if (!c) {
    c = init(p.apiKey, {
      ...p.options,
      ...(p.bootstrapFlags ? { bootstrap: { ...p.options?.bootstrap, flags: p.bootstrapFlags } } : {}),
    });
    owned.set(p.apiKey, c);
  }
  return c;
}

export function LucidaProvider(p: LucidaProviderProps) {
  const client = resolveClient(p);
  const [flags, setFlags] = useState<Flags>(p.bootstrapFlags ?? {});
  useEffect(() => client?.onFlags((f) => setFlags(f)), [client]);
  return <LucidaContext.Provider value={{ client, flags }}>{p.children}</LucidaContext.Provider>;
}

export function useLucidaContext(): LucidaContextValue {
  const v = useContext(LucidaContext);
  if (!v) throw new Error("Lucida hooks must be used inside <LucidaProvider>");
  return v;
}
