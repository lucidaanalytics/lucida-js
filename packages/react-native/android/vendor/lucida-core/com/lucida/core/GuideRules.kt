package com.lucida.core

import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone

/**
 * The schedule, frequency and holdout rules on mobile (G241). The gateway already decides them for this
 * person (recurrence in the zone sent as `tz`, frequency from the views synced to the guide-state store,
 * A/B variant and holdout from the distinct id); these local checks keep a guide fetched earlier from
 * showing after its hours or over its cap on this device.
 */
object GuideRules {
    const val VIEWS = "lc_guide_views"
    const val HELD = "lc_guide_held"

    /** Views kept per guide (the browser SDK keeps the newest 50 too). */
    const val MAX_VIEWS = 50

    private fun parse(raw: String): Long? = runCatching {
        // RFC 3339 with a Z or an offset; fractions of a second are dropped (the gateway checks the exact bound).
        val s = raw.replace(Regex("\\.\\d+"), "")
        val f = SimpleDateFormat(if (s.endsWith("Z")) "yyyy-MM-dd'T'HH:mm:ss'Z'" else "yyyy-MM-dd'T'HH:mm:ssXXX", Locale.US)
        if (s.endsWith("Z")) f.timeZone = TimeZone.getTimeZone("UTC")
        f.parse(s)?.time
    }.getOrNull()

    /** Inside `schedule`: RFC 3339 window, weekdays 0 = Sunday and hours [from, to) in `timezone` or the device zone. */
    fun scheduleOk(s: Map<*, *>?, nowMs: Long): Boolean {
        if (s == null) return true
        (s["start"] as? String)?.let(::parse)?.let { if (nowMs < it) return false }
        (s["end"] as? String)?.let(::parse)?.let { if (nowMs >= it) return false }
        val zone = (s["timezone"] as? String)?.takeIf { it in TimeZone.getAvailableIDs() }?.let(TimeZone::getTimeZone) ?: TimeZone.getDefault()
        val cal = Calendar.getInstance(zone).apply { timeInMillis = nowMs }
        val day = cal.get(Calendar.DAY_OF_WEEK) - 1 // Calendar: 1 = Sunday
        val days = s["days"] as? List<*>
        if (!days.isNullOrEmpty() && days.none { (it as? Number)?.toInt() == day }) return false
        val h = s["hours"] as? Map<*, *> ?: return true
        val hour = cal.get(Calendar.HOUR_OF_DAY)
        return hour >= ((h["from"] as? Number)?.toInt() ?: 0) && hour < ((h["to"] as? Number)?.toInt() ?: 24)
    }

    /** Under `frequency` (`max_views` per rolling `per_days`, lifetime when omitted). */
    fun frequencyOk(f: Map<*, *>, views: List<Long>, nowMs: Long): Boolean {
        val since = (f["per_days"] as? Number)?.let { nowMs - (it.toDouble() * 86_400_000).toLong() } ?: 0L
        return views.count { it >= since } < ((f["max_views"] as? Number)?.toInt() ?: 1)
    }

    /** Merges this device's views into the stored guide state, keeping every other key. */
    fun merged(state: Obj, views: Map<String, List<Long>>): Obj {
        val stored = (state[VIEWS] as? Map<*, *>)?.entries?.associate { (k, v) -> k.toString() to v }?.toMutableMap() ?: mutableMapOf()
        for ((id, v) in views) {
            val old = (stored[id] as? List<*>)?.mapNotNull { (it as? Number)?.toLong() } ?: emptyList()
            stored[id] = (old + v).distinct().sorted().takeLast(MAX_VIEWS)
        }
        return state + (VIEWS to stored)
    }
}
