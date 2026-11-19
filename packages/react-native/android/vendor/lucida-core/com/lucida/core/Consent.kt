package com.lucida.core

enum class ConsentMode { OPT_IN, OPT_OUT }

private const val KEY = "lc_consent"
private val CATEGORIES = listOf("analytics", "replay", "marketing")

/**
 * opt_in: every category starts denied. opt_out: granted unless a stored decision says otherwise.
 * Only [set] writes to the real store.
 */
class Consent(private val store: KeyValueStore, val mode: ConsentMode = ConsentMode.OPT_OUT, val queueBeforeConsent: Boolean = false) {
    private val state = CATEGORIES.associateWith { mode == ConsentMode.OPT_OUT }.toMutableMap()

    init {
        store.get(KEY)?.let { raw ->
            runCatching { Json.decodeObj(raw) }.getOrNull()?.let { s ->
                for (c in CATEGORIES) (s[c] as? Boolean)?.let { state[c] = it }
            }
        }
    }

    @Synchronized fun has(category: String) = state[category] == true

    /** True while an opt_in project still waits for an analytics decision. */
    val pending: Boolean @Synchronized get() = mode == ConsentMode.OPT_IN && state["analytics"] != true

    @Synchronized fun all(): Map<String, Boolean> = state.toMap()

    @Synchronized fun set(update: Map<String, Boolean>) {
        for (c in CATEGORIES) update[c]?.let { state[c] = it }
        store.set(KEY, Json.encode(state))
    }
}

/** Keeps writes in memory until [allowed] is true; guarantees no storage before consent. */
class GatedStore(private val inner: KeyValueStore, private val allowed: () -> Boolean) : KeyValueStore {
    private val mem = HashMap<String, String?>()

    @Synchronized override fun get(key: String): String? = if (mem.containsKey(key)) mem[key] else inner.get(key)

    @Synchronized override fun set(key: String, value: String) {
        if (allowed()) inner.set(key, value) else mem[key] = value
    }

    @Synchronized override fun remove(key: String) {
        if (allowed()) inner.remove(key) else mem[key] = null
    }

    @Synchronized fun flushBuffered() {
        mem.forEach { (k, v) -> if (v == null) inner.remove(k) else inner.set(k, v) }
        mem.clear()
    }

    @Synchronized fun discardBuffered() = mem.clear()
}
