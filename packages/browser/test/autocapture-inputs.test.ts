import { afterEach, describe, expect, it } from "vitest";
import type { Client } from "../src/index.js";
import { start, tick } from "./helpers.js";

let live: Client | undefined;
afterEach(async () => {
  document.body.innerHTML = "";
  await live?.shutdown();
  live = undefined;
});

const fire = (sel: string, ev: Event) => document.querySelector(sel)!.dispatchEvent(ev);
const page = `<button id="b">Buy</button><input id="i" type="text"><form id="f"><input id="x"></form>`;
const types = (t: ReturnType<typeof start>["t"]) => t.events().filter((e) => e.event === "$autocapture").map((e) => e.properties.$event_type);

async function run(remote: unknown) {
  document.body.innerHTML = page;
  const { client, t } = start({ capturePageview: false, _h: { "/v1/config": remote } } as never);
  live = client;
  await tick(20); // remote config lands
  fire("#b", new MouseEvent("click", { bubbles: true }));
  fire("#i", new Event("change", { bubbles: true }));
  fire("#f", new Event("submit", { bubbles: true }));
  await client.flush();
  return types(t);
}

describe("autocapture_inputs remote setting", () => {
  it("false drops change and submit events but keeps clicks", async () => {
    expect(await run({ autocapture_inputs: false })).toEqual(["click"]);
  });

  it("absent keeps click, change and submit", async () => {
    expect(await run({})).toEqual(["click", "change", "submit"]);
  });
});
