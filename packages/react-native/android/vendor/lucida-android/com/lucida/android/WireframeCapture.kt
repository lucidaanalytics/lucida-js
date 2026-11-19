package com.lucida.android

import android.app.Activity
import android.view.View
import com.lucida.core.MarkerRegion
import com.lucida.core.MarkerRegistry
import com.lucida.core.ReplayBridge
import com.lucida.core.ReplayMasking
import com.lucida.core.ScreenshotMasks

/**
 * One-shot capture of an Activity's view tree for hosts that drive replay themselves (React Native).
 * Must run on the main thread. Returns `{"width","height","events"}` (see [ReplayBridge]); with [screenshotQuality]
 * (0..100) the full snapshot is a JPEG whose masks were painted before encoding, or "" when nothing could be drawn.
 */
object WireframeCapture {
    fun capture(
        activity: Activity,
        screen: String,
        maskText: Boolean,
        maskAllTextInputs: Boolean = true,
        maskAllImages: Boolean = true,
        maskSandboxedViews: Boolean = true,
        screenshotQuality: Int? = null,
        /** P-M17: mask every text, input and image, whatever the unmask tags say. */
        maskScreen: Boolean = false,
        /** P-M46: regular expressions starred in shown text (screenshots paint matching views); invalid ones are ignored. */
        maskTextPatterns: List<String> = emptyList(),
    ): String {
        val decor = activity.window.decorView
        val d = activity.resources.displayMetrics.density
        val regions = ReplayMasking.regions(markerRegions(decor, d), maskScreen)
        val config = ReplayConfig(maskAllText = maskText, maskAllTextInputs = maskAllTextInputs, maskAllImages = maskAllImages, maskSandboxedViews = maskSandboxedViews)
        val tree = ReplayMasking.apply(ViewHierarchy(config, d).capture(decor, regions), maskScreen, ReplayMasking.compile(maskTextPatterns), screenshotQuality != null)
        val now = System.currentTimeMillis()
        if (screenshotQuality == null) return ReplayBridge.capture(tree, screen, Math.round(decor.width / d), Math.round(decor.height / d), now)
        val frame = ScreenshotCapture.capture(activity, ScreenshotMasks.plan(tree, regions), screenshotQuality.coerceIn(0, 100)) ?: return ""
        return ReplayBridge.screenshot(frame, screen, now)
    }

    /** Compose marker regions relative to [root] (the registry stores screen dp; see [MarkerRegistry.snapshot]). */
    internal fun markerRegions(root: View, density: Float): List<MarkerRegion> {
        val loc = IntArray(2).also(root::getLocationOnScreen)
        return MarkerRegistry.snapshot(Math.round(loc[0] / density), Math.round(loc[1] / density))
    }
}
