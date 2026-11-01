import { createEdgeClient } from "@lucida/edge";

/** Arguments of the component's capture action. The caller fixes uuid and timestamp, so a re-run dedupes. */
export interface CaptureArgs {
  apiKey: string;
  host?: string;
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
  uuid: string;
  timestamp: string;
}

export interface FlagArgs {
  apiKey: string;
  host?: string;
  key?: string;
  distinctId: string;
  personProperties?: Record<string, unknown>;
  groups?: Record<string, string>;
}

const client = (a: { apiKey: string; host?: string }, f?: typeof fetch) =>
  createEdgeClient({ apiKey: a.apiKey, ...(a.host ? { host: a.host } : {}), ...(f ? { fetch: f } : {}) });

/** Body of the capture action (Convex actions may fetch; queries and mutations may not). */
export async function captureHandler(a: CaptureArgs, f?: typeof fetch): Promise<null> {
  const c = client(a, f);
  c.capture(a.distinctId, a.event, a.properties ?? {}, { uuid: a.uuid, timestamp: a.timestamp });
  await c.flush();
  return null;
}

/** One flag's value (key set) or every flag; remote evaluation with the public key. */
export async function flagsHandler(a: FlagArgs, f?: typeof fetch): Promise<unknown> {
  const o = { ...(a.personProperties ? { personProperties: a.personProperties } : {}), ...(a.groups ? { groups: a.groups } : {}) };
  const c = client(a, f);
  return a.key ? ((await c.getFlag(a.key, a.distinctId, o)) ?? null) : await c.getAllFlags(a.distinctId, o);
}
