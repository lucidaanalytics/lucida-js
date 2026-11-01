# @lucida/hono

Server middleware for [Hono](https://hono.dev) on top of `@lucida/node`. It reads the visitor the browser SDK sent and
adds request properties to every event you capture from a handler. Hono is not a dependency (the types are structural).

```ts
import { Hono } from "hono";
import { Lucida } from "@lucida/node";
import { lucida, type LucidaRequest } from "@lucida/hono";

const client = new Lucida(process.env.LUCIDA_KEY!);
const app = new Hono<{ Variables: { lucida: LucidaRequest } }>();

app.use(lucida(client, { trustProxy: true }));

app.post("/orders", async (c) => {
  c.get("lucida").capture("order_paid", { total: 42 });
  return c.json({ ok: true });
});
```

In the browser enable `tracingHeaders: ["api.example.com"]` so fetch/XHR to that host carry `X-Lucida-Distinct-Id` and
`X-Lucida-Session-Id` (allow both in your CORS `allowHeaders`). Events then land on the same person and session as the
page. Those headers are client-controlled: use them to stitch analytics, never for authentication.

Properties added: `$current_url`, `$request_method`, `$request_path`, `$user_agent`, `$ip` (first X-Forwarded-For hop
only with `trustProxy`, else `remoteAddr(c)`), and `$session_id` when the header was present. Explicit properties and an
explicit `distinctId` argument always win. A request with no known visitor is captured under a random id with
`$process_person_profile: false`, so it creates no person.

Out of scope here: traces, spans, request timing and errors belong to Watchtower.
