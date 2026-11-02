// Guide appearance and anchored-bubble placement on React Native (N-DAP-9, N-DAP-10, P-M41). The gateway resolves the
// project theme into `appearance`, so this only picks light or dark tokens and re-checks values like the browser SDK.

export interface GuideTokens {
  background?: string;
  text?: string;
  accent?: string;
  radius?: number;
  font?: string;
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : undefined);

/** Dark tokens apply when theme_mode is dark, or auto (default) and the device is dark. */
export function wantsDark(a: Obj | null | undefined, systemDark: boolean): boolean {
  if (!obj(obj(a?.["dark"])?.["tokens"])) return false;
  const m = a?.["theme_mode"];
  const mode = typeof m === "string" ? m : "auto";
  return mode === "dark" || (mode === "auto" && systemDark);
}

export function guideTokens(a: Obj | null | undefined, systemDark: boolean): GuideTokens {
  const t: GuideTokens = {};
  const ff = a?.["font_family"];
  if (typeof ff === "string") t.font = ff;
  const layers = [obj(a?.["tokens"]), wantsDark(a, systemDark) ? obj(obj(a?.["dark"])?.["tokens"]) : undefined];
  for (const l of layers) {
    if (!l) continue;
    for (const k of ["background", "text", "accent"] as const) {
      const v = l[k];
      if (typeof v === "string" && HEX.test(v)) t[k] = v;
    }
    const r = l["radius"];
    if (typeof r === "number" && r >= 0 && r <= 32) t.radius = r;
    const f = l["font"];
    if (typeof f === "string" && f.trim()) t.font = f;
  }
  return t;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Bubble origin: below the target when it fits (or placement is not "top"), else above; centred and clamped. */
export function bubbleOrigin(w: number, h: number, r: Rect, bounds: Rect, placement?: string, margin = 12, gap = 8): { x: number; y: number } {
  const below = r.y + r.height + gap;
  const above = r.y - gap - h;
  const fitsBelow = below + h <= bounds.y + bounds.height - margin;
  const fitsAbove = above >= bounds.y + margin;
  const y = placement === "top" ? (fitsAbove || !fitsBelow ? above : below) : fitsBelow || !fitsAbove ? below : above;
  const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), Math.max(lo, hi));
  return {
    x: clamp(r.x + r.width / 2 - w / 2, bounds.x + margin, bounds.x + bounds.width - margin - w),
    y: clamp(y, bounds.y + margin, bounds.y + bounds.height - margin - h),
  };
}
