export { EdgeClient, createEdgeClient } from "./client.js";
export type { EdgeOptions, EdgeFlagOptions, EdgeCaptureOptions } from "./client.js";
export { FlagSnapshot } from "@lucida/sdk-core";
export { optionsFromEnv } from "./env.js";
export type { EnvSource } from "./env.js";
export { visitorId, mayPersist, distinctIdSetCookie, bootstrapScript, DISTINCT_ID_COOKIE } from "./visitor.js";
export { requestBootstrap } from "./bootstrap.js";
export type { RequestBootstrap, BootstrapOptions } from "./bootstrap.js";
export type { Visitor } from "./visitor.js";
