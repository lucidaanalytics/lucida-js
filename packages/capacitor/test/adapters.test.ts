import { describe, expect, it } from "vitest";
import { appLifecycle, preferencesStorage, stripReserved } from "../src/index.js";
import { fakeApp, fakePreferences, tick } from "./support.js";

describe("preferencesStorage", () => {
  it("hydrates the persisted keys under the lucida. prefix and writes behind", async () => {
    const { prefs, data } = fakePreferences({ "lucida.lc_identity": "{\"distinct_id\":\"d\"}", "other.key": "x" });
    const { storage, ready } = preferencesStorage(prefs);
    await ready;
    expect(storage.get("lc_identity")).toBe("{\"distinct_id\":\"d\"}");
    expect(storage.get("other.key")).toBeNull();
    storage.set("lc_session", "s");
    expect(storage.get("lc_session")).toBe("s");
    await tick();
    expect(data.get("lucida.lc_session")).toBe("s");
    storage.remove("lc_identity");
    await tick();
    expect(data.has("lucida.lc_identity")).toBe(false);
  });

  it("starts empty when Preferences fails", async () => {
    const { storage, ready } = preferencesStorage({
      get: () => Promise.reject(new Error("boom")),
      set: () => Promise.reject(new Error("boom")),
      remove: () => Promise.reject(new Error("boom")),
    });
    await ready;
    expect(storage.get("lc_identity")).toBeNull();
    storage.set("lc_identity", "v"); // a failed write is swallowed, the memory copy stays
    await tick();
    expect(storage.get("lc_identity")).toBe("v");
  });
});

describe("appLifecycle", () => {
  it("fires once per transition and unsubscribes", async () => {
    const app = fakeApp();
    const seen: string[] = [];
    const stop = appLifecycle(app, { onForeground: () => seen.push("fg"), onBackground: () => seen.push("bg") });
    app.emit(true);
    app.emit(false);
    app.emit(false);
    app.emit(true);
    expect(seen).toEqual(["bg", "fg"]);
    await tick();
    stop();
    await tick();
    expect(app.listeners).toBe(0);
  });
});

describe("stripReserved", () => {
  it("drops $lc_* keys only", () => {
    expect(stripReserved({ $lc_org: 1, $os: "ios", a: 2 })).toEqual({ $os: "ios", a: 2 });
    expect(stripReserved(undefined)).toEqual({});
  });
});
