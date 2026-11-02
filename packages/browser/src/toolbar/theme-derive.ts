// Toolbar "derive theme from this page" (N-DAP-9): reads computed styles of the page body and its primary button
// into guide theme tokens (#hex colors, px radius, font list). Only styles are read, never page text or values.

export interface DerivedTheme {
  name: string;
  tokens: { background?: string; text?: string; accent?: string; radius?: number };
  font_family?: string;
  radius?: number;
}

/** `rgb(a)` / `#hex` to `#rrggbb`; null for transparent or anything else. */
export function toHex(c: string): string | null {
  const s = c.trim().toLowerCase();
  if (/^#([0-9a-f]{6})$/.test(s)) return s;
  if (/^#([0-9a-f]{3})$/.test(s)) return `#${[...s.slice(1)].map((x) => x + x).join("")}`;
  const m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s);
  if (!m) return null;
  const a = m[4];
  const alpha = a === undefined ? 1 : a.endsWith("%") ? parseFloat(a) / 100 : parseFloat(a);
  if (alpha < 0.5) return null; // (mostly) transparent: not a usable color
  return `#${[m[1], m[2], m[3]].map((x) => Math.min(255, Number(x)).toString(16).padStart(2, "0")).join("")}`;
}

const FONT = /^[\w\s,'"-]{1,100}$/;

/** The page's first visible primary-looking button (a submit, a `.btn-primary`-style class, else any button). */
function primaryButton(doc: Document): Element | null {
  const sel = ["button[type=submit]", "[class*=primary]", "button", "a[class*=btn]", "[role=button]"];
  for (const s of sel) {
    for (const el of doc.querySelectorAll(s)) {
      if (el.closest("[data-lc-ignore]")) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && toHex(getComputedStyle(el).backgroundColor)) return el;
    }
  }
  return null;
}

/** Theme tokens for the current page. Fields the page does not define clearly are left out. */
export function deriveTheme(doc: Document = document): DerivedTheme {
  const body = getComputedStyle(doc.body);
  const html = getComputedStyle(doc.documentElement);
  const tokens: DerivedTheme["tokens"] = {};
  const bg = toHex(body.backgroundColor) ?? toHex(html.backgroundColor);
  if (bg) tokens.background = bg;
  const text = toHex(body.color);
  if (text) tokens.text = text;
  const btn = primaryButton(doc);
  const out: DerivedTheme = { name: `${doc.title || location.hostname} theme`.slice(0, 100), tokens };
  if (btn) {
    const st = getComputedStyle(btn);
    const accent = toHex(st.backgroundColor);
    if (accent && accent !== bg) tokens.accent = accent;
    const r = Math.round(parseFloat(st.borderTopLeftRadius));
    if (Number.isFinite(r) && r >= 0) {
      tokens.radius = Math.min(r, 32);
      out.radius = tokens.radius;
    }
  }
  const font = body.fontFamily.trim();
  if (font && FONT.test(font)) out.font_family = font;
  return out;
}
