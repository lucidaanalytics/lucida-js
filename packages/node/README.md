# @lucida-analytics/node

Server SDK. Name a `distinctId` per call, or run inside `withContext` and omit it; events are batched through the shared `@lucida-analytics/sdk-core` queue.

```ts
import { Lucida } from "@lucida-analytics/node";

const lucida = new Lucida("lc_pk_...", { host: "https://capture.lucidace.com", secretKey: "lc_sk_..." });
lucida.capture({ distinctId: "u1", event: "purchase", properties: { total: 12 } });
lucida.identify({ distinctId: "u1", properties: { plan: "pro" } });
if (await lucida.isFeatureEnabled("new-checkout", "u1", { personProperties: { plan: "pro" } })) { /* ... */ }
await lucida.shutdown(); // flush on exit
```

Options: `host`, `flushAt` (20), `flushIntervalMs` (10 000), `secretKey` (alias `personalApiKey`), `featureFlagsPollingIntervalMs`
(30 000), `timeoutMs` (10 000), `disabled`, `debug`. Bodies over 1 KB are gzipped (`?compression=gzip`).

## Contexts and middleware

```ts
import { withContext, getContext } from "@lucida-analytics/node";

withContext({ distinctId: "u1", sessionId: "s1", properties: { svc: "api" } }, () => {
  lucida.capture({ event: "purchase" }); // distinct id, $session_id and properties come from the context
  withContext({}, () => {}, { fresh: true }); // fresh = do not inherit; child changes never leak out
});
```

Built on `AsyncLocalStorage`; explicit `capture` arguments always win. `getContext()` returns the live object, so
`getContext()!.distinctId = user.id` after login works. `readTracingHeaders(headers)` reads the browser SDK's
`X-Lucida-Distinct-Id` / `X-Lucida-Session-Id` (control chars stripped, trimmed, 1000 chars; client-controlled, never use for auth).

`@lucida-analytics/node/middleware` (no framework dependency; minimal structural types) stamps `$current_url`, `$request_method`,
`$request_path`, `$user_agent`, `$ip` (first `X-Forwarded-For` entry only with `trustProxy: true`) plus the tracing ids.
Options for all three: `requestFilter`, `extraProperties`, `captureTracingHeaders` (default true), `trustProxy`.

```ts
import { setupRequestContext, fastifyRequestContext, LucidaInterceptor } from "@lucida-analytics/node/middleware";

app.use(setupRequestContext(lucida));                                  // Express
const h = fastifyRequestContext(lucida);                               // Fastify
app.addHook("onRequest", h.onRequest); app.addHook("onClose", h.onClose);
app.useGlobalInterceptors(new LucidaInterceptor(lucida));              // NestJS (or APP_INTERCEPTOR)
```

The Nest interceptor implements `intercept(context, next)` structurally and returns an rxjs-interoperable object
(`@@observable`) whose subscription runs inside the context, so it needs neither `@nestjs/*` nor `rxjs` at build time.

## Delivery options

