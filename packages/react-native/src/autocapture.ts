import type { Core, Props } from "@lucida-analytics/sdk-core";

export interface RageTapConfig {
  enabled?: boolean;
  minTaps?: number;
  windowMs?: number;
  radius?: number;
}

/**
 * Element autocapture (`$autocapture` taps and changes). Off by default.
 * Privacy: text-field values are never collected; `propsAllowList` is the only way extra props leave the device.
 */
export interface AutocaptureConfig {
  enabled?: boolean;
  ignoreLabels?: readonly string[];
  maxElements?: number;
  propsAllowList?: readonly string[];
  /** A component with this prop set (`<View lucidaNoCapture />`) and its subtree are never captured. */
  noCaptureProp?: string;
  /** Prop read as the element's label, after `accessibilityLabel`. Default `testID`. */
  customLabelProp?: string;
  rageTap?: RageTapConfig;
}

/** One element in the touched component's ancestor chain (nearest first). */
export interface TapElement {
  name: string;
  label?: string | undefined;
  noCapture?: boolean | undefined;
  isInput?: boolean | undefined;
  props?: Record<string, string> | undefined;
}

export interface Autocapture {
  tap(chain: readonly TapElement[], x: number, y: number): void;
  change(chain: readonly TapElement[]): void;
  readonly config: AutocaptureConfig;
}

export function createAutocapture(core: Core, config: AutocaptureConfig, now: () => number = Date.now): Autocapture {
  const taps: Array<{ t: number; x: number; y: number }> = [];
  const rc = { enabled: true, minTaps: 3, windowMs: 1000, radius: 30, ...config.rageTap };

  function emit(type: "touch" | "change", chain: readonly TapElement[]): Props | undefined {
    if (!config.enabled || chain.some((e) => e.noCapture)) return undefined;
    const ignore = new Set(config.ignoreLabels ?? []);
    const allow = new Set(config.propsAllowList ?? []);
    const kept = chain.filter((e) => !ignore.has(e.name) && !(e.label !== undefined && ignore.has(e.label))).slice(0, config.maxElements ?? 10);
    if (!kept.length) return undefined;
    const elements = kept.map((el) => {
      const o: Props = { tag_name: el.name };
      // Inputs never expose label text: it can echo what the user typed.
      if (!el.isInput && el.label) o.text = el.label.slice(0, 255);
      for (const [k, v] of Object.entries(el.props ?? {})) if (allow.has(k)) o[`attr__${k}`] = v;
      return o;
    });
    const text = elements.find((e) => e.text !== undefined)?.text ?? "";
    core.capture("$autocapture", { $event_type: type, $elements: elements, $el_text: text });
    return elements[0];
  }

  return {
    config,
    tap(chain, x, y) {
      const top = emit("touch", chain);
      if (!top || !rc.enabled) return;
      const t = now();
      taps.push({ t, x, y });
      while (taps.length && t - taps[0]!.t > rc.windowMs) taps.shift();
      const near = taps.filter((p) => Math.hypot(p.x - x, p.y - y) <= rc.radius).length;
      if (near >= rc.minTaps) {
        taps.length = 0;
        core.capture("$rageclick", { $event_type: "touch", $tap_count: near, $elements: [top] });
      }
    },
    change(chain) {
      emit("change", chain);
    },
  };
}

/** The slice of a React fiber the chain builder reads. */
export interface FiberLike {
  type?: unknown;
  memoizedProps?: Record<string, unknown> | null;
  return?: FiberLike | null;
}

/** Touch event shape from a `<View onTouchEnd>`; `_targetInst` is React's own record of the touched fiber. */
export interface TouchEventLike {
  nativeEvent?: { pageX?: number; pageY?: number };
  _targetInst?: FiberLike | null;
}

/** Put the result on your root view: `<View onTouchEnd={touchHandler(client.autocapture)} />`. */
export function touchHandler(ac: Autocapture): (e: TouchEventLike) => void {
  return (e) => {
    if (!ac.config.enabled) return;
    const chain = chainFromFiber(e._targetInst, ac.config);
    if (chain.length) ac.tap(chain, e.nativeEvent?.pageX ?? 0, e.nativeEvent?.pageY ?? 0);
  };
}

const INPUT_NAMES = /^(TextInput|RCTSinglelineTextInputView|RCTMultilineTextInputView|AndroidTextInput)$/;

function nameOf(f: FiberLike): string | undefined {
  const t = f.type as { displayName?: string; name?: string } | string | undefined;
  if (typeof t === "string") return t;
  return t?.displayName ?? t?.name ?? undefined;
}

/**
 * Builds the ancestor chain from a touched fiber (`event._targetInst`). Only host components and composites that carry
 * a label (`accessibilityLabel` or `customLabelProp`) or the no-capture prop are kept, so the chain stays readable.
 * Text-field values are never read: inputs contribute their name only.
 */
export function chainFromFiber(start: FiberLike | null | undefined, cfg: AutocaptureConfig): TapElement[] {
  const noCapture = cfg.noCaptureProp ?? "lucidaNoCapture";
  const labelProp = cfg.customLabelProp ?? "testID";
  const out: TapElement[] = [];
  for (let f = start; f; f = f.return) {
    const p = f.memoizedProps ?? {};
    const name = nameOf(f);
    if (!name) continue;
    const input = INPUT_NAMES.test(name);
    const label = typeof p.accessibilityLabel === "string" ? p.accessibilityLabel : typeof p[labelProp] === "string" ? (p[labelProp] as string) : undefined;
    const flagged = p[noCapture] === true;
    if (!input && label === undefined && !flagged) continue;
    const props: Record<string, string> = {};
    for (const [k, v] of Object.entries(p)) if (typeof v === "string" && k !== "children") props[k] = v;
    out.push({ name, label, noCapture: flagged, isInput: input, props });
  }
  return out;
}
