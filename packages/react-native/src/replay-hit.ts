/**
 * Tap targets from the native view tree (G194). The native encoder already puts the whole view
 * hierarchy into the full snapshot as absolutely positioned elements (`left/top/width/height` in px,
 * relative to the parent), so JS needs no extra native API: a tap is resolved against the snapshot
 * that was last sent and lands on the deepest, topmost view containing the point.
 */

type Node = { type?: number; id?: number; tagName?: string; attributes?: Record<string, unknown>; childNodes?: Node[] };

const px = (style: string, prop: string): number | undefined => {
  const m = new RegExp(`(?:^|;)\\s*${prop}:\\s*(-?[\\d.]+)px`).exec(style);
  return m ? Number(m[1]) : undefined;
};

/** Id of the deepest, topmost element of the snapshot tree containing (x, y); `fallback` when none does. */
export function hitTest(root: unknown, x: number, y: number, fallback: number): number {
  const visit = (n: Node, ox: number, oy: number, isRoot: boolean): number | undefined => {
    if (n.type !== undefined && n.type !== 0 && n.type !== 2) return undefined; // text and comments are not tap targets
    const style = typeof n.attributes?.style === "string" ? n.attributes.style : "";
    const left = ox + (px(style, "left") ?? 0);
    const top = oy + (px(style, "top") ?? 0);
    const w = px(style, "width");
    const h = px(style, "height");
    // overflow:hidden clips children, so a point outside a sized view cannot hit anything inside it
    if (!isRoot && w !== undefined && h !== undefined && (x < left || y < top || x >= left + w || y >= top + h)) return undefined;
    const kids = n.childNodes ?? [];
    for (let i = kids.length - 1; i >= 0; i--) {
      const hit = visit(kids[i] as Node, left, top, false);
      if (hit !== undefined) return hit;
    }
    return n.type === 0 || n.tagName === "html" || n.id === undefined ? undefined : n.id;
  };
  return visit(root as Node, 0, 0, true) ?? fallback;
}
