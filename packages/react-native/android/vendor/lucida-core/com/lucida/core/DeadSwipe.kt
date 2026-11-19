package com.lucida.core

import kotlin.math.abs
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * P-M46 `$dead_swipe`: a swipe of at least 48 dp after which nothing on screen scrolled, paged or changed (the tree
 * fingerprint ~700 ms after the gesture equals the one at its start). Carries geometry only, never text.
 */
object DeadSwipe {
    const val MIN_DISTANCE = 48.0
    const val SETTLE_MS = 700L
    const val COOLDOWN_MS = 2000L

    /** Dominant axis of end - start; screen y grows downwards. */
    fun direction(dx: Double, dy: Double) = if (abs(dx) >= abs(dy)) (if (dx < 0) "left" else "right") else (if (dy < 0) "up" else "down")

    /** The `$dead_swipe` properties when the swipe was dead and the 2 s cooldown has passed, else null. */
    fun decide(screen: String, startScreen: String, startFingerprint: String, endFingerprint: String, dx: Double, dy: Double, nowMs: Long, lastAt: Long?): Obj? {
        val distance = sqrt(dx * dx + dy * dy)
        if (distance < MIN_DISTANCE || screen != startScreen || startFingerprint != endFingerprint) return null
        if (lastAt != null && nowMs - lastAt < COOLDOWN_MS) return null
        return mapOf("\$screen_name" to screen, "\$swipe_direction" to direction(dx, dy), "\$swipe_distance" to distance.roundToInt())
    }

    /** Structure of the tree: kinds, frames and text lengths (stars), never the text itself. */
    fun fingerprint(root: ViewNode): String {
        val sb = StringBuilder()
        fun walk(n: ViewNode) {
            sb.append(n.kind.ordinal).append(',').append(n.x).append(',').append(n.y).append(',').append(n.width).append(',').append(n.height)
                .append(',').append(Wireframe.stars(n.text ?: "")).append('[')
            n.children.forEach(::walk)
            sb.append(']')
        }
        walk(root)
        return sb.toString()
    }
}
