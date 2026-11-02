import { bootstrapScript, createEdgeClient, requestBootstrap } from "@lucida-analytics/edge";
import type { BootstrapOptions, EdgeClient, EdgeOptions, RequestBootstrap } from "@lucida-analytics/edge";

export { bootstrapScript };
export type { RequestBootstrap };

export interface LucidaRemix {
  client: EdgeClient;
  /**
   * Call in a loader/action: returns the visitor's bootstrap plus the `headers` to merge into the response
   * (Set-Cookie for a newly minted id when consent allows). Return `bootstrap` from the loader and render
   * `<script dangerouslySetInnerHTML={{ __html: bootstrapScript(bootstrap) }} />` in root.tsx.
   */
  load(request: Request, flagOpts?: BootstrapOptions): Promise<{ bootstrap: { distinctId: string; flags: RequestBootstrap["flags"] }; headers: Headers }>;
}

/** Create once per process (module scope); works on Node, Cloudflare and Deno Remix adapters. */
export function createLucida(opts: EdgeOptions | { client: EdgeClient }): LucidaRemix {
  const client = "client" in opts ? opts.client : createEdgeClient(opts);
  return {
    client,
    async load(request, flagOpts) {
      const { setCookie, ...bootstrap } = await requestBootstrap(client, request.headers.get("cookie"), flagOpts);
      const headers = new Headers();
      if (setCookie) headers.append("Set-Cookie", setCookie);
      return { bootstrap, headers };
    },
  };
}
