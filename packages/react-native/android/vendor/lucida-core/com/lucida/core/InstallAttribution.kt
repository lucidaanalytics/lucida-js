package com.lucida.core

import java.net.URLDecoder

/** Async source of `$app_installed` attribution props: must invoke the callback exactly once (any thread), even on failure. */
typealias InstallSource = ((Obj) -> Unit) -> Unit

private val CLICK_IDS = listOf("gclid", "gbraid", "wbraid", "fbclid", "ttclid", "msclkid")
private val UTM = listOf("source", "medium", "campaign", "term", "content")

/** Maps a Play Install Referrer string (`utm_source=..&gclid=..`) plus timestamps (seconds) to `$app_installed` props. */
fun installReferrerProps(raw: String, clickTs: Long? = null, beginTs: Long? = null): Obj {
    val q = raw.split('&').filter { it.isNotEmpty() }.associate {
        val i = it.indexOf('=')
        val k = if (i < 0) it else it.substring(0, i)
        val v = if (i < 0) "" else runCatching { URLDecoder.decode(it.substring(i + 1), "UTF-8") }.getOrDefault(it.substring(i + 1))
        k to v
    }
    val out = linkedMapOf<String, Any?>("\$install_store" to "google_play", "\$install_referrer" to raw)
    clickTs?.let { out["\$install_referrer_click_ts"] = it }
    beginTs?.let { out["\$install_begin_ts"] = it }
    for (u in UTM) q["utm_$u"]?.takeIf { it.isNotEmpty() }?.let { out["\$utm_$u"] = it }
    for (c in CLICK_IDS) q[c]?.takeIf { it.isNotEmpty() }?.let { out["\$$c"] = it }
    return out
}
