import { afterEach, describe, expect, it, vi } from "vitest";
import { keyCounter } from "../src/replay/keycount.js";

const press = (el: Element, key: string, repeat = false) =>
  el.dispatchEvent(new KeyboardEvent("keydown", { key, repeat, bubbles: true }));

describe("keyCounter", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("counts presses, skips repeats, modifiers, passwords and masked fields", () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<input id="t"><input id="p" type="password"><div data-lc-mask><input id="m"></div>';
    const sent: number[] = [];
    const k = keyCounter((n) => (sent.push(n), true), () => "[data-lc-mask]");
    const t = document.getElementById("t")!;
    press(t, "a");
    press(t, "b");
    press(t, "b", true);
    press(t, "Shift");
    press(document.getElementById("p")!, "x");
    press(document.getElementById("m")!, "y");
    vi.advanceTimersByTime(1000);
    expect(sent).toEqual([2]);
    k.stop();
  });

  it("keeps the count when the recorder is not ready", () => {
    vi.useFakeTimers();
    let ready = false;
    const sent: number[] = [];
    const k = keyCounter((n) => (ready ? (sent.push(n), true) : false), () => "");
    press(document.body, "a");
    vi.advanceTimersByTime(1000);
    ready = true;
    press(document.body, "b");
    vi.advanceTimersByTime(1000);
    expect(sent).toEqual([2]);
    k.stop();
  });
});
