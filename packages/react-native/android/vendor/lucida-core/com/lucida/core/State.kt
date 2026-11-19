package com.lucida.core

private fun load(s: KeyValueStore, key: String): Obj? = s.get(key)?.let { runCatching { Json.decodeObj(it) }.getOrNull() }

/** Anonymous UUIDv7 (or [newId]) until identify(); persisted through the (gated) store. */
class Identity(
    private val store: KeyValueStore,
    private val clock: Clock,
    private val newId: () -> String = { uuidv7(clock.nowMs()) },
    bootstrap: Bootstrap? = null,
    private val reuseAnonymousId: Boolean = false,
) {
    var distinctId: String
        private set
    var identified = false
        private set

    /** The device's anonymous id; survives reset() only when `reuseAnonymousId` is set. */
    var anonymousId: String
        private set

    /** True once the anonymous id was linked to the identified one by an `$identify` this device sent (bootstrap-identified never links). */
    var anonLinked = false
        private set

    init {
        val p = load(store, "lc_identity")
        val id = p?.get("distinct_id") as? String
        if (id != null) {
            distinctId = id
            identified = p["identified"] == true
            anonymousId = p["anon_id"] as? String ?: id
            anonLinked = p["anon_linked"] as? Boolean ?: (identified && anonymousId != id)
        } else if (bootstrap?.distinctId != null) {
            distinctId = bootstrap.distinctId
            identified = bootstrap.isIdentified
            anonymousId = if (identified) newId() else distinctId
            save()
        } else {
            distinctId = newId()
            anonymousId = distinctId
            save()
        }
    }

    private fun save() = store.set("lc_identity", Json.encode(mapOf("distinct_id" to distinctId, "anon_id" to anonymousId, "identified" to identified, "anon_linked" to anonLinked)))

    /**
     * Returns the `$identify` props to send, or null when nothing changed. The previous id is linked as
     * `$anon_distinct_id` only while anonymous (the gateway refuses to merge two identified persons).
     */
    @Synchronized fun identify(newId: String): Obj? {
        if (newId.isEmpty() || newId == distinctId) {
            if (newId.isNotEmpty() && !identified) {
                identified = true
                save()
            }
            return null
        }
        val prev = distinctId
        val wasAnon = !identified
        distinctId = newId
        identified = true
        if (wasAnon) anonLinked = true
        save()
        return if (wasAnon) mapOf("\$anon_distinct_id" to prev) else emptyMap()
    }

    @Synchronized fun reset() {
        if (!reuseAnonymousId) anonymousId = newId()
        distinctId = anonymousId
        identified = false
        anonLinked = false
        save()
    }
}

/** UUIDv7 session rotated after 30 min idle or 24 h total. */
class SessionManager(
    private val store: KeyValueStore,
    private val clock: Clock,
    private val idleMs: Long = 30 * 60_000,
    private val maxMs: Long = 24 * 3_600_000,
) {
    val windowId = uuidv7(System.currentTimeMillis())

    @Synchronized fun touch(): String {
        val t = clock.nowMs()
        val s = load(store, "lc_session")
        val last = (s?.get("last") as? Number)?.toLong()
        val start = (s?.get("start") as? Number)?.toLong()
        val fresh = s == null || last == null || start == null || t - last > idleMs || t - start > maxMs
        val id = if (fresh) uuidv7(t) else s!!["id"] as String
        store.set("lc_session", Json.encode(mapOf("id" to id, "start" to (if (fresh) t else start), "last" to t)))
        return id
    }

    fun reset() = store.remove("lc_session")
}

/** Super properties merged into every event; persisted. */
class SuperProps(private val store: KeyValueStore) {
    private var p = LinkedHashMap(load(store, "lc_props") ?: emptyMap())

    private fun save() = store.set("lc_props", Json.encode(p))

    @Synchronized fun register(props: Obj) {
        p.putAll(props)
        save()
    }

    @Synchronized fun registerOnce(props: Obj) {
        props.forEach { (k, v) -> p.putIfAbsent(k, v) }
        save()
    }

    @Synchronized fun unregister(key: String) {
        p.remove(key)
        save()
    }

    @Synchronized fun all(): Obj = LinkedHashMap(p)

    @Synchronized fun clear() {
        p = LinkedHashMap()
        store.remove("lc_props")
    }
}

/** Group memberships (type -> key) attached to every event as `$groups`. */
class Groups(private val store: KeyValueStore) {
    private var g = LinkedHashMap((load(store, "lc_groups") ?: emptyMap()).mapValues { it.value.toString() })

    @Synchronized fun set(type: String, key: String) {
        g[type] = key
        store.set("lc_groups", Json.encode(g))
    }

    @Synchronized fun all(): Map<String, String>? = if (g.isEmpty()) null else LinkedHashMap(g)

    @Synchronized fun clear() {
        g = LinkedHashMap()
        store.remove("lc_groups")
    }
}
