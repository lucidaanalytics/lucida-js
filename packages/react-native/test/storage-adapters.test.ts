import { expect, it } from "vitest";
import { fileStorage } from "../src/storage/file-storage.js";
import { mmkvStorage } from "../src/storage/mmkv-storage.js";
import { expoRouterScreens } from "../src/expo-router-screens.js";

it("file storage round-trips keys, lists them and reads missing keys as null", async () => {
  const files = new Map<string, string>();
  const fs = {
    makeDirectoryAsync: async () => undefined,
    readAsStringAsync: async (u: string) => {
      if (!files.has(u)) throw new Error("missing");
      return files.get(u)!;
    },
    writeAsStringAsync: async (u: string, c: string) => void files.set(u, c),
    deleteAsync: async (u: string) => void files.delete(u),
    readDirectoryAsync: async (d: string) => [...files.keys()].filter((k) => k.startsWith(d)).map((k) => k.slice(d.length)),
  };
  const s = fileStorage(fs, "file:///docs/lucida/");
  await s.setItem("lc_replay.a b", "x");
  expect(await s.multiGet(["lc_replay.a b", "nope"])).toEqual([["lc_replay.a b", "x"], ["nope", null]]);
  expect(await s.getAllKeys!()).toEqual(["lc_replay.a b"]);
  await s.removeItem("lc_replay.a b");
  expect(await s.getAllKeys!()).toEqual([]);
});

it("mmkv adapter wraps the synchronous instance", async () => {
  const m = new Map<string, string>();
  const s = mmkvStorage({ getString: (k) => m.get(k), set: (k, v) => void m.set(k, v), delete: (k) => void m.delete(k), getAllKeys: () => [...m.keys()] });
  await s.setItem("a", "1");
  expect(await s.multiGet(["a", "b"])).toEqual([["a", "1"], ["b", null]]);
});

it("expo-router screens: one $screen per template, repeats skipped", () => {
  const seen: string[] = [];
  const t = expoRouterScreens({ screen: (n) => void seen.push(n) });
  t(["profile", "[id]"]);
  t(["profile", "[id]"]);
  t(["(tabs)", "home"]);
  expect(seen).toEqual(["/profile/[id]", "/(tabs)/home"]);
});
