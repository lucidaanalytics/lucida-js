import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluateAll, flagHash, sha256Hex } from "../src/index.js";
import type { EvalContext, EvalResult, FlagDefinition } from "../src/index.js";

interface Vectors {
  hash_vectors?: Array<{ input: string; numerator: number; hash: number }>;
  flags: FlagDefinition[];
  vectors: Array<{ name: string; flag: string; context: EvalContext; expected: Partial<EvalResult> }>;
}

const flagsDir = process.env.LUCIDA_TESTDATA ? `file://${process.env.LUCIDA_TESTDATA}/flags/` : new URL("../../../testdata/flags/", import.meta.url).href;
const load = (f: string): Vectors =>
  JSON.parse(readFileSync(new URL(f, flagsDir), "utf8")) as Vectors;

describe("sha256", () => {
  it("matches known vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("a".repeat(1000))).toBe("41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3");
  });
});

for (const file of ["vectors_basic.json", "vectors_g10.json", "vectors_g18.json", "vectors_sticky.json", "vectors_ops.json", "vectors.json"]) {
  const v = load(file);
  describe(`shared flag vectors: ${file}`, () => {
    it("hash vectors", () => {
      for (const h of v.hash_vectors ?? []) {
        const num = parseInt(sha256Hex(h.input).slice(0, 13), 16);
        expect(num).toBe(h.numerator);
        expect(num / 16 ** 13).toBe(h.hash);
      }
      expect(flagHash("f1", "s", "u1")).toBe(parseInt(sha256Hex("f1.s.u1").slice(0, 13), 16) / 16 ** 13);
    });

    it(`all ${v.vectors.length} vectors match`, () => {
      const failures: string[] = [];
      for (const vec of v.vectors) {
        const got = evaluateAll(v.flags, vec.context)[vec.flag] as EvalResult;
        const e = vec.expected;
        const actual = {
          value: got.value,
          variant: got.variant,
          payload: got.payload,
          reason: got.reason,
          condition_index: got.condition_index,
        };
        const want = { value: e.value, variant: e.variant, payload: e.payload, reason: e.reason, condition_index: e.condition_index };
        if (JSON.stringify(actual) !== JSON.stringify(want)) {
          failures.push(`${vec.name}: got ${JSON.stringify(actual)} want ${JSON.stringify(want)}`);
        }
      }
      expect(failures.slice(0, 5)).toEqual([]);
    }, 120_000);
  });
}
