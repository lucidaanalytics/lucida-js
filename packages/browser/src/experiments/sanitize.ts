/**
 * Allowlist HTML sanitizer for visual-editor `insert` changes (P-H5). Parsing happens in an inert
 * `<template>` (nothing runs, nothing loads); anything not explicitly allowed is dropped: scripts,
 * styles, frames, embeds, forms and SVG with their content, unknown tags are unwrapped (children kept),
 * event handlers and non-allowlisted attributes are removed, and URLs must be http(s), relative,
 * mailto/tel (links) or a raster data:image (images).
 */

const DROP = new Set([
  "SCRIPT", "STYLE", "IFRAME", "FRAME", "FRAMESET", "OBJECT", "EMBED", "APPLET", "TEMPLATE", "NOSCRIPT",
  "SVG", "MATH", "FORM", "INPUT", "TEXTAREA", "SELECT", "OPTION", "LINK", "META", "BASE", "AUDIO", "VIDEO", "PORTAL",
]);
const ALLOW = new Set([
  "A", "ABBR", "B", "BLOCKQUOTE", "BR", "BUTTON", "CAPTION", "CITE", "CODE", "DD", "DEL", "DETAILS", "DIV", "DL", "DT",
  "EM", "FIGCAPTION", "FIGURE", "FOOTER", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HR", "I", "IMG", "INS", "KBD",
  "LABEL", "LI", "MARK", "NAV", "OL", "P", "PICTURE", "PRE", "Q", "S", "SECTION", "ARTICLE", "ASIDE", "SMALL", "SOURCE",
  "SPAN", "STRONG", "SUB", "SUMMARY", "SUP", "TABLE", "TBODY", "TD", "TFOOT", "TH", "THEAD", "TIME", "TR", "U", "UL",
]);
const ATTRS = new Set([
  "class", "id", "title", "alt", "href", "src", "srcset", "sizes", "width", "height", "role", "target", "rel",
  "colspan", "rowspan", "loading", "decoding", "lang", "dir", "style", "datetime", "media",
]);

const RASTER = /^data:image\/(png|jpe?g|gif|webp|avif);/i;

/** An image URL the SDK may load: http(s), protocol-relative, relative, or a raster data URL. */
export function safeImageUrl(u: string): boolean {
  const s = u.trim();
  if (!s) return false;
  if (/^data:/i.test(s)) return RASTER.test(s);
  return /^(https?:)?\/\//i.test(s) || !/^[a-z][a-z0-9+.-]*:/i.test(s);
}

/** A link target: http(s), mailto, tel, relative or a fragment. */
function safeLink(u: string): boolean {
  const s = u.trim();
  return /^(https?:|mailto:|tel:)/i.test(s) || !/^[a-z][a-z0-9+.-]*:/i.test(s);
}

const safeSrcset = (v: string): boolean => v.split(",").every((c) => safeImageUrl(c.trim().split(/\s+/)[0] ?? ""));
const safeStyle = (v: string): boolean => !/url\s*\(|expression\s*\(|@import|behavior\s*:|javascript:/i.test(v);

function cleanAttrs(el: Element): void {
  for (const { name, value } of [...el.attributes]) {
    const n = name.toLowerCase();
    const ok =
      (ATTRS.has(n) || n.startsWith("aria-") || (n.startsWith("data-") && !n.startsWith("data-lc"))) &&
      (n !== "href" || safeLink(value)) &&
      (n !== "src" || safeImageUrl(value)) &&
      (n !== "srcset" || safeSrcset(value)) &&
      (n !== "style" || safeStyle(value));
    if (!ok) el.removeAttribute(name);
  }
  if (el.getAttribute("target") === "_blank") el.setAttribute("rel", "noopener noreferrer");
}

function walk(node: ParentNode): void {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === 3) continue; // text
    if (child.nodeType !== 1) {
      child.remove(); // comments, processing instructions
      continue;
    }
    const el = child as Element;
    const tag = el.tagName.toUpperCase();
    if (DROP.has(tag)) {
      el.remove();
      continue;
    }
    walk(el);
    if (!ALLOW.has(tag)) {
      el.replaceWith(...el.childNodes); // unknown tag: keep its (sanitized) content
      continue;
    }
    cleanAttrs(el);
  }
}

/** Parse `html` inertly and return a sanitized fragment owned by `document`. */
export function sanitizeHtml(html: string): DocumentFragment {
  const t = document.createElement("template");
  t.innerHTML = html;
  walk(t.content);
  return document.importNode(t.content, true);
}
