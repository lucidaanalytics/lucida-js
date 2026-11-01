import type { Props, Storage } from "./ports.js";

function load<T>(storage: Storage, key: string): T | undefined {
  const raw = storage.get(key);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

/** Super properties merged into every event; persisted. */
export class SuperProps {
  private p: Props;

  constructor(
    private readonly storage: Storage,
    private readonly key = "lc_props",
    /** Only keys it accepts are written to storage (all stay in memory). */
    private readonly persist?: (key: string) => boolean,
  ) {
    this.p = load<Props>(storage, key) ?? {};
  }

  private save(): void {
    const keep = this.persist;
    this.storage.set(this.key, JSON.stringify(keep ? Object.fromEntries(Object.entries(this.p).filter(([k]) => keep(k))) : this.p));
  }

  register(props: Props): void {
    Object.assign(this.p, props);
    this.save();
  }

  /** Set only keys not already registered. */
  registerOnce(props: Props): void {
    for (const [k, v] of Object.entries(props)) if (!(k in this.p)) this.p[k] = v;
    this.save();
  }

  unregister(key: string): void {
    delete this.p[key];
    this.save();
  }

  all(): Props {
    return { ...this.p };
  }

  clear(): void {
    this.p = {};
    this.storage.remove(this.key);
  }
}

/** Group memberships (type -> key) attached to every event as $groups. */
export class Groups {
  private g: Record<string, string>;

  constructor(private readonly storage: Storage) {
    this.g = load<Record<string, string>>(storage, "lc_groups") ?? {};
  }

  set(type: string, key: string): void {
    this.g[type] = key;
    this.storage.set("lc_groups", JSON.stringify(this.g));
  }

  all(): Record<string, string> | undefined {
    return Object.keys(this.g).length ? { ...this.g } : undefined;
  }

  clear(): void {
    this.g = {};
    this.storage.remove("lc_groups");
  }
}
