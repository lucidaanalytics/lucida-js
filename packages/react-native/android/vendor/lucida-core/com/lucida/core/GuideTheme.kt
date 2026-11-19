package com.lucida.core

/** Resolved guide colors (#hex), corner radius (0..32) and font family. */
data class GuideTokens(val background: String? = null, val text: String? = null, val accent: String? = null, val radius: Double? = null, val font: String? = null)

/**
 * Guide appearance on mobile (N-DAP-9, P-M41): the gateway resolves the project theme into `appearance`, so this only
 * picks light or dark tokens (dark when theme_mode is dark, or auto and the device is in night mode) and re-checks
 * values like the browser SDK.
 */
object GuideTheme {
    private val HEX = Regex("^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")

    fun wantsDark(a: Obj?, systemDark: Boolean): Boolean {
        if ((a?.get("dark") as? Map<*, *>)?.get("tokens") !is Map<*, *>) return false
        val mode = a?.get("theme_mode") as? String ?: "auto"
        return mode == "dark" || (mode == "auto" && systemDark)
    }

    fun tokens(a: Obj?, systemDark: Boolean): GuideTokens {
        var t = GuideTokens(font = a?.get("font_family") as? String)
        val layers = listOfNotNull(a?.get("tokens") as? Map<*, *>, if (wantsDark(a, systemDark)) (a?.get("dark") as? Map<*, *>)?.get("tokens") as? Map<*, *> else null)
        for (l in layers) {
            fun color(k: String) = (l[k] as? String)?.takeIf { HEX.matches(it) }
            t = t.copy(
                background = color("background") ?: t.background,
                text = color("text") ?: t.text,
                accent = color("accent") ?: t.accent,
                radius = (l["radius"] as? Number)?.toDouble()?.takeIf { it in 0.0..32.0 } ?: t.radius,
                font = (l["font"] as? String)?.takeIf { it.isNotBlank() } ?: t.font,
            )
        }
        return t
    }

    /** `#rgb` / `#rrggbb` as an ARGB int (opaque), null for anything else. */
    fun argb(hex: String?): Int? {
        if (hex == null || !HEX.matches(hex)) return null
        val h = hex.drop(1).let { if (it.length == 3) it.map { c -> "$c$c" }.joinToString("") else it }
        return (0xFF shl 24) or h.toInt(16)
    }
}

/** Where an anchored bubble goes (N-DAP-10), in window pixels; pure so it is unit-tested without Android. */
object GuidePlacement {
    data class Box(val left: Int, val top: Int, val width: Int, val height: Int) {
        val right get() = left + width
        val bottom get() = top + height
    }

    /** Below the target when it fits (or placement is not "top"), else above; centred and clamped to [margin] in [bounds]. */
    fun origin(w: Int, h: Int, target: Box, bounds: Box, placement: String?, margin: Int = 24, gap: Int = 16): Pair<Int, Int> {
        val x = target.left + target.width / 2 - w / 2
        val below = target.bottom + gap
        val above = target.top - gap - h
        val fitsBelow = below + h <= bounds.bottom - margin
        val fitsAbove = above >= bounds.top + margin
        val y = if (placement == "top") (if (fitsAbove || !fitsBelow) above else below) else (if (fitsBelow || !fitsAbove) below else above)
        return x.coerceIn(bounds.left + margin, maxOf(bounds.left + margin, bounds.right - margin - w)) to
            y.coerceIn(bounds.top + margin, maxOf(bounds.top + margin, bounds.bottom - margin - h))
    }
}
