# @lucida/tanstack-start

Lucida for TanStack Start (and plain TanStack Router apps). Re-exports `@lucida/react` and adds route-template
pageviews, a server request context and an SSR bootstrap helper. It imports neither TanStack package, so it follows
whatever version you run.

## Client

```tsx
// routes/__root.tsx
import { LucidaProvider, LucidaPageviews } from "@lucida/tanstack-start";
import { useRouter } from "@tanstack/react-router";

function Root() {
  const router = useRouter();
  return (
    <LucidaProvider apiKey="lc_pk_..." options={{ capturePageview: false, capturePageleave: true }}>
      <LucidaPageviews router={router} />
      <Outlet />
    </LucidaProvider>
  );
}
```

One `$pageview` per resolved navigation with `$route` (`/posts/$postId`, pathless layouts removed) and `$referrer` set
to the previous page. `trackRouter(router, client)` does the same outside React.

## Server

```ts
import { createMiddleware } from "@tanstack/react-start";
import { lucidaServerContext } from "@lucida/tanstack-start";

export const lucidaMiddleware = createMiddleware().server(({ next, request }) =>
  next({ context: lucidaServerContext(request, { trustProxy: true }) }),
);
// server function: context.lucida.distinctId / sessionId / props ($current_url, $request_method, $request_path, $user_agent, $ip)
```

The ids come from the `X-Lucida-Distinct-Id` / `X-Lucida-Session-Id` headers the browser SDK adds to requests to hosts
listed in `tracingHeaders`. They are client-controlled: stitch analytics with them, never authenticate with them.

SSR flag bootstrap: `lucidaBootstrap(createEdgeClient({ apiKey, host }), request)` returns `{ bootstrap, headers }`;
pass `bootstrap` into the provider's `options.bootstrap` and append `headers` (Set-Cookie when consent allows) to the response.
