/** A rectangle in canvas pixel coordinates (the canvas `width`/`height` space, not CSS pixels). */
export interface CanvasRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Remote rule: canvases matching `selector` get `regions` painted over, or the whole canvas when `regions` is absent. */
export interface CanvasMaskRule {
  selector: string;
  regions?: CanvasRegion[];
}

export interface MaskedCanvasOptions {
  fps: number;
  quality: number;
  /** Canvases inside these are never captured (the recorder's block + ignore selectors). */
  skip: string;
  rules: CanvasMaskRule[];
  regionsFn?: ((canvas: HTMLCanvasElement) => CanvasRegion[]) | undefined;
  /** rrweb mirror id; <= 0 when the canvas is not in the snapshot yet. */
  idOf: (c: HTMLCanvasElement) => number;
  emit: (e: { type: number; timestamp: number; data: unknown }) => void;
}

/** Regions for one canvas: the local function's plus every matching remote rule's (a bad selector masks the whole canvas). */
export function regionsFor(c: HTMLCanvasElement, rules: CanvasMaskRule[], fn?: (c: HTMLCanvasElement) => CanvasRegion[]): CanvasRegion[] {
  const all: CanvasRegion = { x: 0, y: 0, width: c.width, height: c.height };
  let local: CanvasRegion[] = [];
  try {
    local = fn?.(c) ?? [];
  } catch {
    local = [all]; // a throwing mask function fails closed
  }
  const remote = rules.flatMap((r) => {
    try {
      return c.matches(r.selector) ? (r.regions ?? [all]) : [];
    } catch {
      return [all];
    }
  });
  return [...local, ...remote];
}

/**
 * Canvas capture with mask regions (LC-EXP-59). rrweb's own canvas sampler encodes frames in a worker we
 * cannot reach, so when any region is configured the recorder turns rrweb's canvas capture off and this
 * sampler takes over: each frame is copied to a scratch canvas, the regions are painted black, and only
 * then encoded, so masked pixels never leave the browser. Frames use rrweb's own canvas-mutation shape.
 * shortcut: WebGL canvases without preserveDrawingBuffer can read back blank between frames; upgrade by hooking the draw loop if users need it.
 */
export function maskedCanvasSampler(o: MaskedCanvasOptions) {
  const last = new Map<number, string>();
  const scratch = document.createElement("canvas");
  const tick = (): void => {
    for (const c of Array.from(document.querySelectorAll("canvas"))) {
      const id = o.idOf(c);
      if (id <= 0 || !c.width || !c.height || c.closest(o.skip)) continue;
      try {
        scratch.width = c.width;
        scratch.height = c.height;
        const ctx = scratch.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(c, 0, 0);
        ctx.fillStyle = "#000";
        for (const r of regionsFor(c, o.rules, o.regionsFn)) ctx.fillRect(r.x, r.y, r.width, r.height);
        const url = scratch.toDataURL("image/jpeg", o.quality);
        const base64 = url.slice(url.indexOf(",") + 1);
        if (!base64 || last.get(id) === base64) continue;
        last.set(id, base64);
        const blob = { rr_type: "Blob", data: [{ rr_type: "ArrayBuffer", base64 }], type: "image/jpeg" };
        o.emit({
          type: 3,
          timestamp: Date.now(),
          data: {
            source: 9, // CanvasMutation
            id,
            type: 0, // 2D
            commands: [
              { property: "clearRect", args: [0, 0, c.width, c.height] },
              { property: "drawImage", args: [{ rr_type: "ImageBitmap", args: [blob] }, 0, 0] },
            ],
          },
        });
      } catch {
        /* tainted (cross-origin) canvas: never captured */
      }
    }
  };
  const timer = setInterval(tick, Math.round(1000 / o.fps));
  return {
    /** A new full snapshot rebuilt the canvases in the player: resend every frame. */
    reset: (): void => last.clear(),
    tick,
    stop: (): void => clearInterval(timer),
  };
}
