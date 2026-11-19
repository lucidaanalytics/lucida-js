package com.lucida.core

import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

data class QueueConfig(
    val url: String,
    val apiKey: String,
    val flushAt: Int = 20,
    val flushIntervalMs: Long = 5000,
    val maxQueueSize: Int = 1000,
    val maxRetries: Int = 5,
    val maxBatchSize: Int = 100,
    val retryBaseMs: Long = 1000,
    /** Wi-Fi-only data mode: return false on cellular; events then wait in the queue. */
    val networkAllowed: () -> Boolean = { true },
    val random: () -> Double = Math::random,
)

/**
 * Persistent batching queue: flush at N events or T ms, retry with backoff, drop-oldest when full.
 * Items are mirrored to [store] and removed only once the server acknowledges them, so a killed app
 * resumes where it left off (at-least-once; the event uuid dedupes server-side).
 * shortcut: rewrites the whole JSON list on every enqueue (O(n), n <= maxQueueSize); move to an append log if profiling says so.
 */
class EventQueue(
    private val http: HttpPort,
    private val store: KeyValueStore,
    private val clock: Clock,
    private val cfg: QueueConfig,
    private val onDrop: (List<Obj>, String) -> Unit = { _, _ -> },
    private val executor: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "lucida-queue").apply { isDaemon = true } },
) {
    private val items = ArrayList<Obj>()
    private val flushLock = ReentrantLock()
    private var timer: ScheduledFuture<*>? = null
    private var attempt = 0
    private var closed = false

    init {
        store.get(KEY)?.let { raw ->
            @Suppress("UNCHECKED_CAST")
            runCatching { (Json.decode(raw) as List<Obj>) }.getOrNull()?.let(items::addAll)
        }
    }

    val size: Int @Synchronized get() = items.size

    @Synchronized private fun persist() = if (items.isEmpty()) store.remove(KEY) else store.set(KEY, Json.encode(items))

    fun enqueue(e: Obj) {
        var flushNow = false
        synchronized(this) {
            if (closed) return
            items.add(e)
            if (items.size > cfg.maxQueueSize) {
                val dropped = items.subList(0, items.size - cfg.maxQueueSize)
                onDrop(ArrayList(dropped), "queue_full")
                dropped.clear()
            }
            persist()
            flushNow = items.size >= cfg.flushAt
            if (!flushNow) arm(cfg.flushIntervalMs)
        }
        if (flushNow) executor.execute { flush() }
    }

    @Synchronized private fun arm(ms: Long) {
        if (timer?.isDone == false) return
        timer = executor.schedule({ flush() }, ms, TimeUnit.MILLISECONDS)
    }

    @Synchronized private fun disarm() {
        timer?.cancel(false)
        timer = null
    }

    /** Send everything queued, blocking until done or a retry is scheduled. */
    fun flush() {
        flushLock.withLock {
            while (true) {
                val batch: List<Obj>
                synchronized(this) {
                    disarm()
                    if (items.isEmpty()) return
                    if (!cfg.networkAllowed()) {
                        arm(cfg.flushIntervalMs)
                        return
                    }
                    batch = ArrayList(items.take(cfg.maxBatchSize.coerceAtLeast(1)))
                }
                val body = Json.encode(
                    mapOf("api_key" to cfg.apiKey, "batch" to batch, "sent_at" to java.time.Instant.ofEpochMilli(clock.nowMs()).toString()),
                )
                val status = runCatching { http.send("POST", "${cfg.url}?compression=gzip", body, mapOf("Content-Type" to "application/json"), gzip = true).status }.getOrDefault(0)
                if (!settle(batch, status)) return
            }
        }
    }

    /** True when the loop should continue with the next batch. */
    @Synchronized private fun settle(batch: List<Obj>, status: Int): Boolean {
        if (status in 200..299) {
            removeSent(batch.size)
            attempt = 0
            return items.isNotEmpty()
        }
        if (!isRetryable(status) || attempt >= cfg.maxRetries) {
            removeSent(batch.size)
            attempt = 0
            onDrop(batch, "status_$status")
            return items.isNotEmpty()
        }
        arm(backoffDelay(attempt++, baseMs = cfg.retryBaseMs, random = cfg.random))
        return false
    }

    private fun removeSent(n: Int) {
        items.subList(0, minOf(n, items.size)).clear()
        persist()
    }

    /** Flush on the queue thread (never block the caller; Android forbids network on the main thread). */
    fun flushAsync() = executor.execute { flush() }

    /** Consent revoked: send what is queued (it includes `$opt_out`), then delete the rest. */
    fun drainThenClear() = executor.execute {
        flush()
        clear()
    }

    /** Block until work already submitted to the queue thread has run (tests, shutdown). */
    fun idle() = executor.submit {}.get()

    /** Discard everything (consent revoked). */
    @Synchronized fun clear() {
        items.clear()
        store.remove(KEY)
        disarm()
    }

    fun shutdown() {
        flush()
        synchronized(this) { closed = true }
        disarm()
        executor.shutdown()
    }

    private companion object {
        const val KEY = "lc_queue"
    }
}
