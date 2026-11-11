// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { cookieMunchConsent } from "@lucida-analytics/browser/consent";
import type { Module } from "@lucida-analytics/browser";
import { LucidaNextProvider } from "../src/client.js";
import { COOKIE_ID, getBootstrap, lucidaMiddleware } from "../src/index.js";
import type { RequestLike, ResponseLike } from "../src/index.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const g = globalThis as Record<string, unknown>;
const opts = { persistence: "memory", autocapture: false, capturePageview: false, consent: { mode: "opt_in" } } as const;
afterEach(() => {
  delete g.lucida;
  delete g.CookieMunch;
  document.cookie.split("; ").forEach((c) => (document.cookie = `${c.split("=")[0]}=; Max-Age=0; Path=/`));
});

const req = (cookie: string): RequestLike => {
  const jar = Object.fromEntries(cookie.split("; ").filter(Boolean).map((p) => p.split("=") as [string, string]));
  return { headers: new Headers({ cookie }), cookies: { get: (n) => (n in jar ? { value: jar[n] as string } : undefined) } };
};
const res = () => {
  const set: Array<[string, string]> = [];
  return { cookies: { set: (n: string, v: string) => void set.push([n, v]) }, set } as ResponseLike & { set: typeof set };
};

describe("modules passthrough", () => {
  it("passes modules as the third init argument (a custom module runs)", async () => {
    let ran = false;
    const mod: Module = () => {
      ran = true;
      return () => {};
    };
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<LucidaNextProvider apiKey="lc_pk_next_mod1" options={opts} modules={[mod]} />));
    await act(async () => root.unmount());
    expect(ran).toBe(true);
  });
});

describe("Cookie Munch + Next consent flow", () => {
  it("no lc_* cookie before consent; after granting the server sees lc_consent and the browser id", async () => {
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<LucidaNextProvider apiKey="lc_pk_next_mod2" options={opts} modules={[cookieMunchConsent]} />));
    expect(document.cookie).not.toMatch(/lc_/);

    g.CookieMunch = { hasResponse: true, consent: { statistics: true, marketing: false } };
    await act(async () => void window.dispatchEvent(new Event("CookieMunchOnChange")));
    expect(document.cookie).toContain("lc_consent=granted");

    const browserId = (g.lucida as { distinctId: string }).distinctId;
    const next = await lucidaMiddleware(req(document.cookie), { apiKey: "lc_pk_x", middleware: true, evaluate: async () => ({}) });
    expect(next.distinctId).toBe(browserId);
    const bootstrap = await getBootstrap(next.requestHeaders, { apiKey: "lc_pk_x", middleware: true, evaluate: async () => ({}) });
    expect(bootstrap.distinctId).toBe(browserId);
    await act(async () => root.unmount());
  });
});

describe("lucidaMiddleware consent callback", () => {
  const o = { apiKey: "lc_pk_x", evaluate: async () => ({}) };
  it("true writes the id cookie without lc_consent, false never does, undefined falls back to the cookie", async () => {
    const a = res();
    (await lucidaMiddleware(req(""), { ...o, consent: () => true })).apply(a);
    expect(a.set[0]?.[0]).toBe(COOKIE_ID);
    const b = res();
    (await lucidaMiddleware(req("lc_consent=granted"), { ...o, consent: () => false })).apply(b);
    expect(b.set).toEqual([]);
    const c = res();
    (await lucidaMiddleware(req("lc_consent=granted"), { ...o, consent: () => undefined })).apply(c);
    expect(c.set).toHaveLength(1);
  });
});
