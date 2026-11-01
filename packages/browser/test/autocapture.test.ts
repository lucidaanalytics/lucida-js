import { afterEach, describe, expect, it } from "vitest";
import { buildChain, chainToString } from "../src/autocapture/index.js";
import type { Client } from "../src/index.js";
import { start } from "./helpers.js";

let live: Client | undefined;
afterEach(async () => {
  document.body.innerHTML = "";
  await live?.shutdown();
});

function setup(html: string, ac: object | boolean = {}) {
  document.body.innerHTML = html;
  const s = start({ capturePageview: false, autocapture: ac as never });
  live = s.client;
  return s;
}
const click = (sel: string) => document.querySelector(sel)!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

describe("element chain", () => {
  it("records tag, id, classes, data-lc-*, nth-child, href, text", () => {
    document.body.innerHTML = `<div id="root"><ul><li>a</li><li><a id="go" class="btn primary" href="/x" data-lc-track="cta" data-secret="no">Buy <b>now</b></a></li></ul></div>`;
    const chain = buildChain(document.getElementById("go")!, true, document.getElementById("go")!);
    expect(chain[0]).toMatchObject({
      tag_name: "a",
      attr__id: "go",
      classes: ["btn", "primary"],
      href: "/x",
      nth_child: 1,
      nth_of_type: 1,
      text: "Buy",
      attrs: { "data-lc-track": "cta" },
    });
    expect(chain[0]!.attrs).not.toHaveProperty("data-secret");
    expect(chain[1]).toMatchObject({ tag_name: "li", nth_child: 2 });
    expect(chain.map((c) => c.tag_name).slice(0, 4)).toEqual(["a", "li", "ul", "div"]);
    expect(chainToString(chain)).toContain('a.btn.primary:attr__id="go"href="/x"text="Buy"');
  });

  it("drops digit-run text that looks like a card number", () => {
    document.body.innerHTML = `<button id="b">4242 4242 4242 4242</button>`;
    expect(buildChain(document.getElementById("b")!, true)[0]!.text).toBeUndefined();
  });
});

describe("autocapture events", () => {
  it("captures a click with chain and text", async () => {
    const { client, t } = setup(`<button id="b" class="cta">Sign up</button>`);
    click("#b");
    await client.flush();
    const e = t.events().find((x) => x.event === "$autocapture")!;
    expect(e.properties.$event_type).toBe("click");
    expect(e.properties.$el_text).toBe("Sign up");
    expect((e.properties.$elements as Array<{ tag_name: string }>)[0]!.tag_name).toBe("button");
    expect(e.properties.$elements_chain).toContain("button.cta");
  });

  it("counts key presses (never which key) onto the next autocapture event, skipping passwords", async () => {
    const { client, t } = setup(`<input id="name" type="text" /><input id="pw" type="password" /><button id="b">Go</button>`);
    const press = (sel: string, key: string) => document.querySelector(sel)!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    for (const k of ["a", "b", "c"]) press("#name", k);
    press("#pw", "s");
    click("#b");
    click("#b");
    await client.flush();
    const clicks = t.events().filter((x) => x.event === "$autocapture");
    expect(clicks[0]!.properties.$keystroke_count).toBe(3);
    expect(clicks[1]!.properties).not.toHaveProperty("$keystroke_count");
    expect(JSON.stringify(clicks)).not.toMatch(/"key"|"a","b"/);
  });

  it("captureText:false omits text", async () => {
    const { client, t } = setup(`<button id="b">Sign up</button>`, { captureText: false });
    click("#b");
    await client.flush();
    expect(JSON.stringify(t.events())).not.toContain("Sign up");
  });

  it("never captures input values on change/click/submit", async () => {
    const { client, t } = setup(
      `<form id="f"><input id="email" name="email" value="alice@example.com"><input id="pw" type="password" value="hunter2"><textarea id="ta">my secret note</textarea><select id="s"><option value="x" selected>TopSecretOption</option></select><button id="go" type="button">Go</button></form>`,
    );
    for (const id of ["email", "ta", "s"]) {
      const el = document.getElementById(id) as HTMLInputElement;
      el.value = el.value || "typed-secret";
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
    document.getElementById("pw")!.dispatchEvent(new Event("change", { bubbles: true }));
    click("#go");
    document.getElementById("f")!.dispatchEvent(new Event("submit", { bubbles: true }));
    await client.flush();
    const all = JSON.stringify(t.events());
    for (const secret of ["alice@example.com", "hunter2", "my secret note", "typed-secret", "TopSecretOption"]) {
      expect(all).not.toContain(secret);
    }
    const types = t.events().map((e) => e.properties.$event_type);
    expect(types).toEqual(expect.arrayContaining(["change", "click", "submit"]));
    expect(t.events().some((e) => JSON.stringify(e).includes('"id":"pw"') || JSON.stringify(e).includes('attr__id":"pw"'))).toBe(false);
  });

  it("ignores [data-lc-ignore] subtrees and deny selectors", async () => {
    const { client, t } = setup(
      `<div data-lc-ignore><button id="a">A</button></div><div class="deny"><button id="b">B</button></div><button id="c">C</button>`,
      { denySelectors: [".deny"] },
    );
    click("#a");
    click("#b");
    click("#c");
    await client.flush();
    const texts = t.events().map((e) => e.properties.$el_text);
    expect(texts).toEqual(["C"]);
  });

  it("allowSelectors restricts, non-interactive clicks are skipped", async () => {
    const { client, t } = setup(`<div id="plain">p</div><section class="track"><button id="a">A</button></section><button id="b">B</button>`, {
      allowSelectors: [".track"],
    });
    click("#a");
    click("#b");
    await client.flush();
    expect(t.events().map((e) => e.properties.$el_text)).toEqual(["A"]);
    const s2 = setup(`<div id="plain">p</div>`);
    click("#plain");
    await s2.client.flush();
    expect(s2.t.events()).toHaveLength(0);
  });

  it("autocapture:false installs no listeners", async () => {
    const { client, t } = setup(`<button id="b">B</button>`, false);
    click("#b");
    await client.flush();
    expect(t.events()).toHaveLength(0);
  });
});
