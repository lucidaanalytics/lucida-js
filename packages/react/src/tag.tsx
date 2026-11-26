"use client";

import type { BrowserConfig, Client, Module } from "@lucida-analytics/browser";
import { useEffect, useState } from "react";
import { useIdentityTransition } from "./identity.js";

export interface LucidaTagProps {
  /**
   * Public project key. Default: `process.env.NEXT_PUBLIC_LUCIDA_KEY`. Next inlines `NEXT_PUBLIC_*` at BUILD time,
   * so setting it only at runtime ships an empty key and nothing loads. No key: renders nothing, imports nothing.
   */
  publicKey?: string;
  /** Identify this user once the client is ready; re-identifies when it changes. */
  uid?: string;
  /** Your signed-in user id: identifies when it becomes a non-empty string, resets on a signed-in to signed-out transition only. */
  identify?: string | null | undefined;
  /** Person properties sent with `identify`. */
  identifyProps?: Record<string, unknown> | undefined;
  /** Merged over the defaults (`consent.mode: "opt_in"`, `referralParams: []`, `exposeGlobal: true`). */
  options?: BrowserConfig;
  /**
   * Extra browser modules, after the Cookie Munch follower. Names ("replay", "heatmaps", "forms", "guides", "webmcp",
   * "recommendations", "earlyAccess", "correlate", "toolbar", "inspector") are loaded by dynamic import inside this client
   * component, so a server component (Next layout) can pass them: functions cannot cross the RSC boundary, strings can.
   */
  modules?: (Module | TagModuleName)[];
  /** Shorthand for `modules: ["replay"]`. */
  replay?: boolean;
  /** Shorthand for `modules: ["heatmaps"]`. */
  heatmaps?: boolean;
  /** Shorthand for `modules: ["forms"]`. */
  forms?: boolean;
  /** Shorthand for `modules: ["guides"]`. */
  guides?: boolean;
  /** Follow Cookie Munch consent (default true; a no-op when no Cookie Munch is on the page). */
  cookieMunch?: boolean;
}

export type TagModuleName = "replay" | "heatmaps" | "forms" | "guides" | "webmcp" | "recommendations" | "earlyAccess" | "correlate" | "toolbar" | "inspector";

// Literal specifiers so bundlers split each module into its own chunk.
const LOADERS: Record<TagModuleName, () => Promise<Module>> = {
  replay: () => import("@lucida-analytics/browser/replay").then((m) => m.replay),
  heatmaps: () => import("@lucida-analytics/browser/heatmaps").then((m) => m.heatmaps),
  forms: () => import("@lucida-analytics/browser/forms").then((m) => m.forms),
  guides: () => import("@lucida-analytics/browser/guides").then((m) => m.guides),
  webmcp: () => import("@lucida-analytics/browser/webmcp").then((m) => m.webmcp),
  recommendations: () => import("@lucida-analytics/browser/recommendations").then((m) => m.recommendations),
  earlyAccess: () => import("@lucida-analytics/browser/early-access").then((m) => m.earlyAccess),
  correlate: () => import("@lucida-analytics/browser/correlate").then((m) => m.correlate),
  toolbar: () => import("@lucida-analytics/browser/toolbar").then((m) => m.toolbar),
  inspector: () => import("@lucida-analytics/browser/inspector").then((m) => m.inspector),
};

async function resolveModules(p: LucidaTagProps): Promise<Module[]> {
  const items = [...(p.modules ?? [])];
  for (const n of ["replay", "heatmaps", "forms", "guides"] as const) if (p[n] && !items.includes(n)) items.push(n);
  const out = await Promise.all(items.map((m) => (typeof m === "string" ? (LOADERS[m]?.() ?? Promise.resolve(null)) : Promise.resolve(m))));
  return out.filter((m): m is Module => typeof m === "function");
}

/** The tag's client, for hooks used under `LucidaTag` without a `LucidaProvider`. */
let tagClient: Client | null = null;
const tagListeners = new Set<() => void>();
export const subscribeTagClient = (cb: () => void): (() => void) => (tagListeners.add(cb), () => void tagListeners.delete(cb));
export const getTagClient = (): Client | null => tagClient;

// One init promise per key: remounts and StrictMode double effects never init twice. Never rejects.
const inits = new Map<string, Promise<Client | null>>();

function start(key: string, p: LucidaTagProps): Promise<Client | null> {
  let c = inits.get(key);
  if (!c) {
    c = (async () => {
      const { init } = await import("@lucida-analytics/browser");
      const mods = await resolveModules(p);
      if (p.cookieMunch !== false) {
        const { cookieMunchConsent } = await import("@lucida-analytics/browser/consent");
        mods.unshift(cookieMunchConsent);
      }
      return init(
        key,
        {
          consent: { mode: "opt_in" },
          // ?ref= belongs to the referral platform under a different consent category; the SDK defaults it off, [] documents it.
          referralParams: [],
          exposeGlobal: true, // window.lucida, so a Watchtower browser client can link lucida.session_id
          ...p.options,
        },
        mods,
      );
    })().catch(() => null);
    inits.set(key, c);
  }
  return c;
}

/** `NEXT_PUBLIC_LUCIDA_KEY`, written out in full so Next can inline it; elsewhere `process` may not exist. */
function envKey(): string | undefined {
  try {
    return process.env.NEXT_PUBLIC_LUCIDA_KEY || undefined;
  } catch {
    return undefined;
  }
}

/** One-line, consent-gated analytics loader. Renders nothing, never throws. */
export function LucidaTag(p: LucidaTagProps): null {
  const key = p.publicKey ?? envKey();
  const [client, setClient] = useState<Client | null>(null);
  useIdentityTransition(client, p.identify, p.identifyProps);
  useEffect(() => {
    if (!key) return;
    let live = true;
    void start(key, p).then((c) => {
      if (c && c !== tagClient) {
        tagClient = c;
        tagListeners.forEach((f) => f());
      }
      if (live && c) setClient(c);
      if (live && c && p.uid) c.identify(p.uid);
    });
    return () => {
      live = false;
    };
    // Init options are read once per key; only the key and uid re-run the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, p.uid]);
  return null;
}
