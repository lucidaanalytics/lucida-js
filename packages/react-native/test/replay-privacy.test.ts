import { constants, generateKeyPairSync, privateDecrypt, publicEncrypt } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  compilePatterns,
  createClient,
  deadSwipeDecision,
  encryptSensitive,
  exposureKeyOf,
  maskPatterns,
  maskSnapshotText,
  screenMasked,
  swipeDirection,
  truncateUtf8,
} from "../src/index.js";
import type { NativeConfig, NativeReplayModule, ReplayConfig } from "../src/index.js";
import type { WireEvent } from "@lucida-analytics/sdk-core";

/** P-M17 masked screens, P-M46 text patterns and `$dead_swipe`, P-L12 controlled exposure. */

const capture = (text: string) =>
  JSON.stringify({
    width: 390,
    height: 844,
    events: [
      { type: 4, timestamp: 1, data: { href: "app://X", width: 390, height: 844 } },
      {
        type: 2,
        timestamp: 1,
        data: { node: { type: 0, id: 1, childNodes: [{ type: 2, id: 2, tagName: "html", childNodes: [{ type: 2, id: 3, tagName: "body", childNodes: [{ type: 3, id: 4, textContent: text }] }] }] } },
      },
    ],
  });

/** A stand-in for the native module: records capture options; `encryptSensitive` is real RSA-OAEP-SHA256 (node:crypto). */
function fakeModule(publicKey: KeyObject | null) {
  const m = {
    out: capture("Order 1234"),
    calls: [] as Array<Record<string, unknown>>,
    async captureWireframe(o: Record<string, unknown>) {
      m.calls.push(o);
      return m.out;
    },
    encryptSensitive(_pkcs1: string, _n: string, _e: string, plain: string) {
      if (!publicKey) return "";
      return publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from(plain, "utf8")).toString("base64");
    },
  };
  return m;
}

async function setup(replay: Partial<ReplayConfig> = {}, remote: Record<string, unknown> = {}, publicKey: KeyObject | null = null) {
  const posts: string[] = [];
  const events: WireEvent[] = [];
  const module = fakeModule(publicKey);
  let tick: () => void = () => {};
  const cfg: NativeConfig = {
    apiHost: "https://ingest.test",
    consent: { mode: "opt_out" },
    transport: { send: async () => ({ status: 200 }) },
    beforeSend: [(e) => (events.push(e), e)],
    fetch: (async (url: string, init?: RequestInit) => {
      if (url.endsWith("/v1/replay")) {
        posts.push(String(init?.body));
        return { ok: true, status: 200 };
      }
      if (url.includes("/v1/config")) return { ok: true, status: 200, json: async () => remote };
      return { ok: true, status: 200, json: async () => ({ flags: {} }) };
    }) as unknown as typeof fetch,
    replay: {
      enabled: true,
      module: module as unknown as NativeReplayModule,
      setInterval: (fn) => ((tick = fn), 1),
      clearInterval: () => {},
      deadSwipeSettleMs: 0,
      ...replay,
    },
  };
  const client = await createClient("lc_pk_x", cfg);
  const wait = () => new Promise((r) => setTimeout(r, 10));
  const run = async () => {
    tick();
    await wait();
  };
  const named = (n: string) => events.filter((e) => e.event === n).map((e) => e.properties as Record<string, unknown>);
  return { client, module, posts, run, wait, named };
}

