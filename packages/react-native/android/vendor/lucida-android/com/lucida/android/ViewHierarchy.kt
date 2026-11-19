package com.lucida.android

import android.text.InputType
import android.view.SurfaceView
import android.view.TextureView
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.TextView
import com.lucida.core.MarkerRegion
import com.lucida.core.MarkerRegions
import com.lucida.core.ViewKind
import com.lucida.core.ViewNode

/**
 * Replay privacy knobs. Everything is masked by default. Password inputs are masked regardless.
 * [sampleRate] (0..1) is decided once per session; [throttleMs] spaces screen captures.
 */
data class ReplayConfig(
    val maskAllText: Boolean = true,
    val maskAllTextInputs: Boolean = true,
    val maskAllImages: Boolean = true,
    /** WebView / SurfaceView / TextureView (content we cannot see into) are replaced by an empty box. */
    val maskSandboxedViews: Boolean = true,
    val sampleRate: Double = 1.0,
    val throttleMs: Long = 0,
    val maxDepth: Int = 40,
    val maxNodes: Int = 1500,
    /** Record tap positions (the window callback is wrapped only when this or autocapture is on). */
    val captureTouches: Boolean = true,
    /** Hold chunks until the session has been recorded this long; sessions that end sooner are never sent. */
    val minDurationMs: Long = 0,
    /** Fetch the project config (kill switch, sample rate, min duration; can only tighten these settings). */
    val useRemoteConfig: Boolean = true,
    /** Start recording only while this flag is on. */
    val linkedFlag: String? = null,
    /** Only these screens are recorded (empty = all); the deny list wins and pauses recording on a denied screen. */
    val screenAllowList: List<String> = emptyList(),
    val screenDenyList: List<String> = emptyList(),
    /** SCREENSHOT sends masked JPEG frames; masks are painted before encoding, on device. */
    val mode: ReplayMode = ReplayMode.WIREFRAME,
    val screenshotQuality: Int = 40,
    /** Screen-name patterns (`*` wildcard, case-insensitive, whole name) whose snapshots mask all text, inputs and images, whatever the unmask tags say. Union with the project's list. */
    val maskScreens: List<String> = emptyList(),
    /** Regular expressions whose matches are starred in any text replay would show (screenshots paint the view). Union with the project's list. */
    val maskTextPatterns: List<String> = emptyList(),
    /** `$dead_swipe` when a swipe of 48 dp or more changed nothing on screen (needs [captureTouches]). */
    val captureDeadSwipes: Boolean = true,
)

enum class ReplayMode { WIREFRAME, SCREENSHOT }

/**
 * View tags a host can set (`view.tag = "lc-block"`):
 * `lc-block` replaces the view and its subtree with an empty box, `lc-ignore` omits it,
 * `lc-mask` masks its text, input value and image even when the global switches are off,
 * `lc-unmask` shows text, input value and image even when they are on (never password inputs).
 */
object LcTag {
    const val BLOCK = "lc-block"
    const val IGNORE = "lc-ignore"
    const val MASK = "lc-mask"
    const val UNMASK = "lc-unmask"
}

/** android.view.View tree -> platform-neutral [ViewNode] tree (the pure serializer lives in lucida-core). */
private val PASSWORD_VARIATIONS = setOf(
    InputType.TYPE_TEXT_VARIATION_PASSWORD, InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD, InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD,
)

/**
 * [exposureFields] (P-L12): a non-password EditText whose tag string or resource entry name is listed has its value read
 * into [exposed] for `$sensitive_capture`; its node stays masked and can never be unmasked.
 */
class ViewHierarchy(private val cfg: ReplayConfig, private val density: Float, private val exposureFields: Set<String> = emptySet()) {
    private var budget = cfg.maxNodes

    /** (field id, value) pairs read by the last [capture]. */
    val exposed = ArrayList<Pair<String, String>>()

    private fun exposureId(v: View): String? {
        if (exposureFields.isEmpty() || v !is EditText || isPassword(v)) return null
        (v.tag as? String)?.takeIf { it in exposureFields }?.let { return it }
        if (v.id == View.NO_ID) return null
        return runCatching { v.resources.getResourceEntryName(v.id) }.getOrNull()?.takeIf { it in exposureFields }
    }

    private fun isPassword(v: View): Boolean {
        val t = (v as? EditText)?.inputType ?: return false
        val cls = t and InputType.TYPE_MASK_CLASS
        val variation = t and InputType.TYPE_MASK_VARIATION
        return (cls == InputType.TYPE_CLASS_TEXT && variation in PASSWORD_VARIATIONS) ||
            (cls == InputType.TYPE_CLASS_NUMBER && variation == InputType.TYPE_NUMBER_VARIATION_PASSWORD)
    }

    private fun dp(px: Int) = Math.round(px / density)

    /** [regions] are Compose/other marked regions (dp, decor coordinates); mask wins over unmask. */
    fun capture(root: View, regions: List<MarkerRegion> = emptyList()): ViewNode =
        MarkerRegions.apply(node(root, 0, false, false) ?: ViewNode(ViewKind.CONTAINER, 0, 0, dp(root.width), dp(root.height)), regions)

    private fun node(v: View, depth: Int, parentMask: Boolean, parentUnmask: Boolean): ViewNode? {
        if (v.visibility != View.VISIBLE || v.tag == LcTag.IGNORE || budget <= 0) return null
        budget--
        val kind = when (v) {
            is EditText -> ViewKind.INPUT
            is Button -> ViewKind.BUTTON
            is TextView -> ViewKind.TEXT
            is ImageView -> ViewKind.IMAGE
            else -> ViewKind.CONTAINER
        }
        val block = v.tag == LcTag.BLOCK || (cfg.maskSandboxedViews && (v is WebView || v is SurfaceView || v is TextureView))
        // Markers apply to the whole subtree; mask beats unmask at any level.
        val mask = parentMask || v.tag == LcTag.MASK
        val unmask = !mask && (parentUnmask || v.tag == LcTag.UNMASK)
        val exposeId = exposureId(v)
        if (exposeId != null) exposed.add(exposeId to (v as EditText).text.toString())
        // Relative to the parent's visible area: a scrolled parent (ScrollView, ViewPager) shifts its children.
        val parent = v.parent as? View
        val children = if (v is ViewGroup && !block && depth < cfg.maxDepth) {
            (0 until v.childCount).mapNotNull { node(v.getChildAt(it), depth + 1, mask, unmask) }
        } else {
            emptyList()
        }
        return ViewNode(
            kind = kind,
            x = dp(v.left + Math.round(v.translationX) - (parent?.scrollX ?: 0)),
            y = dp(v.top + Math.round(v.translationY) - (parent?.scrollY ?: 0)),
            width = dp(v.width),
            height = dp(v.height),
            // Hint text and password content never leave the device: only TextView.text is read.
            text = if (block) null else (v as? TextView)?.text?.toString(),
            name = v.javaClass.simpleName.lowercase(),
            maskText = mask || (cfg.maskAllText && !unmask),
            maskInput = mask || isPassword(v) || exposeId != null || (cfg.maskAllTextInputs && !unmask),
            maskImage = mask || (cfg.maskAllImages && !unmask),
            block = block,
            neverUnmask = isPassword(v) || exposeId != null,
            opaque = v.javaClass.name.contains("ComposeView"),
            children = children,
        )
    }
}
