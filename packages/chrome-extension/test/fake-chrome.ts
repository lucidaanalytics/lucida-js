import type { ChromeLike, InstalledDetails } from "../src/chrome.js";

type Listener = (msg: unknown, sender: { tab?: { url?: string } }, reply: (r: unknown) => void) => boolean | undefined;

export function fakeChrome(version = "1.2.0", stored: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { ...stored };
  const installed: Array<(d: InstalledDetails) => void> = [];
  const startup: Array<() => void> = [];
  const msg: Listener[] = [];
  const uninstallUrls: string[] = [];
  const chrome: ChromeLike = {
    runtime: {
      id: "abcdefghijklmnop",
      getManifest: () => ({ version, manifest_version: 3 }),
      getPlatformInfo: async () => ({ os: "mac" }),
      setUninstallURL: async (u) => void uninstallUrls.push(u),
      sendMessage: (m) =>
        new Promise((resolve) => {
          let handled = false;
          for (const l of msg) if (l(m, { tab: { url: "https://shop.test/cart?id=9" } }, resolve)) handled = true;
          if (!handled) resolve(undefined);
        }),
      onInstalled: { addListener: (f) => void installed.push(f) },
      onStartup: { addListener: (f) => void startup.push(f) },
      onMessage: { addListener: (f) => void msg.push(f) },
    },
    storage: {
      local: {
        get: async () => ({ ...data }),
        set: async (items) => void Object.assign(data, items),
        remove: async (k) => void [k].flat().forEach((x) => delete data[x]),
      },
    },
  };
  return { chrome, data, uninstallUrls, fireInstalled: (d: InstalledDetails) => installed.forEach((f) => f(d)), fireStartup: () => startup.forEach((f) => f()), listeners: msg };
}

export function recorder() {
  const batches: Array<{ batch: Array<{ event: string; distinct_id?: string; properties: Record<string, unknown> }> }> = [];
  return {
    batches,
    events: () => batches.flatMap((b) => b.batch),
    transport: { send: async (_u: string, body: string) => (batches.push(JSON.parse(body)), { status: 200 }) },
  };
}
