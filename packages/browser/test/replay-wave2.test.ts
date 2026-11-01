import { afterEach, describe, expect, it, vi } from "vitest";
import { assetScrubber, resolveAssets } from "../src/replay/assets.js";
import { maskedCanvasSampler, regionsFor } from "../src/replay/canvas.js";
import { attachReplayUrl } from "../src/replay/support.js";
import { mutationThrottle } from "../src/replay/throttle.js";
import { resolveReplay } from "../src/replay/index.js";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

const mutation = (attrs: Array<{ id: number; attributes: Record<string, unknown> }>, adds: unknown[] = []) =>
  ({ type: 3, data: { source: 0, attributes: attrs, adds, removes: [], texts: [] } }) as never;

describe("attribute-mutation throttle (LC-EXP-65)", () => {
  it("drops one element's changes beyond its bucket, keeps other elements and structural changes", () => {
    let now = 0;
    const t = mutationThrottle({ burst: 2, perSecond: 1 }, () => now);
    const spam = (): boolean => t.allow(mutation([{ id: 7, attributes: { style: "x" } }]));
    expect([spam(), spam(), spam()]).toEqual([true, true, false]);
    expect(t.dropped).toBe(1);
    const mixed = mutation([{ id: 7, attributes: { style: "y" } }, { id: 8, attributes: { class: "a" } }]);
    expect(t.allow(mixed)).toBe(true);
    expect((mixed as { data: { attributes: unknown[] } }).data.attributes).toEqual([{ id: 8, attributes: { class: "a" } }]);
    expect(t.allow(mutation([{ id: 7, attributes: { style: "z" } }], [{ parentId: 1, node: { type: 3, id: 9 } }]))).toBe(true); // adds survive
    now = 1000; // refilled one token
    expect(spam()).toBe(true);
    expect(t.allow({ type: 2, data: {} } as never)).toBe(true);
  });

  it("is on by default and can be turned off locally", () => {
    expect(resolveReplay({}, null)?.mutationThrottle).toEqual({});
    expect(resolveReplay({ mutationThrottle: false }, null)?.mutationThrottle).toBeNull();
  });
});

describe("asset inlining and proxying (LC-EXP-64)", () => {
  const trusted = [location.origin, "https://lucida.test"];
  it("accepts a proxy only on the page or Lucida origin, and refuses inlining under mask-all-text", () => {
    expect(resolveAssets(undefined, false, trusted)).toBeNull();
    expect(resolveAssets({ proxy: { url: "https://evil.test/p", origins: ["https://cdn.test"] } }, false, trusted)?.proxy).toBeNull();
    expect(resolveAssets({ proxy: { url: "/asset-proxy", origins: ["https://cdn.test"] } }, false, trusted)?.proxy?.url).toBe(`${location.origin}/asset-proxy`);
    expect(resolveAssets({ inlineImages: true }, true, trusted)?.inlineImages).toBe(false);
    expect(resolveAssets({ inlineImages: true }, false, trusted)?.inlineImages).toBe(true);
  });

  it("rewrites allowlisted asset URLs in snapshots, mutations and CSS rules; caps inlined images", () => {
    const a = resolveAssets({ maxInlineBytes: 10, proxy: { url: "https://lucida.test/proxy", origins: ["https://cdn.test"] } }, false, trusted)!;
    const s = assetScrubber(a);
    const snap = {
      type: 2,
      data: {
        node: {
          type: 0,
          id: 1,
          childNodes: [
            { type: 2, id: 2, tagName: "img", attributes: { src: "https://cdn.test/a.png", srcset: "https://cdn.test/a@2x.png 2x, /local.png 1x", rr_dataURL: "data:image/png;base64,AAAAAAAAAAAAAAAA" } },
            { type: 2, id: 3, tagName: "link", attributes: { rel: "stylesheet", href: "https://cdn.test/s.css" } },
            { type: 2, id: 4, tagName: "style", attributes: { _cssText: "@font-face{src:url('https://cdn.test/f.woff2')} b{background:url(https://other.test/x.png)}" } },
            { type: 2, id: 5, tagName: "a", attributes: { href: "https://cdn.test/page" } },
          ],
        },
      },
    };
    s.scrub(snap as never, () => null);
    const [img, link, style, anchor] = snap.data.node.childNodes.map((n) => n.attributes as Record<string, string>);
    const px = (u: string) => `https://lucida.test/proxy?url=${encodeURIComponent(u)}`;
    expect(img!.src).toBe(px("https://cdn.test/a.png"));
    expect(img!.srcset).toBe(`${px("https://cdn.test/a@2x.png")} 2x, /local.png 1x`);
    expect(img!.rr_dataURL).toBeUndefined(); // over the cap
    expect(link!.href).toBe(px("https://cdn.test/s.css"));
    expect(style!._cssText).toContain(`url('${px("https://cdn.test/f.woff2")}')`);
    expect(style!._cssText).toContain("url(https://other.test/x.png)"); // not allowlisted
    expect(anchor!.href).toBe("https://cdn.test/page"); // links are not assets
    const rule = { type: 3, data: { source: 8, adds: [{ rule: "i{background:url(https://cdn.test/i.png)}" }] } };
    s.scrub(rule as never, () => null);
    expect(rule.data.adds[0]!.rule).toBe(`i{background:url(${px("https://cdn.test/i.png")})}`);
  });
});

