import { beforeEach, describe, expect, it } from "vitest";
import { applyChanges, changesOf, removeInserted, safeImageUrl, sanitizeHtml } from "../src/experiments/index.js";
import type { Change } from "../src/experiments/index.js";
import { bindUndoKeys, createEditor } from "../src/toolbar/editor.js";
import { pageOutline } from "../src/toolbar/outline.js";

beforeEach(() => {
  document.head.querySelectorAll("[data-lc-change]").forEach((e) => e.remove());
  document.body.innerHTML = "";
  delete (window as unknown as { __lcRan?: number }).__lcRan;
});

const html = (f: DocumentFragment): string => {
  const d = document.createElement("div");
  d.append(f);
  return d.innerHTML;
};

describe("sanitizer (P-H5)", () => {
  it("drops scripts, frames, handlers and unsafe URLs, keeps allowed markup", () => {
    expect(html(sanitizeHtml(`<p class="a" onclick="x()">Hi <b>there</b><script>x()</script></p>`))).toBe(`<p class="a">Hi <b>there</b></p>`);
    expect(html(sanitizeHtml(`<iframe src="https://e.test"></iframe><style>*{}</style><svg onload="x()"></svg>ok`))).toBe("ok");
    expect(html(sanitizeHtml(`<a href="javascript:alert(1)">a</a>`))).toBe(`<a>a</a>`);
    expect(html(sanitizeHtml(`<a href="/p" target="_blank">a</a>`))).toBe(`<a href="/p" target="_blank" rel="noopener noreferrer">a</a>`);
    expect(html(sanitizeHtml(`<img src="data:image/svg+xml;base64,AA" alt="x">`))).toBe(`<img alt="x">`);
    expect(html(sanitizeHtml(`<img src="data:image/png;base64,AA">`))).toBe(`<img src="data:image/png;base64,AA">`);
    expect(html(sanitizeHtml(`<custom-el>kept <i>text</i></custom-el>`))).toBe(`kept <i>text</i>`);
    expect(html(sanitizeHtml(`<span style="background:url(https://x.test/t)" data-lc-change="forged" data-x="1">s</span>`))).toBe(`<span data-x="1">s</span>`);
    expect(html(sanitizeHtml(`<form action="/x"><input name="a"></form><!-- c -->t`))).toBe("t");
  });

  it("allows only safe image URLs", () => {
    expect(safeImageUrl("https://cdn.test/a.png")).toBe(true);
    expect(safeImageUrl("/a.png")).toBe(true);
    expect(safeImageUrl("javascript:alert(1)")).toBe(false);
    expect(safeImageUrl("data:text/html,x")).toBe(false);
    expect(safeImageUrl("")).toBe(false);
  });
});

describe("change types (P-H5)", () => {
  it("inserts sanitized HTML once per element and position", () => {
    document.body.innerHTML = `<ul><li class="i">a</li><li class="i">b</li></ul>`;
    const c: Change[] = [{ selector: ".i", type: "insert", position: "after", html: `<li class="new" onclick="x()">new</li>` }];
    applyChanges(c);
    applyChanges(c);
    const added = document.querySelectorAll("li.new");
    expect(added).toHaveLength(2);
    expect(added[0]!.getAttribute("onclick")).toBeNull();
    expect(added[0]!.hasAttribute("data-lc-change")).toBe(true);
    applyChanges([{ selector: "ul", type: "insert", position: "prepend", html: "<li>first</li>" }]);
    expect(document.querySelector("ul")!.firstElementChild!.textContent).toBe("first");
    removeInserted();
    expect(document.querySelectorAll("li")).toHaveLength(2);
    applyChanges(c); // markers were cleared too, so the insert comes back
    expect(document.querySelectorAll("li.new")).toHaveLength(2);
  });

  it("swaps images and refuses unsafe sources", () => {
    document.body.innerHTML = `<picture><source srcset="/old.webp"><img id="h" src="/old.png" srcset="/old-2x.png 2x"></picture>`;
    applyChanges([{ selector: "#h", type: "image", src: "https://cdn.test/new.png", alt: "New" }]);
    const img = document.getElementById("h")!;
    expect(img.getAttribute("src")).toBe("https://cdn.test/new.png");
    expect(img.hasAttribute("srcset")).toBe(false);
    expect(img.getAttribute("alt")).toBe("New");
    applyChanges([{ selector: "source", type: "image", src: "/new.webp" }]);
    expect(document.querySelector("source")!.getAttribute("srcset")).toBe("/new.webp");
    applyChanges([{ selector: "#h", type: "image", src: "javascript:alert(1)" }]);
    expect(img.getAttribute("src")).toBe("https://cdn.test/new.png");
  });

  it("adds page CSS once with the nonce", () => {
    const c: Change[] = [{ type: "css", css: "h1{color:red}" }];
    applyChanges(c, document, { nonce: "n1" });
    applyChanges(c, document, { nonce: "n1" });
    const s = document.head.querySelectorAll("style[data-lc-change]");
    expect(s).toHaveLength(1);
    expect(s[0]!.getAttribute("nonce")).toBe("n1");
    expect(changesOf({ lc_changes: c })).toHaveLength(1); // page-level changes need no selector
  });

  it("runs page JS only when approved and allowed", () => {
    const ran = (): number | undefined => (window as unknown as { __lcRan?: number }).__lcRan;
    const js = "window.__lcRan = (window.__lcRan || 0) + 1";
    applyChanges([{ type: "js", js }], document, { allowJs: true });
    applyChanges([{ type: "js", js, approved: true }], document, { allowJs: false });
    expect(document.head.querySelector("script[data-lc-change]")).toBeNull();
    applyChanges([{ type: "js", js, approved: true }], document, { allowJs: true, nonce: "n2" });
    applyChanges([{ type: "js", js, approved: true }], document, { allowJs: true, nonce: "n2" });
    const s = document.head.querySelectorAll("script[data-lc-change]");
    expect(s).toHaveLength(1);
    expect(s[0]!.getAttribute("nonce")).toBe("n2");
    expect(ran() ?? 1).toBeLessThanOrEqual(1);
  });
});

