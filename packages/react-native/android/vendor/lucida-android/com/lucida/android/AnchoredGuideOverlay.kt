package com.lucida.android

import android.animation.ObjectAnimator
import android.animation.ValueAnimator
import android.app.Activity
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.accessibility.AccessibilityEvent
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import com.lucida.core.GuideAnchor
import com.lucida.core.GuideButton
import com.lucida.core.GuidePlacement
import com.lucida.core.GuideTheme
import com.lucida.core.GuideTokens
import com.lucida.core.MobileGuide

/**
 * Anchored guide steps on Android (N-DAP-10). The step's native_id names the view: its tag (a String) or its
 * resource entry name (`R.id.<name>`). The bubble lives in a non-clickable overlay on the decor view, so touches
 * outside it reach the app; it follows the view every 100 ms (scroll, rotation, relayout). A hotspot draws a pulsing
 * dot on the view that opens the bubble. A view gone for 2 s (the screen changed) ends the step as closed.
 * shortcut: classic Views only (Compose testTag nodes are not Views); upgrade with a semantics-tree lookup.
 */
/** Marker type, so the anchor lookup skips Lucida's own overlay. */
internal class GuideOverlayLayout(ctx: android.content.Context) : FrameLayout(ctx)

internal object AnchoredGuideOverlay {
    private val main = Handler(Looper.getMainLooper())

    /** The front-most shown view whose String tag or resource entry name is [id]. */
    fun find(root: View, id: String): View? {
        if (root is ViewGroup) {
            for (i in root.childCount - 1 downTo 0) {
                val c = root.getChildAt(i)
                if (c is GuideOverlayLayout) continue // our own overlay
                find(c, id)?.let { return it }
            }
        }
        if (!root.isShown) return null
        if (root.tag == id) return root
        if (root.id != View.NO_ID) {
            val name = runCatching { root.resources.getResourceEntryName(root.id) }.getOrNull()
            if (name == id) return root
        }
        return null
    }

    fun show(a: Activity, g: MobileGuide, step: Int, buttons: List<GuideButton>, anchor: GuideAnchor, target: View, t: GuideTokens, onAction: (GuideButton?) -> Unit) {
        val decor = a.window.decorView as? ViewGroup ?: return onAction(null)
        val dp = a.resources.displayMetrics.density
        val overlay = GuideOverlayLayout(a)
        overlay.isClickable = false // touches outside the bubble fall through to the app
        overlay.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        val s = g.steps[step]
        val textColor = GuideTheme.argb(t.text) ?: Color.parseColor("#111111")
        val bubble = LinearLayout(a).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (14 * dp).toInt()
            setPadding(pad, (12 * dp).toInt(), pad, (12 * dp).toInt())
            background = GradientDrawable().apply {
                setColor(GuideTheme.argb(t.background) ?: Color.WHITE)
                cornerRadius = ((t.radius ?: 10.0) * dp).toFloat()
            }
            elevation = 8 * dp
            isClickable = true
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_YES
        }
        val face = t.font?.split(",")?.firstOrNull()?.trim(' ', '"', '\'')?.let { Typeface.create(it, Typeface.NORMAL) }
        (s.title ?: if (step == 0) g.name else null)?.let { title ->
            bubble.addView(TextView(a).apply {
                text = title // plain text, never markup
                textSize = 16f
                setTextColor(textColor)
                typeface = Typeface.create(face ?: Typeface.DEFAULT, Typeface.BOLD)
                if (Build.VERSION.SDK_INT >= 28) isAccessibilityHeading = true
            })
        }
        s.body?.let { body ->
            bubble.addView(TextView(a).apply {
                text = body
                textSize = 15f
                setTextColor(textColor)
                face?.let { typeface = it }
            })
        }
        val row = LinearLayout(a).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.END }
        var done = false
        var tick: Runnable? = null
        val finish = { b: GuideButton? ->
            if (!done) {
                done = true
                tick?.let { main.removeCallbacks(it) }
                decor.removeView(overlay)
                onAction(b)
            }
        }
        val accent = GuideTheme.argb(t.accent)
        for (b in buttons) {
            row.addView(Button(a, null, android.R.attr.borderlessButtonStyle).apply {
                text = b.label
                accent?.let { setTextColor(it) }
                setOnClickListener { finish(b) }
            })
        }
        bubble.addView(row)
        val maxW = minOf((300 * dp).toInt(), a.resources.displayMetrics.widthPixels - (24 * dp).toInt())
        overlay.addView(bubble, FrameLayout.LayoutParams(maxW, ViewGroup.LayoutParams.WRAP_CONTENT))
        val dotSize = (16 * dp).toInt()
        val dot = if (anchor.hotspot) View(a).apply {
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(accent ?: Color.parseColor("#E5484D"))
                setStroke((2 * dp).toInt(), Color.WHITE)
            }
            contentDescription = s.title ?: g.name
            isClickable = true
            setOnClickListener {
                bubble.visibility = View.VISIBLE
                bubble.sendAccessibilityEvent(AccessibilityEvent.TYPE_VIEW_FOCUSED)
            }
        } else null
        if (dot != null) {
            overlay.addView(dot, FrameLayout.LayoutParams(dotSize, dotSize))
            bubble.visibility = View.INVISIBLE
            if (Build.VERSION.SDK_INT < 26 || ValueAnimator.areAnimatorsEnabled()) {
                ObjectAnimator.ofFloat(dot, View.SCALE_X, 1f, 1.35f).apply { repeatCount = ValueAnimator.INFINITE; repeatMode = ValueAnimator.REVERSE; duration = 800; start() }
                ObjectAnimator.ofFloat(dot, View.SCALE_Y, 1f, 1.35f).apply { repeatCount = ValueAnimator.INFINITE; repeatMode = ValueAnimator.REVERSE; duration = 800; start() }
            }
        }
        decor.addView(overlay, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        var goneSince = 0L
        val at = IntArray(2)
        val origin = IntArray(2)
        val follow = object : Runnable {
            override fun run() {
                if (done) return
                if (!target.isAttachedToWindow || !target.isShown) {
                    bubble.alpha = 0f
                    dot?.alpha = 0f
                    if (goneSince == 0L) goneSince = SystemClock.uptimeMillis()
                    if (SystemClock.uptimeMillis() - goneSince > 2000) return finish(null)
                } else {
                    goneSince = 0L
                    bubble.alpha = 1f
                    dot?.alpha = 1f
                    target.getLocationInWindow(at)
                    overlay.getLocationInWindow(origin)
                    val box = GuidePlacement.Box(at[0] - origin[0], at[1] - origin[1], target.width, target.height)
                    val bounds = GuidePlacement.Box(0, 0, overlay.width, overlay.height)
                    val (x, y) = GuidePlacement.origin(bubble.width.takeIf { it > 0 } ?: maxW, bubble.height, box, bounds, anchor.placement, (12 * dp).toInt(), (8 * dp).toInt())
                    bubble.translationX = x.toFloat()
                    bubble.translationY = y.toFloat()
                    dot?.let {
                        it.translationX = (box.right - dotSize / 2).coerceIn(0, maxOf(0, bounds.width - dotSize)).toFloat()
                        it.translationY = (box.top - dotSize / 2).coerceIn(0, maxOf(0, bounds.height - dotSize)).toFloat()
                    }
                }
                main.postDelayed(this, 100)
            }
        }
        tick = follow
        main.post(follow)
        if (dot == null) bubble.post { bubble.sendAccessibilityEvent(AccessibilityEvent.TYPE_VIEW_FOCUSED) }
    }
}