`beforeSend(event) => event | null` (null drops; throwing keeps the original), `onError(error, events)` when a batch is
dropped or `captureImmediate` fails, `maxBatchSize` (per request, separate from `flushAt`), `fetchRetryCount` (5) and
`fetchRetryDelayMs` (1000, doubling, jittered), `captureImmediate({...})` (awaits one event's delivery, returns the uuid),
`disableGeoip` (client default or per event, sends `$geoip_disable: true`), `isServer` (`$is_server: true`),
`register({...})` / `unregister(key)` super properties, `flagsTimeoutMs`, `maxCacheSize` (exposure dedup).
Personless events: `capture({ event, processPersonProfile: false })` sends `$process_person_profile: false` and a random
UUID distinct id when none is given.

## Flags

With a `secretKey` the SDK polls `GET /v1/flags/definitions` and evaluates locally with the shared sdk-core evaluator
(`testdata/flags` vectors). A flag with a cohort filter (`requires_server`) or one unknown locally falls back to
`POST /v1/flags` unless `onlyEvaluateLocally`. Without a secret key every read is remote.

Definition changes arrive over `GET /v1/flags/stream` (SSE `definitions` events): the SDK reloads on each event, reconnects with exponential backoff, and polls on `featureFlagsPollingIntervalMs` only while the stream is down (`streamFlags: false` turns the stream off). A kill switch therefore reaches local evaluation in well under 5 s. The Python (`flag_stream`) and Go (`DisableFlagStream`) SDKs behave the same; the Rust SDK still only polls.

`getFeatureFlag` emits `$feature_flag_called` and `$exposure` once per `(distinctId, flag, value)` (bounded LRU, 10 000);
`sendExposure: false` disables it. `getFeatureFlagPayload`, `getAllFlags` and `getAllFlagsAndPayloads` never emit.
`fallbacks: { key: value }` is served (reason `"fallback"`, no exposure) when nothing decides a flag (network error, cold start, unknown key); it beats `defaultValue`.
`getFeatureFlagDetails(key, distinctId, o)` returns `{ value, payload, variant, reason, conditionIndex, requestId, evaluatedLocally }` (same exposure rules as `getFeatureFlag`), or `undefined`.
`getRemoteConfigPayload(key)` (needs `secretKey`) reads a remote-config flag's payload, decrypted if stored encrypted.

### Definition cache provider

Share one definitions fetch between workers: `flagDefinitionCacheProvider` with `getFlagDefinitions()`,
`shouldFetchFlagDefinitions()`, `onFlagDefinitionsReceived(defs)` and optional `shutdown()` (sync or async).
`InMemoryFlagDefinitionCache(ttlMs)` is the reference. `redisFlagDefinitionCache(client, "ioredis" | "node-redis", { prefix, ttlSeconds, lockSeconds })`
is an optional adapter over a client you supply (no Redis dependency in the SDK): the worker that wins the `SET NX` lock fetches and
publishes, the others read the stored copy. For another store implement `KvClient` (`get`, `set(key, value, ttlSeconds, ifAbsent)`) and use `KvFlagDefinitionCache`.

```ts
const cache = redisFlagDefinitionCache(new Redis(process.env.REDIS_URL!)); // ioredis
const lc = new Lucida("lc_pk_...", { secretKey, flagDefinitionCacheProvider: cache });
```

Known limit: a flag depending (prerequisite / `flag` filter) on a cohort-gated flag is decided locally against that flag's
`false` placeholder; pass those through the remote path if it matters.

## Agent analytics

```ts
const lucida = new Lucida("lc_pk_...", { ai: { captureText: false } });
const convo = lucida.ai.startConversation({ distinctId: user.id, agentName: "support-bot", traceId });
convo.message("user", question);
convo.message("assistant", answer);
convo.feedback({ kind: "rating", value: 4 });
convo.end("escalated", "handed to support");
convo.outcome("resolved", "ticket closed"); // later, when the outcome is known
```

`distinctId` works like `capture` (or comes from `withContext`).
Events: `$ai_conversation_started`, `$ai_message` (role, auto-incremented index, text length; for user
messages a simhash `$ai_text_hash` and a lexicon `$ai_sentiment` so rephrases and frustration show without the
text), `$ai_feedback` (thumbs 1/-1, rating 1..5, comment), `$ai_conversation_ended` and `$ai_outcome`
(`resolved`, `unresolved`, `escalated`, `abandoned`, `error`). Message text and feedback comments are sent only
with `ai: { captureText: true }`, after cards, emails and phone numbers are masked. `traceId` (a W3C trace id) links the
conversation to its trace in Watchtower; tokens, latency, cost and model names are never captured here.
Events use the normal capture path, so consent and opt-out apply.

## Test mode

`lucida flags fixture --out flags.json` exports the definitions; then `new Lucida("lc_pk_test", { testMode: { fixture: "flags.json" } })`
(a `{flags: [...]}` object or an array also works) makes the client fully offline and deterministic: no network, flags
evaluate locally (a flag outside the fixture, or one needing the server, reads `undefined`), and every event
(including `$feature_flag_called` / `$exposure`) lands in `lucida.captured` for assertions. `importEvents` needs a `secretKey` and also lands there.

## Gateway contract (follow-up: not implemented in go/gateway yet)

`GET /v1/flags/definitions`, `Authorization: Bearer lc_sk_...`

- `200` with header `ETag: "<opaque>"` and body `{"flags": [FlagDefinition, ...]}` where `FlagDefinition` is the wire
  format of `testdata/flags/README.md` (`key, type, active, kill_switch, salt, variants, conditions, aggregation,
  prerequisites, payload`), including inactive flags.
- `304` (no body) when `If-None-Match` equals the current ETag.
- `401` for a non-secret or revoked key.

`POST /v1/s2s/batch` (historical import, `Lucida.importEvents`): `Authorization: Bearer lc_sk_...`, same body as
`/v1/batch` (`{batch, sent_at}`, gzip via `?compression=gzip`), original `timestamp`s preserved, max 1000 events.
