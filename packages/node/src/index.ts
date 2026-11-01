export { Lucida, LIB_VERSION } from "./client.js";
export type { LucidaOptions, CaptureInput, ImportEvent } from "./client.js";
export type { FlagOptions } from "./flags.js";
export type { DefinitionsResponse } from "./definitions.js";
export { FlagSnapshot } from "@lucida/sdk-core";
export type { FlagValue, StickyStore, MigrationStage, MigrationOps, MigrationReport } from "@lucida/sdk-core";
export { MemoryStickyStore, MIGRATION_STAGES, migrationStage, migrateRead, migrateWrite, aiConfig } from "@lucida/sdk-core";
export { withContext, getContext, readTracingHeaders, requestContextInit } from "./context.js";
export type { RequestContext, RequestContextOptions, HeaderBag } from "./context.js";
export { InMemoryFlagDefinitionCache } from "./defcache.js";
export type { FlagDefinitionCacheProvider } from "./defcache.js";
export { KvFlagDefinitionCache, redisFlagDefinitionCache, redisKv } from "./defcache-kv.js";
export type { KvClient, KvCacheOptions, RedisLike } from "./defcache-kv.js";
// Framework-neutral request reader shared with the edge wrappers (hono, next, svelte, react-router).
export { requestContext, cleanHeader, DISTINCT_ID_HEADER, SESSION_ID_HEADER } from "@lucida/sdk-core";
export type { RequestContext as RequestInfoContext, ServerRequestLike } from "@lucida/sdk-core";