describe("P-M17 masked screens", () => {
  it("screenMasked: exact, wildcard, case-insensitive, empty list", () => {
    expect(screenMasked("Checkout", ["Checkout"])).toBe(true);
    expect(screenMasked("CheckoutDone", ["Checkout"])).toBe(false);
    expect(screenMasked("PaymentScreen", ["pay*"])).toBe(true);
    expect(screenMasked("UserSettings", ["*settings"])).toBe(true);
    expect(screenMasked("a.b(c)", ["a.b(c)"])).toBe(true);
    expect(screenMasked("axb(c)", ["a.b(c)"])).toBe(false); // regex characters are literal
    expect(screenMasked("checkout", ["CHECKOUT"])).toBe(true);
    expect(screenMasked("Home", ["pay*"])).toBe(false);
    expect(screenMasked("Home", [])).toBe(false);
  });

  it("asks the native encoder to mask everything on a masked screen (local + remote lists)", async () => {
    const s = await setup({ maskText: false, maskScreens: ["HOME"] }, { replay_mask_screens: ["check*"] });
    s.client.screen("Checkout");
    await s.run();
    expect(s.module.calls.at(-1)).toMatchObject({ maskScreen: true, maskText: true, maskAllTextInputs: true, maskAllImages: true });
    s.client.screen("Home");
    await s.run();
    expect(s.module.calls.at(-1)).toMatchObject({ maskScreen: true });
    s.client.screen("Other");
    await s.run();
    expect(s.module.calls.at(-1)).not.toHaveProperty("maskScreen");
    expect(s.module.calls.at(-1)).toMatchObject({ maskText: false });
  });
});

describe("P-M46 text patterns", () => {
  it("maskPatterns stars matches, keeps whitespace, ignores invalid patterns", () => {
    const res = compilePatterns(["\\d+", "(", "\\bsecret\\b"]);
    expect(res).toHaveLength(2);
    expect(maskPatterns("Order 1234 secret code", res)).toBe("Order **** ****** code");
    expect(maskPatterns("card 4111 1111", compilePatterns(["\\d{4} \\d{4}"]))).toBe("card **** ****");
    expect(maskPatterns("nothing", res)).toBe("nothing");
    expect(maskPatterns("abc", [])).toBe("abc");
    expect(maskPatterns("x", compilePatterns(["a*"]))).toBe("x"); // empty matches terminate
  });

  it("maskSnapshotText applies them to text nodes and input values", () => {
    const tree = { type: 2, attributes: { value: "pin 4321" }, childNodes: [{ type: 3, textContent: "id 77" }] };
    expect(maskSnapshotText(tree, compilePatterns(["\\d+"]))).toEqual({ type: 2, attributes: { value: "pin ****" }, childNodes: [{ type: 3, textContent: "id **" }] });
  });

  it("passes patterns to native and stars the returned wireframe text", async () => {
    const s = await setup({ maskText: false, maskTextPatterns: ["secret"] }, { replay_mask_text_patterns: ["\\d+", 5] });
    await s.run();
    expect(s.module.calls.at(-1)).toMatchObject({ maskTextPatterns: ["secret", "\\d+"] });
    expect(s.posts.join()).toContain("Order ****");
    expect(s.posts.join()).not.toContain("1234");
  });
});

describe("P-M46 dead swipe", () => {
  it("swipeDirection and deadSwipeDecision", () => {
    expect(swipeDirection(-60, 10)).toBe("left");
    expect(swipeDirection(60, -10)).toBe("right");
    expect(swipeDirection(5, -70)).toBe("up");
    expect(swipeDirection(5, 70)).toBe("down");
    const d = (screen: string, a: string, b: string, dx: number, dy: number, nowMs: number, lastAt?: number) =>
      deadSwipeDecision({ screen, startScreen: "A", startFingerprint: a, endFingerprint: b, dx, dy, nowMs, lastAt });
    expect(d("A", "x", "x", 0, -100.4, 5000)).toEqual({ $screen_name: "A", $swipe_direction: "up", $swipe_distance: 100 });
    expect(d("A", "x", "x", 30, 30, 0)).toBeNull();
    expect(d("A", "x", "y", 100, 0, 0)).toBeNull();
    expect(d("B", "x", "x", 100, 0, 0)).toBeNull();
    expect(d("A", "x", "x", 100, 0, 1999, 0)).toBeNull();
    expect(d("A", "x", "x", 100, 0, 2000, 0)).not.toBeNull();
  });

  it("captures $dead_swipe only while recording, once per 2 s, not when the screen changed", async () => {
    const s = await setup();
    s.client.screen("Feed");
    s.client.replay.swipeBegan();
    s.client.replay.swipeEnded(0, -200);
    await s.wait();
    expect(s.named("$dead_swipe")).toHaveLength(0);
    await s.run();
    s.client.replay.swipeBegan();
    s.client.replay.swipeEnded(0, -200);
    await s.wait();
    expect(s.named("$dead_swipe")).toEqual([expect.objectContaining({ $screen_name: "Feed", $swipe_direction: "up", $swipe_distance: 200 })]);
    expect(JSON.stringify(s.named("$dead_swipe"))).not.toContain("Order");
    s.client.replay.swipeBegan();
    s.client.replay.swipeEnded(100, 0);
    await s.wait();
    expect(s.named("$dead_swipe")).toHaveLength(1);

    const s2 = await setup();
    await s2.run();
    s2.client.replay.swipeBegan();
    await s2.wait();
    s2.module.out = capture("Order 9999 moved");
    s2.client.replay.swipeEnded(0, -200);
    await s2.wait();
    expect(s2.named("$dead_swipe")).toHaveLength(0);

    const off = await setup({ captureDeadSwipes: false });
    await off.run();
    off.client.replay.swipeBegan();
    off.client.replay.swipeEnded(0, -200);
    await off.wait();
    expect(off.named("$dead_swipe")).toHaveLength(0);
  });
});

