package com.lucida.core

/**
 * The slice of `GET /v1/config` that governs replay (the document the browser SDK reads). [maskScreens] (P-M17) and
 * [maskTextPatterns] (P-M46, at most 20, each <= 200 chars) add masking; [exposureFields] + [exposureKey] turn on
 * controlled exposure (P-L12) only when both are present.
 */
data class RemoteReplayConfig(
    val sessionRecording: Boolean = true,
    val sampleRate: Double? = null,
    val minDurationMs: Long? = null,
    val maskScreens: List<String> = emptyList(),
    val maskTextPatterns: List<String> = emptyList(),
    val exposureFields: List<String> = emptyList(),
    val exposureKey: ExposureKey? = null,
) {
    companion object {
        fun parse(json: String): RemoteReplayConfig? {
            val o = runCatching { Json.decodeObj(json) }.getOrNull() ?: return null
            fun strings(k: String) = (o[k] as? List<*>)?.filterIsInstance<String>() ?: emptyList()
            val k = o["replay_exposure_key"] as? Map<*, *>
            val kid = k?.get("kid") as? String
            val n = k?.get("n") as? String
            val e = k?.get("e") as? String
            val der = k?.get("pkcs1") as? String
            return RemoteReplayConfig(
                sessionRecording = o["session_recording"] as? Boolean ?: true,
                sampleRate = (o["replay_sample_rate"] as? Number)?.toDouble(),
                minDurationMs = (o["replay_min_duration_ms"] as? Number)?.toLong(),
                maskScreens = strings("replay_mask_screens"),
                maskTextPatterns = strings("replay_mask_text_patterns").filter { it.length <= 200 }.take(20),
                exposureFields = strings("replay_exposure_fields"),
                exposureKey = if (kid != null && n != null && e != null && der != null) ExposureKey(kid, n, e, der) else null,
            )
        }
    }
}

/** Pure replay gating rules. Remote config can only tighten what the app configured locally. */
object ReplayPolicy {
    /** Deny wins; an empty allow list allows every screen. */
    fun screenAllowed(screen: String, allow: List<String>, deny: List<String>) = screen !in deny && (allow.isEmpty() || screen in allow)

    fun sampleRate(local: Double, remote: RemoteReplayConfig?): Double =
        if (remote == null) local else if (remote.sessionRecording) minOf(local, remote.sampleRate ?: 1.0) else 0.0

    fun minDurationMs(local: Long, remote: RemoteReplayConfig?): Long = maxOf(local, remote?.minDurationMs ?: 0L)

    /** P-M17: case-insensitive match of the whole screen name; `*` matches any run of characters. Empty list = false. */
    fun screenMasked(screen: String, patterns: List<String>): Boolean {
        val s = screen.lowercase()
        return patterns.any { glob(s, it.lowercase()) }
    }

    private fun glob(s: String, p: String): Boolean {
        var si = 0
        var pi = 0
        var star = -1
        var mark = 0
        while (si < s.length) {
            when {
                pi < p.length && p[pi] == '*' -> { star = pi; mark = si; pi++ }
                pi < p.length && p[pi] == s[si] -> { si++; pi++ }
                star >= 0 -> { pi = star + 1; mark++; si = mark }
                else -> return false
            }
        }
        while (pi < p.length && p[pi] == '*') pi++
        return pi == p.length
    }
}

/** Absolute rectangle in dp (decor coordinates). */
data class MaskRect(val x: Int, val y: Int, val width: Int, val height: Int)

/** Paint order: [mask] first, then [unmask] regions are restored from the original pixels, then [sensitive] last (always wins). */
data class ScreenshotMaskPlan(val mask: List<MaskRect>, val unmask: List<MaskRect>, val sensitive: List<MaskRect>)

/** An already-masked JPEG frame (base64, from android.util.Base64 so minSdk 23 works); dimensions are dp. */
class ScreenshotFrame(val jpegBase64: String, val width: Int, val height: Int)

enum class MarkerRole { MASK, UNMASK }

/** A Compose (or any non-View) region the app marked; the registry holds screen dp, [MarkerRegistry.snapshot] makes them root-relative. */
data class MarkerRegion(val role: MarkerRole, val rect: MaskRect)

