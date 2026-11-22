// The slice of the WebExtensions API the SDK uses; `chrome` in Chrome/Edge/Brave/Opera, `browser` in Firefox (same shape in MV3).
export interface Ev<F> { addListener(f: F): void; removeListener?(f: F): void }

export interface StorageAreaLike {
  get(keys: null | string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export interface InstalledDetails { reason: string; previousVersion?: string }

export interface ChromeLike {
  runtime: {
    id: string;
    getManifest(): { version: string; name?: string; manifest_version?: number };
    getPlatformInfo?(): Promise<{ os: string; arch?: string }>;
    setUninstallURL?(url: string): Promise<void> | void;
    sendMessage(msg: unknown): Promise<unknown>;
    onInstalled?: Ev<(d: InstalledDetails) => void>;
    onStartup?: Ev<() => void>;
    onSuspend?: Ev<() => void>;
    onMessage: Ev<(msg: unknown, sender: { tab?: { url?: string } ; url?: string }, reply: (r: unknown) => void) => boolean | undefined>;
  };
  /** Present only with the "storage" permission in manifest.json. */
  storage?: { local?: StorageAreaLike };
}

export function webExtension(): ChromeLike | undefined {
  const g = globalThis as { browser?: ChromeLike; chrome?: ChromeLike };
  const x = g.browser?.runtime?.id ? g.browser : g.chrome;
  return x?.runtime?.id ? x : undefined;
}
