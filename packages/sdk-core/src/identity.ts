import type { Props, Storage } from "./ports.js";
import { uuidv7 } from "./uuid.js";

const KEY = "lc_identity";

interface IdentityState {
  distinct_id: string;
  anon_id: string;
  identified: boolean;
}

export interface IdentifyOutcome {
  /** Event to send, or null when nothing changed. */
  event: "$identify" | null;
  /** distinct_id that was current before (becomes $anon_distinct_id when anonymous). */
  anonDistinctId?: string;
}

/** Identity state: anonymous UUIDv7 until identify(); persisted through the (gated) storage. */
export class Identity {
  private s: IdentityState;

  constructor(
    private readonly storage: Storage,
    bootstrapId?: string,
    /** No anonymous id: distinctId is "" until identify() and nothing is written for it. */
    private readonly cookieless = false,
    /** The server already knows this visitor as a user (bootstrap). */
    bootstrapIdentified = false,
  ) {
    const raw = storage.get(KEY);
    let parsed: IdentityState | undefined;
    try {
      parsed = raw ? (JSON.parse(raw) as IdentityState) : undefined;
    } catch {
      parsed = undefined;
    }
    if (parsed?.distinct_id) this.s = parsed;
    else if (cookieless) this.s = { distinct_id: "", anon_id: "", identified: false };
    else {
      const id = bootstrapId ?? uuidv7();
      this.s = { distinct_id: id, anon_id: id, identified: bootstrapIdentified && !!bootstrapId };
      this.save();
    }
  }

  private save(): void {
    this.storage.set(KEY, JSON.stringify(this.s));
  }

  get distinctId(): string {
    return this.s.distinct_id;
  }

  /** The pre-identify id, only while it differs from the current one; sent as `anon_distinct_id` to /v1/flags (LC-FLG-34). */
  get priorAnonId(): string | undefined {
    return this.s.identified && this.s.anon_id && this.s.anon_id !== this.s.distinct_id ? this.s.anon_id : undefined;
  }

  get isIdentified(): boolean {
    return this.s.identified;
  }

  /**
   * Switch to a known user id. Links the previous anonymous id only when we were anonymous;
   * an already-identified user switching ids sends $identify without the anon link (the
   * gateway refuses to merge two identified persons).
   */
  identify(newId: string): IdentifyOutcome {
    if (!newId || newId === this.s.distinct_id) {
      if (newId && !this.s.identified) {
        this.s.identified = true;
        this.save();
      }
      return { event: null };
    }
    const prev = this.s.distinct_id;
    const wasAnon = !this.s.identified;
    this.s = { ...this.s, distinct_id: newId, identified: true };
    this.save();
    return wasAnon && prev ? { event: "$identify", anonDistinctId: prev } : { event: "$identify" };
  }

  /** Props for a $create_alias event: alias is linked to the current distinct_id. */
  aliasProps(alias: string, original?: string): Props {
    return { alias, distinct_id: original ?? this.s.distinct_id };
  }

  /** Forget the user: fresh anonymous id (or, with `reuseAnonymousId`, the one this device started with). */
  reset(reuseAnonymousId = false): void {
    if (this.cookieless) {
      this.s = { distinct_id: "", anon_id: "", identified: false };
      return;
    }
    const id = (reuseAnonymousId && this.s.anon_id) || uuidv7();
    this.s = { distinct_id: id, anon_id: id, identified: false };
    this.save();
  }
}