/**
 * Registry the Compose modifiers write to and the view walker reads (Compose content is not in the View tree).
 * Entries are keyed by an opaque owner and removed when the composable leaves composition.
 */
object MarkerRegistry {
    private val regions = LinkedHashMap<Any, MarkerRegion>()

    @Synchronized fun set(owner: Any, region: MarkerRegion) {
        regions[owner] = region
    }

    @Synchronized fun remove(owner: Any) {
        regions.remove(owner)
    }

    /**
     * Regions relative to a root whose top-left sits at ([originX], [originY]) dp on screen. Entries are stored in screen
     * dp so a dialog, a non-full-screen window or system insets do not shift them against the walked decor view.
     */
    @Synchronized fun snapshot(originX: Int = 0, originY: Int = 0): List<MarkerRegion> =
        regions.values.map { it.copy(rect = it.rect.copy(x = it.rect.x - originX, y = it.rect.y - originY)) }

    @Synchronized fun clear() = regions.clear()
}

/** Marker precedence matches iOS and UIKit/View markers: mask always wins over unmask; password-like nodes are never unmasked. */
object MarkerRegions {
    private fun inside(r: MaskRect, g: MaskRect) =
        r.x >= g.x - 1 && r.y >= g.y - 1 && r.x + r.width <= g.x + g.width + 1 && r.y + r.height <= g.y + g.height + 1

    fun apply(root: ViewNode, regions: List<MarkerRegion>): ViewNode {
        if (regions.isEmpty()) return root
        val masks = regions.filter { it.role == MarkerRole.MASK }.map { it.rect }
        val unmasks = regions.filter { it.role == MarkerRole.UNMASK }.map { it.rect }
        fun walk(n: ViewNode, ox: Int, oy: Int, isRoot: Boolean): ViewNode {
            val left = if (isRoot) 0 else ox + n.x
            val top = if (isRoot) 0 else oy + n.y
            val r = MaskRect(left, top, n.width, n.height)
            val kids = n.children.map { walk(it, left, top, false) }
            return when {
                masks.any { inside(r, it) } -> n.copy(maskText = true, maskInput = true, maskImage = true, children = kids)
                !n.neverUnmask && unmasks.any { inside(r, it) } -> n.copy(maskText = false, maskInput = false, maskImage = false, children = kids)
                else -> n.copy(children = kids)
            }
        }
        return walk(root, 0, 0, true)
    }
}

/** Derives the screenshot plan from the (marker-applied) view tree and the raw marker regions. */
object ScreenshotMasks {
    fun plan(root: ViewNode, regions: List<MarkerRegion> = emptyList()): ScreenshotMaskPlan {
        val mask = ArrayList<MaskRect>()
        val unmask = ArrayList<MaskRect>()
        val sensitive = ArrayList<MaskRect>()
        fun walk(n: ViewNode, ox: Int, oy: Int, isRoot: Boolean) {
            val left = if (isRoot) 0 else ox + n.x
            val top = if (isRoot) 0 else oy + n.y
            val r = MaskRect(left, top, n.width, n.height)
            val hidden = when (n.kind) {
                ViewKind.INPUT -> n.maskInput
                ViewKind.IMAGE -> n.maskImage
                else -> n.maskText && (!n.text.isNullOrEmpty() || n.opaque)
            }
            val visibleLeaf = when (n.kind) {
                ViewKind.INPUT -> !n.maskInput
                ViewKind.IMAGE -> !n.maskImage
                else -> !n.maskText && (!n.text.isNullOrEmpty() || n.opaque)
            }
            when {
                n.block || (n.kind == ViewKind.INPUT && n.neverUnmask) -> sensitive.add(r)
                hidden -> mask.add(r)
                visibleLeaf -> unmask.add(r)
            }
            n.children.forEach { walk(it, left, top, false) }
        }
        walk(root, 0, 0, true)
        regions.forEach { if (it.role == MarkerRole.MASK) sensitive.add(it.rect) else unmask.add(it.rect) }
        return ScreenshotMaskPlan(mask, unmask, sensitive)
    }
}
