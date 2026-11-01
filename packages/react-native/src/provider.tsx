import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { createClient } from "./client.js";
import type { FlagValue, NativeClient, NativeConfig } from "./types.js";

export type Flags = Record<string, FlagValue>;

export interface LucidaContextValue {
  /** null until storage has hydrated (async) or when neither client nor apiKey was given. */
  client: NativeClient | null;
  flags: Flags;
}

export const LucidaContext = createContext<LucidaContextValue | null>(null);

export interface LucidaProviderProps {
  client?: NativeClient;
  apiKey?: string;
  options?: NativeConfig;
  children?: ReactNode;
}

export function LucidaProvider({ client: given, apiKey, options, children }: LucidaProviderProps) {
  const [client, setClient] = useState<NativeClient | null>(given ?? null);
  const [flags, setFlags] = useState<Flags>({});

  useEffect(() => {
    if (given) return setClient(given);
    if (!apiKey) return;
    let alive = true;
    let owned: NativeClient | undefined;
    void createClient(apiKey, options).then((c) => {
      owned = c;
      if (alive) setClient(c);
      else void c.shutdown();
    });
    return () => {
      alive = false;
      void owned?.shutdown();
    };
    // options are read once: a new client per render would re-fire lifecycle events
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [given, apiKey]);

  useEffect(() => client?.onFlags((f) => setFlags(f)), [client]);
  return <LucidaContext.Provider value={{ client, flags }}>{children}</LucidaContext.Provider>;
}

export function useLucidaContext(): LucidaContextValue {
  const v = useContext(LucidaContext);
  if (!v) throw new Error("Lucida hooks must be used inside <LucidaProvider>");
  return v;
}
