import { afterEach, describe, expect, it, vi } from "vitest";
import type { Confetti, ToolbarApi } from "../src/toolbar/api.js";
import { breakdownParam, confettiColour } from "../src/toolbar/confetti.js";
import { heatPanel } from "../src/toolbar/heat.js";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const data: Confetti = {
  legend: [
    { value: "pro", clicks: 2 },
    { value: "(other)", clicks: 1 },
  ],
  dots: [
    [0.1, 10, 0],
    [0.2, 20, 0],
    [0.3, 30, 1],
  ],
};

describe("toolbar confetti (N-DXA-3)", () => {
  it("builds the breakdown param and greys out (other)", () => {
    expect(breakdownParam("person", " plan ")).toBe("person:plan");
    expect(breakdownParam("event", "")).toBe("");
    expect(breakdownParam("device", "ignored")).toBe("device");
    expect(confettiColour(1, data.legend)).toBe("#9e9e9e");
    expect(confettiColour(0, data.legend)).not.toBe("#9e9e9e");
  });

  it("draws click dots coloured by a property and the legend toggles a value off", async () => {
    const arcs: number[] = [];
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      beginPath() {},
      fill() {},
      arc(_x: number, y: number) {
        arcs.push(y);
      },
    } as unknown as CanvasRenderingContext2D);
    const confetti = vi.fn(async () => data);
    const api = { confetti, elements: async () => ({ key: "selector", data: [], next_cursor: null }) } as unknown as ToolbarApi;
    const notes: string[] = [];
    const { node } = heatPanel({ api, note: (t) => notes.push(t), onPick: () => {} });
    document.body.append(node);
    const [, colourBy] = node.querySelectorAll("select");
    colourBy!.value = "person";
    node.querySelector<HTMLInputElement>('input[placeholder="property key"]')!.value = "plan";
    [...node.querySelectorAll("button")].find((b) => b.textContent === "Show heatmap")!.click();

    await vi.waitFor(() => expect(node.querySelector('[aria-label="Confetti legend"]')).toBeTruthy());
    expect(confetti).toHaveBeenCalledWith(expect.any(String), expect.any(String), "person:plan");
    expect(document.querySelector('canvas[aria-label="Confetti of 3 clicks"]')).toBeTruthy();
    expect(arcs).toEqual([10, 20, 30]);
    expect(node.textContent).toContain("pro (2)");

    arcs.length = 0;
    const pro = node.querySelector<HTMLInputElement>('[aria-label="Confetti legend"] input')!;
    pro.checked = false;
    pro.dispatchEvent(new Event("change"));
    expect(arcs).toEqual([30]);
    expect(notes.at(-1)).toContain("coloured by person:plan");
  });
});
