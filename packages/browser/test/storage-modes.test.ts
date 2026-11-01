import { afterEach, describe, expect, it, vi } from "vitest";
import { CombinedStorage, CookieStorage, DebouncedStorage, LocalStorageAdapter, MemoryStorage, createStorage } from "../src/storage.js";
import type { Client } from "../src/index.js";
import { start } from "./helpers.js";

const KEY = "lc_pk_test";
const SUFFIX = "__pk_test";
const base = { capturePageview: false, autocapture: false } as const;

let live: Client | undefined;
afterEach(async () => {
  await live?.shutdown();
  live = undefined;
  localStorage.clear();
  sessionStorage.clear();
  for (const c of document.cookie.split("; ")) if (c) document.cookie = `${c.split("=")[0]}=; Max-Age=0; Path=/`;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("persistence modes", () => {
  it("sessionStorage keeps state in the tab's sessionStorage only", async () => {
    const { client } = start({ ...base, persistence: "sessionStorage" }, KEY);
    live = client;
    client.capture("e");
    expect(JSON.parse(sessionStorage.getItem(`lc_identity${SUFFIX}`)!).distinct_id).toBe(client.distinctId);
    expect(localStorage.length).toBe(0);
    expect(document.cookie).toBe("");
  });

  it("localStorage+cookie: identity in both, other keys only in localStorage", () => {
    const { client } = start({ ...base, persistence: "localStorage+cookie" }, KEY);
    live = client;
    client.register({ plan: "pro" });
    client.capture("e");
    expect(document.cookie).toContain(`lc_identity${SUFFIX}=`);
    expect(localStorage.getItem(`lc_identity${SUFFIX}`)).not.toBeNull();
    expect(localStorage.getItem(`lc_props${SUFFIX}`)).toContain("pro");
    expect(document.cookie).not.toContain(`lc_props${SUFFIX}`);
  });

  it("combined conflict rule: identity keys prefer the cookie, others localStorage, each falls back", () => {
    const cookie = new MemoryStorage();
    const local = new MemoryStorage();
    const s = new CombinedStorage(cookie, local, (k) => k === "id");
    cookie.set("id", "from-cookie");
    local.set("id", "from-local");
    expect(s.get("id")).toBe("from-cookie");
    cookie.remove("id");
    expect(s.get("id")).toBe("from-local"); // cookie expired or cleared
    cookie.set("props", "old-cookie");
    expect(s.get("props")).toBe("old-cookie"); // left over from plain cookie mode
    local.set("props", "new");
    expect(s.get("props")).toBe("new");
    s.set("props", "x");
    expect(cookie.get("props")).toBeNull(); // realigned on write
    s.set("id", "both");
    expect([cookie.get("id"), local.get("id")]).toEqual(["both", "both"]);
  });

  it("createStorage builds every mode and round-trips", () => {
    for (const kind of ["cookie", "localStorage", "sessionStorage", "localStorage+cookie", "memory", "none"] as const) {
      const s = createStorage(kind, "lc_pk_abcdefgh");
      s.set("lc_identity", "v");
      expect(s.get("lc_identity")).toBe("v");
      s.remove("lc_identity");
      expect(s.get("lc_identity")).toBeNull();
    }
    expect(new CookieStorage()).toBeTruthy();
  });

  it("cookieless 'always' writes nothing; 'on_reject' keeps counting anonymously after a decline", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const a = start({ ...base, cookieless: "always" }, KEY);
    a.client.capture("e");
    await a.client.flush();
    expect(a.t.events()[0]).not.toHaveProperty("distinct_id");
    expect(setItem).not.toHaveBeenCalled();
    await a.client.shutdown();
    const r = start({ ...base, cookieless: "on_reject", consent: { mode: "opt_in" } }, KEY);
    live = r.client;
    r.client.setConsent({ analytics: false });
    r.client.capture("anon");
    await r.client.flush();
    const ev = r.t.events().find((e) => e.event === "anon")!;
    expect(ev).toBeDefined();
    expect(ev).not.toHaveProperty("distinct_id");
  });
});

describe("storage controls", () => {
  it("persistedProperties: only listed super properties reach storage", () => {
    const { client } = start({ ...base, persistence: "localStorage", persistedProperties: ["plan"] }, KEY);
    live = client;
    client.register({ plan: "pro", tmp: 1 });
    expect(JSON.parse(localStorage.getItem(`lc_props${SUFFIX}`)!)).toEqual({ plan: "pro" });
    expect(client.getProperty("tmp")).toBe(1);
  });

  it("debounced writes: coalesced, readable at once, written after the delay or on flush", async () => {
    const inner = new LocalStorageAdapter();
    const spy = vi.spyOn(inner, "set");
    const s = new DebouncedStorage(inner, 50);
    s.set("a", "1");
    s.set("a", "2");
    s.remove("b");
    expect(s.get("a")).toBe("2");
    expect(spy).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(localStorage.getItem("a")).toBe("2"));
    expect(spy).toHaveBeenCalledTimes(1);
    s.set("c", "3");
    s.flush();
    expect(localStorage.getItem("c")).toBe("3");
  });

  it("storageWriteDelayMs on the client: writes land after the delay and on page hide", async () => {
    const { client } = start({ ...base, persistence: "localStorage", storageWriteDelayMs: 60_000 }, KEY);
    live = client;
    client.capture("e");
    expect(localStorage.getItem(`lc_session${SUFFIX}`)).toBeNull();
    window.dispatchEvent(new Event("pagehide"));
    expect(localStorage.getItem(`lc_session${SUFFIX}`)).not.toBeNull();
  });

  it("flagPersistence keeps the flag cache in its own store, consent-gated", async () => {
    const { client } = start({
      ...base,
      persistence: "cookie",
      flagPersistence: "sessionStorage",
      consent: { mode: "opt_in" },
      _h: { "/v1/flags": { flags: { f: { enabled: true, value: true } } } },
    } as never, KEY);
    live = client;
    client.optIn();
    await vi.waitFor(() => expect(sessionStorage.getItem(`lc_flags${SUFFIX}`)).toContain('"f":true'));
    expect(document.cookie).not.toContain("lc_flags");
  });

  it("consentPersistence stores the decision in its own backend", () => {
    const { client } = start({ ...base, persistence: "memory", consentPersistence: "localStorage" }, KEY);
    live = client;
    client.optOut();
    expect(localStorage.getItem(`lc_consent${SUFFIX}`)).toContain('"analytics":false');
    expect(localStorage.getItem(`lc_identity${SUFFIX}`)).toBeNull();
  });

  it("extension mode never writes cookies (localStorage instead)", () => {
    const cookie = vi.spyOn(document, "cookie", "set");
    const { client } = start({ ...base, persistence: "cookie", extension: true }, KEY);
    live = client;
    client.capture("e");
    expect(cookie).not.toHaveBeenCalled();
    expect(localStorage.getItem(`lc_identity${SUFFIX}`)).not.toBeNull();
  });
});

describe("setConfig", () => {
  it("applies per-event options at once and merges object options one level deep", async () => {
    document.body.innerHTML = `<button id="b">Buy</button>`;
    const original = { captureText: true };
    const { client, t } = start({ capturePageview: false, autocapture: original });
    live = client;
    client.setConfig({ propertyDenylist: ["secret"], autocapture: { captureText: false } });
    client.capture("e", { secret: 1, ok: 2 });
    document.getElementById("b")!.click();
    await client.flush();
    const [e, ac] = t.events();
    expect(e!.properties).not.toHaveProperty("secret");
    expect(e!.properties.ok).toBe(2);
    expect(ac!.properties.$el_text).toBeUndefined();
    expect(original.captureText).toBe(true); // the caller's object is untouched
    client.setConfig({ beforeSend: () => null });
    client.capture("gone");
    await client.flush();
    expect(t.events().map((x) => x.event)).not.toContain("gone");
  });
});
