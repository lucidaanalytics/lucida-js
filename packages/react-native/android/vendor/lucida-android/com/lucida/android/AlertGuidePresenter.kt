package com.lucida.android

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.res.Configuration
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.content.DialogInterface
import com.lucida.core.AnchoredGuidePresenter
import com.lucida.core.GuideAnchor
import com.lucida.core.GuideButton
import com.lucida.core.GuideTheme
import com.lucida.core.MobileGuide

/**
 * Guide steps as an android.app.AlertDialog on the current Activity, always on the main thread.
 * Text is set as plain strings, never markup. A dialog shows at most three buttons (the first three).
 * The resolved accent token tints the buttons; a carousel shows its slide position. Anchored steps
 * (tooltip, hotspot, tour with native_id) are drawn next to their view by [AnchoredGuideOverlay].
 */
class AlertGuidePresenter(private val activity: () -> Activity?) : AnchoredGuidePresenter {
    private val main = Handler(Looper.getMainLooper())

    override fun present(guide: MobileGuide, step: Int, buttons: List<GuideButton>, onAction: (GuideButton?) -> Unit) {
        main.post {
            val a = activity()
            if (a == null || a.isFinishing) return@post onAction(null)
            var done = false
            val finish = { b: GuideButton? ->
                if (!done) {
                    done = true
                    onAction(b)
                }
            }
            val s = guide.steps[step]
            val pager = if (guide.kind == "carousel") dots(step, guide.steps.size) else null
            val message = listOfNotNull(s.body, pager).joinToString("\n\n").ifEmpty { null }
            val d = AlertDialog.Builder(a).setTitle(s.title ?: guide.name).setMessage(message)
            buttons.getOrNull(0)?.let { b -> d.setPositiveButton(b.label) { _, _ -> finish(b) } }
            buttons.getOrNull(1)?.let { b -> d.setNegativeButton(b.label) { _, _ -> finish(b) } }
            buttons.getOrNull(2)?.let { b -> d.setNeutralButton(b.label) { _, _ -> finish(b) } }
            d.setOnCancelListener { finish(null) } // back / tap outside
            val dialog = d.show()
            GuideTheme.argb(GuideTheme.tokens(guide.appearance, isDark(a)).accent)?.let { c ->
                for (w in listOf(DialogInterface.BUTTON_POSITIVE, DialogInterface.BUTTON_NEGATIVE, DialogInterface.BUTTON_NEUTRAL)) dialog.getButton(w)?.setTextColor(c)
            }
        }
    }

    override fun presentAnchored(guide: MobileGuide, step: Int, buttons: List<GuideButton>, anchor: GuideAnchor, onMissing: () -> Unit, onAction: (GuideButton?) -> Unit) {
        val deadline = SystemClock.uptimeMillis() + anchor.waitMs
        fun attempt() {
            val a = activity()
            if (a == null || a.isFinishing) return onAction(null)
            val target = AnchoredGuideOverlay.find(a.window.decorView, anchor.nativeId)
            when {
                target != null -> AnchoredGuideOverlay.show(a, guide, step, buttons, anchor, target, GuideTheme.tokens(guide.appearance, isDark(a)), onAction)
                SystemClock.uptimeMillis() >= deadline -> {
                    onMissing()
                    present(guide, step, buttons, onAction)
                }
                else -> main.postDelayed({ attempt() }, 150)
            }
        }
        main.post { attempt() }
    }

    override fun open(url: String) {
        main.post { activity()?.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
    }

    companion object {
        fun isDark(a: Activity): Boolean = (a.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES

        /** Slide position as dots, e.g. "● ○ ○". */
        fun dots(i: Int, n: Int): String = (0 until n).joinToString(" ") { if (it == i) "●" else "○" }
    }
}
