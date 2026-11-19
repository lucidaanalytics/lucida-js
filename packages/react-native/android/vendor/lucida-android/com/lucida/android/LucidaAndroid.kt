package com.lucida.android

import android.app.Activity
import android.app.Application
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Bundle
import android.view.MotionEvent
import android.view.ViewConfiguration
import android.view.Window
import com.lucida.core.ConsentMode
import com.lucida.core.CoreConfig
import com.lucida.core.DeadSwipe
import com.lucida.core.ReplayMasking
import kotlin.math.hypot
import com.lucida.core.GuidesConfig
import com.lucida.core.Lucida
import com.lucida.core.QueueConfig
import com.lucida.core.ScreenshotMasks
import com.lucida.core.ViewKind
import com.lucida.core.ViewNode
import com.lucida.core.ReplayOptions
import com.lucida.core.UrlConnectionHttp
import java.lang.ref.WeakReference

/**
 * Android entry point. `LucidaAndroid.init(application, "lc_pk_...", "https://ingest.example.com")` wires
 * the pure client in lucida-core to SharedPreferences, HttpURLConnection and the activity lifecycle:
 * `$app_*` lifecycle events, `$screen` per Activity, and (opt-in) wireframe replay with tap capture.
 */
object LucidaAndroid {
    @Volatile lateinit var client: Lucida
        private set

    @Volatile private var current = WeakReference<Activity>(null)

