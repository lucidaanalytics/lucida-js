import { afterEach, describe, expect, it } from "vitest";
import { markFixed } from "../src/replay/fixedmark.js";
import type { DomEvent } from "../src/replay/visit.js";

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

describe("fixed-position marker", () => {
  it("marks elements whose stylesheet position is fixed or sticky, in snapshots and attribute mutations", () => {
    document.head.innerHTML = "<style>.hdr{position:fixed}.nav{position:sticky}</style>";
    document.body.innerHTML = '<header class="hdr"></header><nav class="nav"></nav><main class="page"></main>';
    const els = [...document.body.children];
    const ids = new Map(els.map((el, i) => [i + 1, el]));
    const getNode = (id: number) => ids.get(id) ?? null;
    const snap: DomEvent = {
      type: 2,
      data: {
        node: {
          type: 2,
          id: 0,
          tagName: "body",
          attributes: {},
          childNodes: els.map((el, i) => ({ type: 2, id: i + 1, tagName: el.tagName.toLowerCase(), attributes: { class: el.className } })),
        },
      },
    };
    markFixed(snap, getNode);
    const attrs = snap.data!.node!.childNodes!.map((n) => n.attributes);
    expect(attrs[0]).toHaveProperty("data-lc-fixed");
    expect(attrs[1]).toHaveProperty("data-lc-fixed");
    expect(attrs[2]).not.toHaveProperty("data-lc-fixed");

    // a class change that pins an element is marked on the mutation
    (els[2] as HTMLElement).className = "hdr";
    const mut: DomEvent = { type: 3, data: { source: 0, attributes: [{ id: 3, attributes: { class: "hdr" } }] } };
    markFixed(mut, getNode);
    expect(mut.data!.attributes![0]!.attributes).toHaveProperty("data-lc-fixed");
  });
});
