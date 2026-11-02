import type { Guide, GuideTokens } from "../types.js";

// Guide appearance (LC-ENG-17, N-DAP-9, P-M41): the gateway resolves the project theme (`theme_id`) into
// `appearance` before serving, so this only picks light or dark tokens and paints them (values re-checked).

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const FONT = /^[\w\s,'"-]{1,100}$/;
const SHADOW = { none: "none", sm: "0 1px 4px rgba(0,0,0,.15)", lg: "0 8px 32px rgba(0,0,0,.3)" } as const;

type Appearance = NonNullable<Guide["appearance"]>;

/** True when the dark variant applies: `theme_mode` dark, or auto (the default when a dark variant exists) and the visitor prefers dark. */
export function wantsDark(a: Appearance | undefined, prefersDark = matchDark()): boolean {
  if (!a?.dark?.tokens) return false;
  const mode = a.theme_mode ?? "auto";
  return mode === "dark" || (mode === "auto" && prefersDark);
}

function matchDark(): boolean {
  try {
    return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

/** The tokens to paint: base tokens, the theme font, then the dark variant on top when it applies. */
export function resolveTokens(a: Appearance | undefined, prefersDark?: boolean): GuideTokens {
  const base: GuideTokens = { ...(a?.font_family ? { font: a.font_family } : {}), ...a?.tokens };
  return wantsDark(a, prefersDark) ? { ...base, ...a?.dark?.tokens } : base;
}

/** Appearance tokens as inline styles on the guide box (colors #hex, radius 0-32, safe font list). */
export function paint(box: HTMLElement, t: GuideTokens | undefined): void {
  const ok = (c: unknown): c is string => typeof c === "string" && HEX.test(c);
  if (ok(t?.background)) box.style.background = t.background;
  if (ok(t?.text)) box.style.color = t.text;
  if (ok(t?.accent)) (box.style.setProperty("--a", t.accent), box.style.setProperty("--at", "#fff"));
  if (typeof t?.radius === "number" && t.radius >= 0 && t.radius <= 32) box.style.borderRadius = `${t.radius}px`;
  if (typeof t?.font === "string" && FONT.test(t.font)) box.style.fontFamily = t.font;
  if (t?.shadow && t.shadow in SHADOW) box.style.boxShadow = SHADOW[t.shadow];
  if (typeof t?.button_radius === "number" && t.button_radius >= 0 && t.button_radius <= 32) box.style.setProperty("--br", `${t.button_radius}px`);
  if (ok(t?.secondary)) box.style.setProperty("--s", t.secondary);
  if (ok(t?.secondary_text)) box.style.setProperty("--st", t.secondary_text);
}