    @Suppress("DEPRECATION")
    fun init(
        app: Application,
        apiKey: String,
        apiHost: String,
        consentMode: ConsentMode = ConsentMode.OPT_OUT,
        replay: ReplayConfig? = null,
        flagDefinitions: List<Map<String, Any?>> = emptyList(),
        /** In-app guides (LC-ENG-15); off by default. Set `presenter` to replace the AlertDialog default. */
        guides: GuidesConfig = GuidesConfig(),
        options: AndroidOptions = AndroidOptions(),
    ): Lucida {
        if (guides.presenter == null) guides.presenter = AlertGuidePresenter { current.get() }
        val info = app.packageManager.getPackageInfo(app.packageName, 0)
        val c = Lucida(
            coreConfig(app, apiKey, apiHost, consentMode, options),
            appVersion = info.versionName ?: "unknown",
            appBuild = (if (android.os.Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()).toString(),
            flagDefinitions = flagDefinitions,
            deviceProperties = mapOf("manufacturer" to android.os.Build.MANUFACTURER, "model" to android.os.Build.MODEL, "os_version" to android.os.Build.VERSION.RELEASE),
            guidesConfig = guides,
            flagOptions = options.flags,
            replayOptions = ReplayOptions(
                replay?.sampleRate ?: 1.0, replay?.throttleMs ?: 0, replay?.minDurationMs ?: 0, replay?.useRemoteConfig ?: true,
                replay?.linkedFlag, replay?.screenAllowList ?: emptyList(), replay?.screenDenyList ?: emptyList(),
                maskScreens = replay?.maskScreens ?: emptyList(), maskTextPatterns = replay?.maskTextPatterns ?: emptyList(),
                captureDeadSwipes = replay?.captureDeadSwipes ?: true,
            ),
            autocaptureConfig = options.autocapture,
            installSource = if (options.installAttribution) InstallReferrerSource.create(app) else null,
        )
        c.core.register(mapOf("\$os" to "Android", "\$os_version" to android.os.Build.VERSION.RELEASE, "\$device_model" to android.os.Build.MODEL))
        client = c
        c.start()
        app.registerActivityLifecycleCallbacks(Callbacks(c, replay, options))
        return c
    }

    private fun coreConfig(app: Application, apiKey: String, apiHost: String, mode: ConsentMode, o: AndroidOptions) = CoreConfig(
        apiKey, apiHost, UrlConnectionHttp(o.requestTimeoutMs), SharedPrefsStore(app), consentMode = mode,
        queue = {
            QueueConfig(
                it, apiKey, flushAt = o.flushAt, flushIntervalMs = o.flushIntervalMs, maxQueueSize = o.maxQueueSize,
                maxRetries = o.maxRetries, maxBatchSize = o.maxBatchSize, retryBaseMs = o.retryDelayMs,
                networkAllowed = { o.dataMode == DataMode.ANY || onUnmeteredLink(app) },
            )
        },
        beforeSend = o.beforeSend, personProfiles = o.personProfiles, disableGeoip = o.disableGeoip, disabled = o.disabled,
        sessionIdleMs = o.sessionIdleMs, sessionMaxMs = o.sessionMaxMs, reuseAnonymousId = o.reuseAnonymousId,
        anonymousIdProvider = o.anonymousIdProvider, bootstrap = o.bootstrap, queueCipher = o.queueCipher,
        tracingHeaders = o.tracingHeaders, debug = o.debug,
    )

    private fun onUnmeteredLink(app: Application): Boolean {
        val cm = app.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return true
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
        return caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
    }

    /** Call from `onNewIntent` (or anywhere a link arrives) to record `$deep_link_opened`. */
    fun handleDeepLink(intent: Intent?, referrer: String? = null) {
        intent?.data?.let { client.deepLink(it.toString(), referrer) }
    }

    private class Callbacks(private val c: Lucida, private val replay: ReplayConfig?, private val options: AndroidOptions) : Application.ActivityLifecycleCallbacks {
        private var started = 0
        private var first = true

        override fun onActivityStarted(a: Activity) {
            if (started++ == 0 && !first) c.foregrounded()
            first = false
        }

        override fun onActivityStopped(a: Activity) {
            if (--started == 0) c.backgrounded()
        }

        override fun onActivityResumed(a: Activity) {
            current = WeakReference(a)
            val screen = a.javaClass.simpleName
            c.screen(screen)
            if ((replay?.captureTouches == true) || options.autocapture.enabled) hook(a.window)
            if (replay != null) record(a, screen)
        }

        private fun record(a: Activity, screen: String) {
            val decor = a.window.decorView
            decor.post {
                if (!c.replay.shouldCapture(screen)) { c.replay.screen(ViewNode(ViewKind.CONTAINER, 0, 0, 0, 0), screen, 0, 0); return@post }
                val d = a.resources.displayMetrics.density
                val regions = WireframeCapture.markerRegions(decor, d)
                val walker = ViewHierarchy(replay!!, d, c.replay.exposureFields())
                val tree = walker.capture(decor, regions)
                walker.exposed.forEach { (field, value) -> c.captureSensitive(field, value) }  // P-L12, encrypted off the main thread
                // The wireframe gets P-M17/P-M46 inside the recorder; the screenshot plan needs them here.
                val frame = if (replay.mode == ReplayMode.SCREENSHOT) {
                    val plan = ScreenshotMasks.plan(c.replay.applyPrivacy(tree, screen, true), ReplayMasking.regions(regions, c.replay.screenMasked(screen)))
                    ScreenshotCapture.capture(a, plan, replay.screenshotQuality)
                } else {
                    null
                }
                if (replay.mode == ReplayMode.SCREENSHOT && frame == null) return@post
                c.replay.screen(tree, screen, Math.round(decor.width / d), Math.round(decor.height / d), frame)
            }
        }

        /** Wrap the window callback once so taps are recorded; the original callback still receives everything. */
        private fun hook(w: Window) {
            val cb = w.callback
            if (cb is TapCallback) return
            val deadSwipes = replay?.takeIf { it.captureTouches && it.captureDeadSwipes }
            w.callback = TapCallback(cb, c, w, replay?.captureTouches == true, deadSwipes)
        }

        override fun onActivityCreated(a: Activity, s: Bundle?) {
            // s != null means a recreate (rotation): the link was already recorded.
            if (s == null && options.captureDeepLinks) handleDeepLink(a.intent, a.referrer?.toString())
        }

        override fun onActivityPaused(a: Activity) {
            if (current.get() === a) current = WeakReference(null)
        }

        override fun onActivitySaveInstanceState(a: Activity, s: Bundle) = Unit
        override fun onActivityDestroyed(a: Activity) = Unit
    }

    private class TapCallback(
        private val inner: Window.Callback,
        private val c: Lucida,
        private val w: Window,
        private val recordTouches: Boolean,
        /** Non-null when `$dead_swipe` is on: the walker config for the start / end fingerprints. */
        private val deadSwipes: ReplayConfig?,
    ) : Window.Callback by inner {
        private val density = w.context.resources.displayMetrics.density
        private val slop = ViewConfiguration.get(w.context).scaledTouchSlop
        private var downX = 0f
        private var downY = 0f
        private var swipeStart: ViewNode? = null
        private var swipeScreen = ""

        override fun dispatchTouchEvent(e: MotionEvent): Boolean {
            if (deadSwipes != null) trackSwipe(e, deadSwipes)
            if (e.actionMasked == MotionEvent.ACTION_UP) {
                val x = e.rawX / density.toDouble()
                val y = e.rawY / density.toDouble()
                if (recordTouches) c.replay.tap(x, y)
                if (c.autocapture.cfg.enabled) autocapture(e, x, y)
            }
            return inner.dispatchTouchEvent(e)
        }

        /**
         * P-M46: the tree is walked when the finger passes the touch slop (this callback runs before the views get the event,
         * so nothing has scrolled yet) and again [DeadSwipe.SETTLE_MS] after a 48 dp swipe ends; the comparison runs on the io thread.
         */
        private fun trackSwipe(e: MotionEvent, cfg: ReplayConfig) {
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downX = e.rawX
                    downY = e.rawY
                    swipeStart = null
                }
                MotionEvent.ACTION_MOVE -> if (swipeStart == null && hypot(e.rawX - downX, e.rawY - downY) > slop && c.replay.touchesRecording) {
                    swipeScreen = c.replay.currentScreen
                    swipeStart = walk(cfg)
                }
                MotionEvent.ACTION_UP -> {
                    val start = swipeStart ?: return
                    swipeStart = null
                    val dx = (e.rawX - downX) / density.toDouble()
                    val dy = (e.rawY - downY) / density.toDouble()
                    if (hypot(dx, dy) < DeadSwipe.MIN_DISTANCE) return
                    val screen = swipeScreen
                    w.decorView.postDelayed({ c.deadSwipe(screen, start, walk(cfg), dx, dy) }, DeadSwipe.SETTLE_MS)
                }
                MotionEvent.ACTION_CANCEL -> swipeStart = null
            }
        }

        private fun walk(cfg: ReplayConfig): ViewNode = ViewHierarchy(cfg, density).capture(w.decorView)

        private fun autocapture(e: MotionEvent, x: Double, y: Double) {
            val root = w.decorView
            val chain = AutocaptureViews.chain(root, e.rawX, e.rawY)
            c.autocapture.tap(chain, x, y)
            if (AutocaptureViews.leafIsCompoundButton(root, e.rawX, e.rawY)) c.autocapture.change(chain)
        }
    }
}
