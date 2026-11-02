import type { WireEvent } from "@lucida-analytics/sdk-core";
import type { Client, Host } from "./types.js";

/** What the SDK hands a devtools hook: enough to inspect events and open the toolbar or a replay. */
export interface DevtoolsTarget {
  readonly projectKeyPrefix: string;
  readonly apiHost: string;
  distinctId(): string;
  loadToolbar(token: string): Promise<boolean>;
  /** Starts recording (bypassing sampling and triggers, never consent); false when the replay module is absent. */
  startReplay(): Promise<boolean>;
  replayUrl(): string;
}

/**
 * Hook a devtools extension (the Lucida Chrome extension, P-M36) defines on the page before the SDK
 * boots, like React DevTools. Absent by default, so this costs one property read.
 */
export interface DevtoolsHook {
  attach(t: DevtoolsTarget): void;
  emit(e: WireEvent): void;
}

const KEY = "__LUCIDA_DEVTOOLS_HOOK__";

/** Wire the SDK to `window.__LUCIDA_DEVTOOLS_HOOK__` when an extension installed one. Events stay in the page. */
export function connectDevtools(host: Host, client: Client, apiHost: string): void {
  const hook = (globalThis as Record<string, unknown>)[KEY] as DevtoolsHook | undefined;
  if (!hook || typeof hook.emit !== "function" || typeof hook.attach !== "function") return;
  host.onCapture((e) => {
    try {
      hook.emit(e);
    } catch {
      // a broken hook must never break capture
    }
  });
  try {
    hook.attach({
      projectKeyPrefix: host.apiKey.slice(0, 8),
      apiHost,
      distinctId: () => client.distinctId,
      loadToolbar: (t) => client.loadToolbar(t),
      startReplay: async () => {
        if (!host.replay) return false;
        await host.replay.start(true);
        return host.replay.isRecording();
      },
      replayUrl: () => client.getReplayUrl(),
    });
  } catch {
    // same: the page keeps working when the extension misbehaves
  }
}