describe("canvas mask regions (LC-EXP-23 / LC-EXP-59)", () => {
  it("unions local and remote regions; remote rules without regions and bad selectors mask everything", () => {
    document.body.innerHTML = `<canvas id="map" width="100" height="50"></canvas>`;
    const c = document.querySelector("canvas")!;
    const whole = { x: 0, y: 0, width: 100, height: 50 };
    expect(regionsFor(c, [], () => [{ x: 1, y: 2, width: 3, height: 4 }])).toEqual([{ x: 1, y: 2, width: 3, height: 4 }]);
    expect(regionsFor(c, [{ selector: "#map" }, { selector: "#other", regions: [] }], undefined)).toEqual([whole]);
    expect(regionsFor(c, [{ selector: "##bad" }])).toEqual([whole]);
    expect(regionsFor(c, [], () => { throw new Error("x"); })).toEqual([whole]);
    expect(resolveReplay({}, { replay_canvas_mask: [{ selector: "#map" }, { nope: 1 }] } as never)?.canvasMask).toEqual([{ selector: "#map" }]);
  });

  it("paints regions before encoding and emits rrweb canvas mutations, deduped, skipping blocked canvases", () => {
    document.body.innerHTML = `<canvas id="a" width="10" height="10"></canvas><div data-lc-block><canvas id="b" width="10" height="10"></canvas></div>`;
    const ops: string[] = [];
    let frame = "AAAA";
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ({
      drawImage: () => ops.push("draw"),
      fillRect: (...a: number[]) => ops.push(`fill:${a.join(",")}`),
      set fillStyle(_v: string) {},
    }) as never);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(() => (ops.push("encode"), `data:image/jpeg;base64,${frame}`));
    const out: Array<{ data: { id: number; source: number; commands: Array<{ property: string; args: unknown[] }> } }> = [];
    const s = maskedCanvasSampler({ fps: 1, quality: 0.5, skip: "[data-lc-block]", rules: [], regionsFn: () => [{ x: 1, y: 1, width: 2, height: 2 }], idOf: (c) => (c.id === "a" ? 4 : 5), emit: (e) => out.push(e as never) });
    s.tick();
    s.tick(); // same frame: not resent
    expect(ops).toEqual(["draw", "fill:1,1,2,2", "encode", "draw", "fill:1,1,2,2", "encode"]);
    expect(out).toHaveLength(1);
    expect(out[0]!.data).toMatchObject({ source: 9, id: 4, type: 0 });
    expect(out[0]!.data.commands[1]!.args[0]).toEqual({ rr_type: "ImageBitmap", args: [{ rr_type: "Blob", data: [{ rr_type: "ArrayBuffer", base64: "AAAA" }], type: "image/jpeg" }] });
    s.reset();
    s.tick();
    frame = "BBBB";
    s.tick();
    expect(out).toHaveLength(3);
    s.stop();
  });
});

describe("support widget replay link (LC-EXP-28)", () => {
  it("hands the replay URL to Intercom and Crisp once per session while recording", () => {
    vi.useFakeTimers();
    const w = globalThis as { Intercom?: unknown; $crisp?: unknown };
    const intercom = vi.fn();
    const crisp: unknown[] = [];
    let url = "https://app.test/replays/s1";
    let on = false;
    const stop = attachReplayUrl({ intercom: true, crisp: true }, () => url, () => on, 100);
    w.Intercom = intercom;
    w.$crisp = crisp;
    vi.advanceTimersByTime(100);
    expect(intercom).not.toHaveBeenCalled(); // not recording yet
    on = true;
    vi.advanceTimersByTime(300);
    expect(intercom.mock.calls).toEqual([["update", { lucida_replay_url: url }]]);
    expect(crisp).toEqual([["set", "session:data", [[["lucida_replay_url", url]]]]]);
    url = "https://app.test/replays/s2";
    vi.advanceTimersByTime(100);
    expect(intercom).toHaveBeenCalledTimes(2);
    stop();
    delete w.Intercom;
    delete w.$crisp;
    vi.useRealTimers();
  });
});
