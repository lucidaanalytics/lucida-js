import type { Storage, Transport, TransportResult } from "../src/index.js";

export class MemStorage implements Storage {
  data = new Map<string, string>();
  writes = 0;
  get(k: string): string | null {
    return this.data.get(k) ?? null;
  }
  set(k: string, v: string): void {
    this.writes++;
    this.data.set(k, v);
  }
  remove(k: string): void {
    this.writes++;
    this.data.delete(k);
  }
}

export class FakeTransport implements Transport {
  calls: Array<{ url: string; body: string; beacon: boolean }> = [];
  statuses: number[] = [];
  async send(url: string, body: string, opts?: { beacon?: boolean }): Promise<TransportResult> {
    this.calls.push({ url, body, beacon: !!opts?.beacon });
    return { status: this.statuses.shift() ?? 200 };
  }
  events(): Array<{ event: string; distinct_id: string; properties: Record<string, unknown> }> {
    return this.calls.flatMap((c) => (JSON.parse(c.body) as { batch: never[] }).batch);
  }
}
