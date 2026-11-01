import { afterEach, describe, expect, it } from "vitest";
import { elementMarkup, svgOf } from "../src/toolbar/screenshot.js";

afterEach(() => void (document.body.innerHTML = ""));

describe("action element screenshot (LC-ING-57)", () => {
  it("inlines styles and never carries form values, masked text, ids or handlers", () => {
    document.body.innerHTML = `<form id="f" style="color: red"><input id="email" value="ada@x.test"><textarea>secret note</textarea>
      <select><option selected>Gold plan</option></select><span data-lc-mask>4111 1111</span><button onclick="pay()">Pay</button><script>x()</script></form>`;
    const html = elementMarkup(document.getElementById("f") as Element);
    expect(html).toMatch(/color:\s*(red|rgb\(255, 0, 0\))/);
    expect(html).toContain("Pay");
    for (const leak of ["ada@x.test", "secret note", "selected", "4111", "onclick", 'id="', "<script"]) expect(html).not.toContain(leak);
  });

  it("wraps the markup in an XHTML foreignObject of the element's size", () => {
    const svg = svgOf("<b>x</b>", 120, 40);
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="120" height="40">/);
    expect(svg).toContain('<div xmlns="http://www.w3.org/1999/xhtml"><b>x</b></div>');
  });
});
