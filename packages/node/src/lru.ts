/** Bounded set: inserting past `max` evicts the least recently seen key. */
export class LruSet {
  private readonly m = new Set<string>();
  constructor(private readonly max: number) {}

  /** Returns true when the key was new (and records it). */
  add(key: string): boolean {
    const had = this.m.delete(key);
    this.m.add(key);
    if (this.m.size > this.max) this.m.delete(this.m.values().next().value as string);
    return !had;
  }

  delete(key: string): void {
    this.m.delete(key);
  }

  get size(): number {
    return this.m.size;
  }
}
