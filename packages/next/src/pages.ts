import { getBootstrap, parseCookie } from "./bootstrap.js";
import type { Bootstrap, LucidaNextOptions } from "./shared.js";

/** Key under which `withLucida` puts the bootstrap in `props` (read by `LucidaPagesProvider`). */
export const PAGE_PROP = "__lucida";

interface CtxLike {
  req: { headers: Record<string, string | string[] | undefined> };
}

function headersOf(ctx: CtxLike) {
  return {
    get: (name: string): string | null => {
      const v = ctx.req.headers[name.toLowerCase()];
      return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
    },
  };
}

/** Pages Router: the visitor's bootstrap inside `getServerSideProps`. */
export const getServerSideLucida = (ctx: CtxLike, o: LucidaNextOptions): Promise<Bootstrap> => getBootstrap(headersOf(ctx), o);

type Result<P> = { props: P | Promise<P> } | { redirect: unknown } | { notFound: true };

/**
 * Wraps a `getServerSideProps` so its props gain `__lucida` (distinct id + flags) for `LucidaPagesProvider`:
 * `export const getServerSideProps = withLucida(async (ctx) => ({ props: {} }), opts)`.
 */
export function withLucida<C extends CtxLike, P extends object>(
  gssp: ((ctx: C) => Promise<Result<P>> | Result<P>) | undefined,
  o: LucidaNextOptions,
): (ctx: C) => Promise<Result<P & { [PAGE_PROP]: Bootstrap }>> {
  return async (ctx) => {
    const [res, b] = await Promise.all([gssp?.(ctx) ?? ({ props: {} as P } as Result<P>), getServerSideLucida(ctx, o)]);
    if (!("props" in res)) return res;
    return { props: { ...(await res.props), [PAGE_PROP]: b } };
  };
}