describe("P-L12 controlled exposure", () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const decrypt = (b64: string) =>
    privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from(b64, "base64")).toString("utf8");
  const key = { kid: "k1", n: "bg", e: "AQAB", pkcs1: "AA==" };

  it("truncateUtf8 cuts on a code point boundary", () => {
    expect(truncateUtf8(`${"a".repeat(189)}é`)).toEqual({ text: "a".repeat(189), truncated: true });
    expect(truncateUtf8("😀".repeat(48))).toEqual({ text: "😀".repeat(47), truncated: true });
    expect(truncateUtf8("short")).toEqual({ text: "short", truncated: false });
  });

  it("encryptSensitive fails closed and exposureKeyOf needs all four parts", () => {
    expect(encryptSensitive(undefined, key, "x")).toBeNull();
    expect(encryptSensitive({ encryptSensitive: () => "" }, key, "x")).toBeNull();
    expect(encryptSensitive({ encryptSensitive: () => { throw new Error("no"); } }, key, "x")).toBeNull();
    expect(encryptSensitive({ encryptSensitive: (p, n, e, plain) => `${p}|${n}|${e}|${plain}` }, key, "x")).toBe("AA==|bg|AQAB|x");
    expect(exposureKeyOf(key)).toEqual(key);
    expect(exposureKeyOf({ kid: "k" })).toBeNull();
    expect(exposureKeyOf(null)).toBeNull();
  });

  it("captureSensitive needs the listed field, the key and consent; dedupes; never sends plaintext", async () => {
    const s = await setup({}, { replay_exposure_fields: ["card", "iban"], replay_exposure_key: key }, publicKey);
    s.client.screen("Pay");
    expect(s.client.captureSensitive("card", "4111")).toBe(false); // remote config not loaded yet
    await s.run();
    expect(s.client.captureSensitive("card", "4111 1111")).toBe(true);
    const [p] = s.named("$sensitive_capture");
    expect(p).toMatchObject({ $exposure_field: "card", $exposure_kid: "k1", $screen_name: "Pay" });
    expect(p).not.toHaveProperty("$exposure_truncated");
    expect(decrypt(p!.$exposure_ciphertext as string)).toBe("4111 1111");
    expect(JSON.stringify(s.named("$sensitive_capture"))).not.toContain("4111");
    expect(s.client.captureSensitive("card", "4111 1111")).toBe(false);
    expect(s.client.captureSensitive("iban", "x".repeat(300))).toBe(true);
    expect(s.named("$sensitive_capture").at(-1)).toMatchObject({ $exposure_truncated: true });
    expect(s.client.captureSensitive("email", "a@b.c")).toBe(false);
    s.client.optOut();
    expect(s.client.captureSensitive("card", "other")).toBe(false);

    const failing = await setup({}, { replay_exposure_fields: ["card"], replay_exposure_key: key }, null);
    await failing.run();
    expect(failing.client.captureSensitive("card", "4111")).toBe(false);
  });
});
