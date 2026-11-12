import { afterEach, describe, expect, it, vi } from "vitest";
import { correlate } from "../src/watchtower/correlate.js";
import type { Client } from "../src/index.js";
import { startWith } from "./helpers.js";

const g = globalThis as Record<string, unknown>;
let live: Client[] = [];
afterEach(async () => {
  await Promise.all(live.map((c) => c.shutdown()));
  live = [];
  delete g.watchtower;
  delete g.lucida;
  delete g.__lucidaWatchtowerHint;
  vi.restoreAllMocks();
});

const boot = (exposeGlobal = false) => {
  const { client } = startWith([correlate], { exposeGlobal });
  live.push(client);
};

describe("exposeGlobal hint for Watchtower", () => {
  it("logs one hint naming exposeGlobal when Watchtower is exposed and Lucida is not", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    g.watchtower = { setAttribute: () => {} };
    boot();
    boot();
    expect(info).toHaveBeenCalledTimes(1);
    expect(String(info.mock.calls[0]![0])).toContain("exposeGlobal");
  });

  it("logs when Watchtower announces itself later via watchtower:ready", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    boot();
    expect(info).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("watchtower:ready"));
    expect(info).toHaveBeenCalledTimes(1);
  });

  it("stays quiet when exposeGlobal is on or Watchtower is absent", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    g.watchtower = { setAttribute: () => {} };
    boot(true);
    expect(info).not.toHaveBeenCalled();
    delete g.watchtower;
    boot();
    expect(info).not.toHaveBeenCalled();
  });
});
