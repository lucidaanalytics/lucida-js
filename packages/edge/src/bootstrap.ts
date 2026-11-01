import type { EdgeClient, EdgeFlagOptions } from "./client.js";
import type { FlagValue } from "@lucida/sdk-core";
import { distinctIdSetCookie, mayPersist, visitorId } from "./visitor.js";

export interface RequestBootstrap {
  distinctId: string;
  flags: Record<string, FlagValue>;
  /** Set-Cookie value to send when a new id was minted and consent allows storing it. */
  setCookie?: string;
}

export interface BootstrapOptions extends EdgeFlagOptions {
  consentMode?: "off" | "opt_in" | "opt_out";
}

/** One visitor's server-side bootstrap from a Cookie header (shared by the Astro and Remix wrappers). */
export async function requestBootstrap(
  client: EdgeClient,
  cookieHeader: string | null | undefined,
  o: BootstrapOptions = {},
): Promise<RequestBootstrap> {
  const { consentMode, ...flagOpts } = o;
  const { distinctId, isNew } = visitorId(cookieHeader);
  const flags = await client.getAllFlags(distinctId, flagOpts);
  return {
    distinctId,
    flags,
    ...(isNew && mayPersist(cookieHeader, consentMode) ? { setCookie: distinctIdSetCookie(distinctId) } : {}),
  };
}
