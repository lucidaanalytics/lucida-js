/** Support widgets that get this session's replay link (LC-EXP-28). Opt-in, local config only. */
export interface SupportWidgets {
  /** `Intercom("update", { lucida_replay_url })` once Intercom is on the page. */
  intercom?: boolean;
  /** `$crisp.push(["set", "session:data", [[["lucida_replay_url", url]]]])` once Crisp is on the page. */
  crisp?: boolean;
}

interface WidgetGlobals {
  Intercom?: (cmd: string, data?: unknown) => void;
  $crisp?: { push(cmd: unknown[]): void };
}

export const SUPPORT_KEY = "lucida_replay_url";

/**
 * Pushes `url()` to the configured widgets while `active()` (recording), checking every `everyMs` because the
 * widgets load late and the session can rotate; each widget gets a link once per session.
 */
export function attachReplayUrl(o: SupportWidgets, url: () => string, active: () => boolean, everyMs = 2000): () => void {
  const sent: Record<string, string> = {};
  const tick = (): void => {
    if (!active()) return;
    const w = globalThis as WidgetGlobals;
    const u = url();
    try {
      if (o.intercom && typeof w.Intercom === "function" && sent.intercom !== u) {
        w.Intercom("update", { [SUPPORT_KEY]: u });
        sent.intercom = u;
      }
      if (o.crisp && typeof w.$crisp?.push === "function" && sent.crisp !== u) {
        w.$crisp.push(["set", "session:data", [[[SUPPORT_KEY, u]]]]);
        sent.crisp = u;
      }
    } catch {
      /* a broken widget must not break recording */
    }
  };
  tick();
  const timer = setInterval(tick, everyMs);
  return () => clearInterval(timer);
}
