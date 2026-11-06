# @lucida-analytics/remix

Remix helpers on top of `@lucida-analytics/edge` (Node, Cloudflare and Deno adapters). A loader gets the visitor's distinct id and
flags, plus the headers to merge into the response so a new anonymous id cookie is set when consent allows.

```sh
npm install @lucida-analytics/remix @lucida-analytics/browser
```

```ts
// app/lucida.server.ts : once per process
import { createLucida } from "@lucida-analytics/remix";
export const lucida = createLucida({ apiKey: process.env.LUCIDA_API_KEY!, secretKey: process.env.LUCIDA_SECRET_KEY });

// app/root.tsx
export async function loader({ request }: LoaderFunctionArgs) {
  const { bootstrap, headers } = await lucida.load(request);
  return json({ bootstrap }, { headers });
}
// in the document <head>:
<script dangerouslySetInnerHTML={{ __html: bootstrapScript(bootstrap) }} />
// then in the browser: init("lc_pk_...", { bootstrap: window.__LUCIDA_BOOTSTRAP__ })
```

- `createLucida(options | { client })` returns `{ client, load }`. `options` are the edge `EdgeOptions`.
- `load(request, flagOptions?)` resolves to `{ bootstrap: { distinctId, flags }, headers }`; `flagOptions` include `consentMode`
  (`opt_in` default). Merge `headers` into the loader response.
- `lucida.client` is the `EdgeClient` for server-side `capture` in loaders and actions.
- Exports: `createLucida`, `bootstrapScript`, types `LucidaRemix`, `RequestBootstrap`.
