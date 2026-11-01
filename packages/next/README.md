# @lucida/next

Next.js helpers (App Router and Pages Router). Three entries: `@lucida/next` (edge and server-component safe),
`@lucida/next/client` (provider + React hooks, `"use client"`), `@lucida/next/server` (Node only: local flag evaluation).

```ts
// middleware.ts : resolve id + flags once per request, no flicker
import { lucidaMiddleware } from "@lucida/next";
export async function middleware(req: NextRequest) {
  const lc = await lucidaMiddleware(req, { apiKey: process.env.NEXT_PUBLIC_LUCIDA_KEY!, middleware: true });
  return lc.apply(NextResponse.next({ request: { headers: lc.requestHeaders } }));
}

// app/layout.tsx (App Router)
const b = await getBootstrap(await headers(), opts); // opts.middleware = true to trust the forwarded headers
<LucidaNextProvider apiKey={key} bootstrap={b}>{children}</LucidaNextProvider>

// pages/_app.tsx + page (Pages Router)
export const getServerSideProps = withLucida(async () => ({ props: {} }), opts);
<LucidaPagesProvider apiKey={key} pageProps={pageProps}><Component {...pageProps} /></LucidaPagesProvider>

// next.config.js : first-party proxy, then init the browser SDK with apiHost "/ingest" (the default of LucidaNextProvider)
async rewrites() { return lucidaRewrites({ host: "https://ingest.example.com" }); }
```

Server-side local evaluation (Node runtime, secret key stays on the server):
`const evaluate = nodeEvaluator({ apiKey, secretKey: process.env.LUCIDA_SECRET_KEY! })` then pass `{ evaluate }` in the options.
The node SDK streams definition changes over SSE, so a kill switch reaches the server within seconds.

Privacy: the anonymous-id cookie (`lc_distinct_id`) is written only with consent (`consentMode`, default `opt_in`:
cookie `lc_consent=granted`). Without it the id lives for one request. Forwarded `x-lc-*` headers are trusted only
with `middleware: true`, because a client can send its own.

## Route templates and server request context

- `<LucidaNextProvider routeTemplates>` (App Router) turns the SDK's own pageview capture off and renders `LucidaRouteViews`,
  which sends one `$pageview` per navigation with `$route` (`/blog/[slug]`) and the previous page as `$referrer`
  (`$pageleave` with scroll depth still fires). Pages Router: `<LucidaPagesProvider router={useRouter()} ...>` uses
  `router.pathname` as the template. `routeTemplate(pathname, params)` is exported if you want the string yourself.
- `lucidaMiddleware` also forwards a request context (`x-lc-request`, always overwritten, never taken from the client):
  the `X-Lucida-Distinct-Id` / `X-Lucida-Session-Id` the browser SDK sent (enable `tracingHeaders` for your own host),
  `$current_url`, `$request_method`, `$request_path`, `$user_agent` and `$ip` (first X-Forwarded-For hop only with
  `trustProxy: true`). Read it in server components and route handlers with
  `getRequestContext(await headers(), opts)` and spread `ctx.props` into your server captures. The tracing ids are
  client-controlled: use them to stitch analytics, never for authentication.
