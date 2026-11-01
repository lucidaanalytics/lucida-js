import { describe, expect, it, vi } from "vitest";
import { rageHint, watchDeadClick } from "../src/autocapture/frustration.js";
import type { Host } from "../src/index.js";

const click = (x: number, y: number) => ({ clientX: x, clientY: y }) as MouseEvent;

describe("client frustration hints (G13)", () => {
  it("flags the 3rd click within 1s/30px as $rageclick with a count", () => {
    const t = 1_000_000;
    expect(rageHint(click(10, 10), t)).toEqual({});
    expect(rageHint(click(12, 11), t + 200)).toEqual({});
    expect(rageHint(click(11, 12), t + 400)).toEqual({ $rageclick: true, $rageclick_count: 3 });
    expect(rageHint(click(300, 300), t + 500)).toEqual({}); // far away
    expect(rageHint(click(11, 12), t + 5000)).toEqual({}); // window expired
  });

  it("sends $deadclick_hint only when nothing mutates the DOM", async () => {
    vi.useFakeTimers();
    const capture = vi.fn();
    const host = { client: { capture }, onUnload: () => {} } as unknown as Host;
    watchDeadClick(host, "div#a", 100);
    await vi.advanceTimersByTimeAsync(150);
    expect(capture).toHaveBeenCalledWith("$deadclick_hint", { $selector: "div#a", $no_mutation_ms: 100 });

    capture.mockClear();
    watchDeadClick(host, "div#b", 100);
    document.body.appendChild(document.createElement("p"));
    await vi.advanceTimersByTimeAsync(150);
    expect(capture).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
