// Messages extension pages and content scripts send to the background client. Tagged so app messages pass through untouched.
import type { ConsentState, FlagValue, Props } from "@lucida-analytics/sdk-core";

export const TAG = "__lucida";

export type Op =
  | { op: "capture"; event: string; props?: Props }
  | { op: "screen"; name: string; props?: Props }
  | { op: "identify"; id: string; set?: Props; setOnce?: Props }
  | { op: "alias"; alias: string }
  | { op: "group"; type: string; key: string; props?: Props }
  | { op: "register"; props: Props }
  | { op: "reset" }
  | { op: "optIn" }
  | { op: "optOut" }
  | { op: "setConsent"; update: Partial<ConsentState> }
  | { op: "flag"; key: string }
  | { op: "flags" }
  | { op: "payload"; key: string }
  | { op: "distinctId" }
  | { op: "flush" };

export type Message = Op & { [TAG]: 1; context?: string };
export type Reply = { ok: true; value?: FlagValue | Record<string, FlagValue> | string | unknown } | { ok: false; error: string };

export const isMessage = (m: unknown): m is Message => typeof m === "object" && m !== null && (m as Record<string, unknown>)[TAG] === 1;
