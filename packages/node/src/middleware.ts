/**
 * Request-context middleware for Express, Fastify and NestJS. No framework dependency: each takes the minimal
 * structural shape it needs. Inside a request, `lucida.capture({ event })` picks up the distinct id and session id
 * from the browser SDK's tracing headers (client-controlled: never use them for auth) and every event carries
 * `$current_url`, `$request_method`, `$request_path`, `$user_agent` and `$ip`. Set `getContext()!.distinctId`
 * once you know the user.
 */
import { requestContextInit, withContext } from "./context.js";
import type { HeaderBag, RequestContextOptions } from "./context.js";

export type { RequestContextOptions } from "./context.js";

interface HttpReq {
  method?: string;
  headers: HeaderBag;
  /** Express: path + query. */
  originalUrl?: string;
  /** Fastify / Node: path + query. */
  url?: string;
  protocol?: string;
  hostname?: string;
  ip?: string;
  socket?: { remoteAddress?: string | undefined };
  raw?: { socket?: { remoteAddress?: string | undefined } };
}

function initOf(req: HttpReq, o: RequestContextOptions) {
  const pathAndQuery = req.originalUrl ?? req.url ?? "";
  const host = (req.headers as Record<string, string | undefined>)["host"] ?? req.hostname;
  return requestContextInit(
    {
      headers: req.headers,
      method: req.method,
      path: pathAndQuery.split("?")[0],
      url: host ? `${req.protocol ?? "http"}://${host}${pathAndQuery}` : undefined,
      remoteAddr: req.socket?.remoteAddress ?? req.raw?.socket?.remoteAddress ?? req.ip,
    },
    o,
  );
}

const skip = (req: unknown, o: RequestContextOptions) => !!o.requestFilter && !o.requestFilter(req);

/**
 * Express: `app.use(setupRequestContext(lucida))`. `client` is accepted so call sites do not change when options move
 * onto the client; the context itself is process-wide.
 */
export function setupRequestContext(
  _client: unknown,
  o: RequestContextOptions = {},
): (req: HttpReq, res: unknown, next: (err?: unknown) => void) => void {
  return (req, _res, next) => {
    if (skip(req, o)) return next();
    withContext(initOf(req, o), () => next(), { fresh: true });
  };
}

/**
 * Fastify: `const h = fastifyRequestContext(lucida); app.addHook("onRequest", h.onRequest); app.addHook("onClose", h.onClose);`
 * `onClose` flushes and shuts the client down with the server.
 */
export function fastifyRequestContext(
  client: { shutdown(): Promise<void> },
  o: RequestContextOptions = {},
): {
  onRequest: (req: HttpReq, reply: unknown, done: (err?: Error) => void) => void;
  onClose: () => Promise<void>;
} {
  return {
    onRequest: (req, _reply, done) => {
      if (skip(req, o)) return done();
      withContext(initOf(req, o), () => done(), { fresh: true });
    },
    onClose: () => client.shutdown(),
  };
}

interface NestHttpContext {
  switchToHttp(): { getRequest(): HttpReq };
}
interface Subscribable {
  subscribe(observer: unknown): unknown;
}

/**
 * NestJS interceptor, structural (no @nestjs or rxjs import): `app.useGlobalInterceptors(new LucidaInterceptor(lucida))`
 * or `{ provide: APP_INTERCEPTOR, useValue: new LucidaInterceptor(lucida) }`. The handler subscription runs inside the
 * context, which is what keeps AsyncLocalStorage alive across Nest's observable pipeline. HTTP contexts only.
 */
export class LucidaInterceptor {
  constructor(
    _client: unknown,
    private readonly o: RequestContextOptions = {},
  ) {}

  intercept(context: NestHttpContext, next: { handle(): Subscribable }): Subscribable {
    const req = context.switchToHttp().getRequest();
    if (skip(req, this.o)) return next.handle();
    const init = initOf(req, this.o);
    const source = next.handle();
    // rxjs recognises the "@@observable" interop method, so this works with Nest's `from()`/`defer()` without importing rxjs.
    const wrapped: Subscribable & Record<string, unknown> = {
      subscribe: (observer: unknown) => withContext(init, () => source.subscribe(observer), { fresh: true }),
    };
    wrapped["@@observable"] = () => wrapped;
    return wrapped;
  }
}
