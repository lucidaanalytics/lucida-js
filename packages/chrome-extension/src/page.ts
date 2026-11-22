// Subpath `@lucida-analytics/chrome-extension/page`: for popups, options pages, side panels and content scripts. Every call
// is a message to the background client, so the whole extension shares one identity, one queue and one set of flags.
import type { ConsentState, FlagValue, Props } from "@lucida-analytics/sdk-core";
import { webExtension } from "./chrome.js";
import type { ChromeLike } from "./chrome.js";
import { TAG } from "./protocol.js";
import type { Op, Reply } from "./protocol.js";

export interface PageOptions {
  /** `$extension_context` on every event: "popup", "options", "side_panel", "content_script"... Default: guessed from the page. */
  context?: string;
  /** Send `$screen` for this extension page on connect (its file name, never a web page's URL). Default true on extension pages. */
  screen?: boolean;
  chrome?: ChromeLike;
}

export interface PageClient {
  capture(event: string, props?: Props): void;
  screen(name: string, props?: Props): void;
  identify(id: string, set?: Props, setOnce?: Props): void;
  alias(alias: string): void;
  group(type: string, key: string, props?: Props): void;
  register(props: Props): void;
  reset(): void;
  optIn(): void;
  optOut(): void;
  setConsent(update: Partial<ConsentState>): void;
  getFlag(key: string): Promise<FlagValue | undefined>;
  isFeatureEnabled(key: string): Promise<boolean>;
  getFlagPayload(key: string): Promise<unknown>;
  getFlags(): Promise<Record<string, FlagValue>>;
  distinctId(): Promise<string>;
  flush(): Promise<void>;
}

function guessContext(): { context: string; page?: string } {
  const loc = (globalThis as { location?: { protocol: string; pathname: string } }).location;
  if (!loc || !/-extension:$/.test(loc.protocol)) return { context: "content_script" };
  const page = loc.pathname.replace(/^\/+/, "");
  const name = page.replace(/\.html?$/, "").split("/").pop() ?? page;
  return { context: /popup|options|side.?panel|sidepanel|newtab|devtools/i.test(name) ? name.replace(/[-.]/g, "_") : "page", page };
}

export function connect(opts: PageOptions = {}): PageClient {
  const ext = opts.chrome ?? webExtension();
  if (!ext) throw new Error("@lucida-analytics/chrome-extension/page: no chrome/browser extension API here");
  const guess = guessContext();
  const context = opts.context ?? guess.context;
  const send = async (op: Op): Promise<unknown> => {
    try {
      const r = (await ext.runtime.sendMessage({ ...op, [TAG]: 1, context })) as Reply | undefined;
      if (!r) throw new Error("no background client: call createClient() at the top level of the background worker");
      if (!r.ok) throw new Error(r.error);
      return r.value;
    } catch (e) {
      console.warn("[lucida]", e instanceof Error ? e.message : e);
      return undefined;
    }
  };
  const fire = (op: Op): void => void send(op);
  const client: PageClient = {
    capture: (event, props) => fire({ op: "capture", event, ...(props ? { props } : {}) }),
    screen: (name, props) => fire({ op: "screen", name, ...(props ? { props } : {}) }),
    identify: (id, set, setOnce) => fire({ op: "identify", id, ...(set ? { set } : {}), ...(setOnce ? { setOnce } : {}) }),
    alias: (alias) => fire({ op: "alias", alias }),
    group: (type, key, props) => fire({ op: "group", type, key, ...(props ? { props } : {}) }),
    register: (props) => fire({ op: "register", props }),
    reset: () => fire({ op: "reset" }),
    optIn: () => fire({ op: "optIn" }),
    optOut: () => fire({ op: "optOut" }),
    setConsent: (update) => fire({ op: "setConsent", update }),
    getFlag: async (key) => (await send({ op: "flag", key })) as FlagValue | undefined,
    isFeatureEnabled: async (key) => {
      const v = (await send({ op: "flag", key })) as FlagValue | undefined;
      return v !== undefined && v !== false;
    },
    getFlagPayload: (key) => send({ op: "payload", key }),
    getFlags: async () => ((await send({ op: "flags" })) as Record<string, FlagValue> | undefined) ?? {},
    distinctId: async () => ((await send({ op: "distinctId" })) as string | undefined) ?? "",
    flush: async () => void (await send({ op: "flush" })),
  };
  if (guess.page && opts.screen !== false) client.screen(guess.page);
  return client;
}
