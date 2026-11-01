# @lucida/react-router

Lucida for React Router v6.4+ and v7 (declarative, data and framework mode). It re-exports everything from
`@lucida/react` and adds route-aware pageviews and a server request context. It does not import React Router, so
it works with any version.

## Client

```tsx
import { LucidaProvider, LucidaPageviews, routeTemplateFromMatches } from "@lucida/react-router";
import { Outlet, useLocation, useMatches } from "react-router";

function Pageviews() {
  const { pathname, search } = useLocation();
  return <LucidaPageviews pathname={pathname} search={search} template={routeTemplateFromMatches(useMatches())} />;
}

export default function Root() {
  return (
    <LucidaProvider apiKey="lc_pk_..." options={{ capturePageview: false, capturePageleave: true }}>
      <Pageviews />
      <Outlet />
    </LucidaProvider>
  );
}
```

- `capturePageview: false` hands pageviews to `LucidaPageviews`, which sends one `$pageview` per navigation with
  `$route` (`/blog/:slug`) and `$referrer` set to the previous page. `capturePageleave: true` keeps `$pageleave`
  (with scroll depth) on route changes.
- Without a data router (`<BrowserRouter>`), skip `template`: you get plain pageviews, which the browser SDK's default
  `capturePageview: "history"` already does, so you can also leave everything at the default.
- Data routers can use `trackRouter(router, client)` outside React instead.

## Framework mode (server)

```ts
import { lucidaRequestContext } from "@lucida/react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  const ctx = lucidaRequestContext(request, { trustProxy: true });
  lucida.capture({ distinctId: ctx.distinctId ?? crypto.randomUUID(), event: "report_viewed", properties: ctx.props });
}
```

`ctx` carries the distinct id and session id the browser sent (enable `tracingHeaders: ["your-api-host"]` in the
browser SDK; same-origin loaders need your own host listed too) and the request props `$current_url`,
`$request_method`, `$request_path`, `$user_agent`, `$ip`. The tracing headers are client-controlled: use them to
stitch analytics, never for auth. For flag bootstrap on the server use `@lucida/remix`'s `createLucida().load(request)`
(the same edge helper works with React Router framework mode).
