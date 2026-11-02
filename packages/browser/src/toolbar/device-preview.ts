import { applyChanges } from "../experiments/changes.js";
import type { Change } from "../experiments/changes.js";

/** Preview widths of the visual editor (P-H5); `desktop` closes the frame. */
export const DEVICES = { desktop: 0, tablet: 768, mobile: 375 } as const;
export type Device = keyof typeof DEVICES;

/**
 * Device-width preview: the current page in a same-origin iframe of the device's width, with the
 * editor's change list applied inside it (page JS never runs in the preview). Media queries respond
 * as on a real device. `update` re-renders after an edit, undo or redo (the frame reloads so reverted
 * changes disappear too); `close` removes the frame.
 */
export function devicePreview(changes: () => readonly Change[]) {
  let wrap: HTMLDivElement | undefined;
  let frame: HTMLIFrameElement | undefined;
  const paint = (): void => {
    const doc = frame?.contentDocument;
    if (doc) applyChanges([...changes()], doc, { allowJs: false });
  };
  const close = (): void => {
    wrap?.remove();
    wrap = frame = undefined;
  };
  const open = (d: Device): void => {
    const w = DEVICES[d];
    if (!w) return close();
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.setAttribute("data-lc-ignore", "");
      wrap.setAttribute("role", "dialog");
      wrap.setAttribute("aria-label", "Device preview");
      wrap.style.cssText = "position:fixed;inset:0;z-index:2147483646;background:rgba(15,23,42,.6);display:flex;align-items:center;justify-content:center";
      frame = document.createElement("iframe");
      frame.title = "Variant preview";
      frame.style.cssText = "height:90vh;border:0;background:#fff;border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,.4)";
      frame.onload = paint;
      wrap.append(frame);
      wrap.onclick = (e) => e.target === wrap && close();
      document.body.append(wrap);
      const u = new URL(location.href);
      u.hash = "lc-device-preview"; // the toolbar does not open itself in the preview frame
      frame.src = u.toString();
    }
    if (frame) {
      frame.style.width = `${w}px`;
      frame.setAttribute("aria-label", `${d} preview, ${w} pixels wide`);
    }
  };
  return {
    open,
    close,
    update: (): void => {
      if (frame?.contentWindow) frame.contentWindow.location.reload();
    },
    isOpen: (): boolean => !!wrap,
  };
}
