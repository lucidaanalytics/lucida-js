import { describe, expect, it } from "vitest";
import { sseParser } from "../src/index.js";

describe("sseParser", () => {
  it("handles split chunks, CRLF, comments and multi-line data", () => {
    const out: Array<{ event: string; data: string }> = [];
    const p = sseParser((m) => out.push(m));
    p(": keepalive\n\nevent: definitions\nda");
    p('ta: {"etag":"a"}\r\n\r\ndata: x\ndata: y\n\n');
    expect(out).toEqual([
      { event: "definitions", data: '{"etag":"a"}' },
      { event: "message", data: "x\ny" },
    ]);
  });
});
