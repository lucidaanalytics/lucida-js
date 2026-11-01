import type { FlagValue } from "./flags.js";
import type { Props } from "./ports.js";

/**
 * Event properties for a set of flag values: `$feature/<key>` per flag and `$active_feature_flags`
 * (sorted keys whose value is not false). Empty when no flag is known.
 */
export function flagEventProps(values: Record<string, FlagValue>): Props {
  const keys = Object.keys(values);
  if (keys.length === 0) return {};
  const out: Props = {};
  for (const k of keys) out[`$feature/${k}`] = values[k];
  out.$active_feature_flags = keys.filter((k) => values[k] !== false).sort();
  return out;
}

/** Adds flag properties to `props` without overwriting anything the caller set. */
export function withFlagProps(props: Props | undefined, values: Record<string, FlagValue>): Props {
  return { ...flagEventProps(values), ...props };
}

/**
 * Flags evaluated once for one distinct id: reads never hit the network or emit exposure events.
 * `only(keys)` and `onlyAccessed()` narrow what a capture attaches.
 */
export class FlagSnapshot {
  private readonly accessed = new Set<string>();

  constructor(
    readonly values: Readonly<Record<string, FlagValue>>,
    readonly payloads: Readonly<Record<string, unknown>> = {},
  ) {}

  isEnabled(key: string): boolean {
    const v = this.getFlag(key);
    return v !== undefined && v !== false;
  }

  getFlag(key: string): FlagValue | undefined {
    this.accessed.add(key);
    return this.values[key];
  }

  getPayload(key: string): unknown {
    return this.payloads[key];
  }

  keys(): string[] {
    return Object.keys(this.values);
  }

  only(keys: readonly string[]): FlagSnapshot {
    const pick = <T>(m: Readonly<Record<string, T>>) => Object.fromEntries(keys.filter((k) => k in m).map((k) => [k, m[k] as T]));
    return new FlagSnapshot(pick(this.values), pick(this.payloads));
  }

  onlyAccessed(): FlagSnapshot {
    return this.only([...this.accessed]);
  }

  /** The event properties this snapshot attaches. */
  eventProps(): Props {
    return flagEventProps(this.values as Record<string, FlagValue>);
  }
}
