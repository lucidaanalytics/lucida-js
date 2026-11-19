package com.lucida.core

import java.net.HttpURLConnection
import java.net.URI

/**
 * Adds `X-Lucida-Distinct-Id` / `X-Lucida-Session-Id` to requests for your own backend hosts so server events
 * join this device's session. [hosts] entries match exactly, or as a suffix when they start with a dot
 * (`.example.com`). Never added for the Lucida api host, and only while analytics consent is granted.
 * Servers must treat these headers as client-controlled, never as authentication.
 * The same requests carry W3C `baggage: lucida.session_id=<id>` (merged into the app's own baggage) so Watchtower links its
 * spans, network timings and logs to this session: the Watchtower seam, Lucida itself captures no network or log data.
 */
class TracingHeaders(
    private val hosts: List<String>,
    private val apiHost: String,
    private val consent: () -> Boolean,
    private val ids: () -> Pair<String, String>,
) {
    private val api = hostOf(apiHost)

    private fun hostOf(url: String) = runCatching { URI(url).host?.lowercase() }.getOrNull()

    private fun matches(host: String) = hosts.any { h ->
        val x = h.lowercase()
        if (x.startsWith(".")) host.endsWith(x) else host == x
    }

    /** [baggage] is the request's existing `baggage` value, kept (minus a stale Lucida entry) in the returned one. */
    fun headersFor(url: String, baggage: String? = null): Map<String, String> {
        val host = hostOf(url) ?: return emptyMap()
        if (hosts.isEmpty() || host == api || !matches(host) || !consent()) return emptyMap()
        val (d, s) = ids()
        return mapOf("X-Lucida-Distinct-Id" to d, "X-Lucida-Session-Id" to s, "baggage" to withBaggage(baggage, s))
    }

    /** HttpURLConnection helper: call before connecting. */
    fun apply(conn: HttpURLConnection) = headersFor(conn.url.toString(), conn.getRequestProperty("baggage")).forEach { (k, v) -> conn.setRequestProperty(k, v) }

    companion object {
        /** `lucida.session_id=<id>` appended to [existing] W3C baggage, replacing a stale Lucida entry. */
        fun withBaggage(existing: String?, sessionId: String): String =
            ((existing ?: "").split(',').map { it.trim() }.filter { it.isNotEmpty() && !it.startsWith("lucida.session_id=") } + "lucida.session_id=$sessionId").joinToString(",")
    }
}
