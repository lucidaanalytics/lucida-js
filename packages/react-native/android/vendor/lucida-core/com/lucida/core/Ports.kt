package com.lucida.core

/** JSON-shaped object: the SDK keeps wire data as plain maps so shared vectors load directly. */
typealias Obj = Map<String, Any?>

/** Port: synchronous key/value persistence (SharedPreferences, file, memory). */
interface KeyValueStore {
    fun get(key: String): String?
    fun set(key: String, value: String)
    fun remove(key: String)
}

class MemoryStore : KeyValueStore {
    val data = LinkedHashMap<String, String>()

    @Synchronized override fun get(key: String) = data[key]

    @Synchronized override fun set(key: String, value: String) {
        data[key] = value
    }

    @Synchronized override fun remove(key: String) {
        data.remove(key)
    }
}

/** status 0 means a network failure. */
class HttpResult(val status: Int, val body: String = "")

/** Port: how bytes leave the SDK. `gzip` asks the adapter to compress the body. */
interface HttpPort {
    fun send(method: String, url: String, body: String? = null, headers: Map<String, String> = emptyMap(), gzip: Boolean = false): HttpResult
}

fun interface Clock {
    fun nowMs(): Long
}

val SystemClock = Clock { System.currentTimeMillis() }
