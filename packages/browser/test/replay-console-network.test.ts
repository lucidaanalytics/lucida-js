import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureConsole } from "../src/replay/console.js";
import type { ConsoleEntry } from "../src/replay/console.js";
import { captureNetwork } from "../src/replay/network.js";
import type { NetworkEntry, NetworkOptions } from "../src/replay/network.js";
import { redactBody, redactHeaders, safeString } from "../src/replay/redact.js";

describe("redaction", () => {
  it("always redacts credentials headers", () => {
    const h = redactHeaders({ Authorization: "Bearer x", cookie: "a=b", "Set-Cookie": "s=1", accept: "json" });
    expect(h).toEqual({ Authorization: "[redacted]", cookie: "[redacted]", "Set-Cookie": "[redacted]", accept: "json" });
  });
  it("redacts password-like fields in JSON (nested) and form bodies", () => {
    expect(JSON.parse(redactBody('{"user":"a","password":"p","n":{"apiKey":"k","ok":1}}') ?? "")).toEqual({
      user: "a",
      password: "[redacted]",
      n: { apiKey: "[redacted]", ok: 1 },
    });
    expect(redactBody("user=a&password=p")).toBe("user=a&password=%5Bredacted%5D");
    expect(redactBody(new Blob(["x"]))).toBe("[binary]");
  });
  it("truncates long bodies and console args", () => {
    expect(redactBody("x".repeat(10_000))?.length).toBeLessThan(4200);
    expect(safeString("y".repeat(5000)).length).toBeLessThan(1100);
  });
  it("serializes cycles and DOM nodes without throwing", () => {
    const a: Record<string, unknown> = { el: document.createElement("div") };
    a.self = a;
    expect(safeString(a)).toBe('{"el":"<div>","self":"[Circular]"}');
    expect(safeString(new Error("boom"))).toContain("Error: boom");
  });
});

describe("console capture", () => {
  const entries: ConsoleEntry[] = [];
  let undo = (): void => {};
  let masked = false;
  let logSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    entries.length = 0;
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    undo = captureConsole((e) => entries.push(e), () => masked);
  });
  afterEach(() => {
    undo();
    masked = false;
    vi.restoreAllMocks();
  });
  it("records levels and errors, and still calls the original", () => {
    console.log("hi", { a: 1 });
    console.error("bad");
    window.dispatchEvent(new ErrorEvent("error", { message: "oops", error: new Error("oops") }));
    expect(entries.map((e) => e.level)).toEqual(["log", "error", "error"]);
    expect(entries[0]?.args).toEqual(["hi", '{"a":1}']);
    expect(entries[2]?.args[0]).toContain("oops");
    expect(logSpy).toHaveBeenCalledWith("hi", { a: 1 });
  });
  it("withholds the text under masking", () => {
    masked = true;
    console.log("secret");
    expect(entries[0]).toEqual({ level: "log", args: ["[masked]"] });
  });
  it("restores console on undo", () => {
    undo();
    console.log("x");
    expect(entries).toHaveLength(0);
  });
});

describe("network capture", () => {
  const out: NetworkEntry[] = [];
  let undo = (): void => {};
  const realFetch = window.fetch;
  const setup = (o: NetworkOptions, status = 200): void => {
    window.fetch = vi.fn(async () => new Response('{"token":"t","ok":1}', { status, headers: { "set-cookie": "s=1", "content-length": "20" } })) as never;
    undo = captureNetwork((e) => out.push(e), o, (u) => u.startsWith("https://api.lucida.test/v1/"));
  };
  beforeEach(() => (out.length = 0));
  afterEach(() => {
    undo();
    window.fetch = realFetch;
  });
  const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

  it("records url, method, status, timing and size without headers or bodies by default", async () => {
    setup({}, 503);
    await fetch("https://x.test/a", { method: "post", body: "{}" });
    await settle();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ method: "POST", url: "https://x.test/a", status: 503, type: "fetch", size: 20 });
    expect(out[0]?.req).toBeUndefined();
    expect(out[0]?.res).toBeUndefined();
  });
  it("records headers and bodies only when enabled, redacted", async () => {
    setup({ headers: true, body: true });
    await fetch("https://x.test/a", { method: "POST", headers: { Authorization: "Bearer z", a: "b" }, body: '{"password":"p","q":1}' });
    await settle();
    expect(out[0]?.req?.headers).toMatchObject({ authorization: "[redacted]", a: "b" });
    expect(out[0]?.req?.body).toBe('{"password":"[redacted]","q":1}');
    expect(out[0]?.res?.headers?.["set-cookie"]).toBe("[redacted]");
    expect(out[0]?.res?.body).toBe('{"token":"[redacted]","ok":1}');
  });
  it("never records the SDK's own requests, and honours deny / allow / redact", async () => {
    setup({ deny: ["/health", /private/], allow: ["x.test", "api.lucida.test"], redact: (e) => (e.url.includes("drop") ? null : { ...e, url: e.url.split("?")[0] ?? e.url }) });
    for (const u of ["https://api.lucida.test/v1/batch", "https://x.test/health", "https://x.test/private", "https://other.test/a", "https://x.test/drop", "https://x.test/ok?q=1"]) await fetch(u);
    await settle();
    expect(out.map((e) => e.url)).toEqual(["https://x.test/ok"]);
  });
  it("records a failed request as status 0", async () => {
    setup({});
    window.fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as never;
    undo();
    undo = captureNetwork((e) => out.push(e), {}, () => false);
    await expect(fetch("https://x.test/a")).rejects.toThrow();
    await settle();
    expect(out[0]).toMatchObject({ status: 0, error: "Failed to fetch" });
  });
  it("wraps XMLHttpRequest", async () => {
    setup({ headers: true });
    const xhr = new XMLHttpRequest();
    const sent = new Promise((r) => xhr.addEventListener("loadend", r));
    xhr.open("GET", "http://localhost/none"); // jsdom: connection refused -> status 0
    xhr.setRequestHeader("Cookie", "a=1");
    xhr.send();
    await sent;
    await settle();
    expect(out[0]).toMatchObject({ method: "GET", type: "xhr", status: 0 });
    expect(out[0]?.req?.headers?.cookie).toBe("[redacted]");
  });
});