describe("editor history and new types (P-H5)", () => {
  it("undoes and redoes, reverting the preview", () => {
    document.body.innerHTML = `<h1 id="t">Old</h1><p id="p">x</p>`;
    const ed = createEditor();
    const t = document.getElementById("t")!;
    ed.text(t, "New");
    ed.style(t, "color", "red");
    ed.insert(document.getElementById("p")!, "after", "<p class='ins'>added</p>");
    expect(t.textContent).toBe("New");
    expect(document.querySelectorAll(".ins")).toHaveLength(1);
    ed.undo();
    expect(document.querySelectorAll(".ins")).toHaveLength(0);
    expect(ed.changes()).toHaveLength(2);
    ed.undo();
    ed.undo();
    expect(ed.changes()).toHaveLength(0);
    expect(document.getElementById("t")!.textContent).toBe("Old");
    expect(document.getElementById("t")!.getAttribute("style")).toBeNull();
    expect(ed.canUndo()).toBe(false);
    ed.redo();
    expect(document.getElementById("t")!.textContent).toBe("New");
    ed.text(document.getElementById("t")!, "Newer");
    expect(ed.canRedo()).toBe(false); // a new edit clears the redo stack
  });

  it("records image, css and js changes and binds the undo keys", () => {
    document.body.innerHTML = `<img id="i" src="/a.png">`;
    const ed = createEditor();
    ed.image(document.getElementById("i")!, "https://cdn.test/b.png", "B");
    ed.css("h1{}");
    ed.css("h2{}"); // one page CSS change per variant
    ed.js("void 0");
    expect(ed.changes().map((c) => c.type)).toEqual(["image", "css", "js"]);
    expect(document.head.querySelector("script[data-lc-change]")).toBeNull(); // never run in the editor
    const off = bindUndoKeys(() => ed);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true }));
    expect(ed.changes()).toHaveLength(2);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Z", ctrlKey: true, shiftKey: true }));
    expect(ed.changes()).toHaveLength(3);
    off();
  });
});

describe("page outline for AI change sets (P-L3)", () => {
  it("lists targets with stable selectors, skips SDK UI and inserted nodes", () => {
    document.body.innerHTML = `<h1 id="hero">Big   title</h1><a class="cta" href="/s">Start</a><img id="shot" alt="Dash" src="/a.png">
      <div data-lc-ignore><button>Toolbar</button></div><p data-lc-change="c1"><a href="/x">inserted</a></p>`;
    const o = pageOutline();
    expect(o.map((e) => e.selector)).toContain("#hero");
    expect(o.find((e) => e.selector === "#hero")!.text).toBe("Big title");
    expect(o.find((e) => e.tag === "img")!.text).toBe("Dash");
    expect(o.some((e) => e.text === "Toolbar" || e.text === "inserted")).toBe(false);
  });
});
