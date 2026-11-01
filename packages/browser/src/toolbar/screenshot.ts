/**
 * Element screenshot for an action (LC-ING-57): the picked element is cloned with its computed
 * styles inlined, form values blanked (no form values ever leave the page), wrapped in an SVG
 * foreignObject and drawn on a canvas. shortcut: images and fonts from other origins are not
 * embedded (an SVG image cannot fetch them) and show as gaps; inline them as data URLs to fix.
 */

/** Longest side of the stored image, px. */
const MAX_SIDE = 640;

/** A styled, value-free copy of `el` as XHTML. */
export function elementMarkup(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  const src = [el, ...el.querySelectorAll("*")];
  const dst = [clone, ...clone.querySelectorAll("*")];
  src.forEach((s, i) => {
    const d = dst[i] as HTMLElement | undefined;
    if (!d) return;
    const cs = getComputedStyle(s);
    let css = "";
    for (let k = 0; k < cs.length; k++) {
      const p = cs.item(k);
      css += `${p}:${cs.getPropertyValue(p)};`;
    }
    d.setAttribute("style", css);
    if (d instanceof HTMLInputElement || d instanceof HTMLTextAreaElement) {
      d.removeAttribute("value");
      d.textContent = "";
    }
    if (d instanceof HTMLSelectElement) for (const o of d.querySelectorAll("option")) o.removeAttribute("selected");
    if (d.hasAttribute("data-lc-mask")) d.textContent = "•••";
    d.removeAttribute("id");
    for (const a of [...d.attributes]) if (a.name.startsWith("on")) d.removeAttribute(a.name);
  });
  for (const s of clone.querySelectorAll("script")) s.remove();
  return new XMLSerializer().serializeToString(clone);
}

/** The SVG document drawing `markup` at `w` x `h`. */
export function svgOf(markup: string, w: number, h: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml">${markup}</div></foreignObject></svg>`;
}

/** PNG of `el`, or null when the browser cannot render it. */
export async function captureElement(el: Element): Promise<Blob | null> {
  const r = el.getBoundingClientRect();
  const w = Math.max(1, Math.ceil(r.width));
  const h = Math.max(1, Math.ceil(r.height));
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  if (typeof URL.createObjectURL !== "function") return null;
  const url = URL.createObjectURL(new Blob([svgOf(elementMarkup(el), w, h)], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    await new Promise<void>((ok, fail) => {
      img.onload = () => ok();
      img.onerror = () => fail(new Error("render"));
      img.src = url;
    });
    const c = document.createElement("canvas");
    c.width = Math.round(w * scale);
    c.height = Math.round(h * scale);
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/png"));
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
