package com.lucida.core

/**
 * Collects mobile replay events and ships them to POST /v1/replay?compression=gzip as
 * `{api_key, session_id, window_id, seq, events}`. `seq` is monotonic per window and resets when the
 * session rotates (the next screen capture then takes a fresh full snapshot). Replay consent is
 * required: without it nothing is recorded. [flush] blocks; call it off the main thread.
 *
 * Gates: consent, project kill switch + sample rate ([loadRemote], tightening only), linked flag, pause/stop,
 * screen allow/deny list, and the minimum duration (sealed chunks wait until the session has been recorded
 * that long; a session that ends or rotates sooner is dropped, never sent).
 */
/**
 * Recorder behaviour: [sampleRate] decides per session (stable for the whole session), [throttleMs] spaces screen captures.
 * [minDurationMs] holds chunks back, [useRemoteConfig] fetches `GET /v1/config`, [linkedFlag] starts recording only while that
 * flag is on, [screenAllowList]/[screenDenyList] pick screens (deny wins; empty allow = all). [maskScreens] (P-M17, `*` wildcard,
 * case-insensitive) and [maskTextPatterns] (P-M46 regular expressions) add to the project's lists; [captureDeadSwipes] sends
 * `$dead_swipe` for swipes that changed nothing.
 */
data class ReplayOptions(
    val sampleRate: Double = 1.0,
    val throttleMs: Long = 0,
    val minDurationMs: Long = 0,
    val useRemoteConfig: Boolean = true,
    val linkedFlag: String? = null,
    val screenAllowList: List<String> = emptyList(),
    val screenDenyList: List<String> = emptyList(),
    val maskScreens: List<String> = emptyList(),
    val maskTextPatterns: List<String> = emptyList(),
    val captureDeadSwipes: Boolean = true,
)

class ReplayRecorder(
    private val core: Core,
    private val options: ReplayOptions = ReplayOptions(),
    private val chunkEvents: Int = 200,
    private val maxPendingChunks: Int = 20,
    private val flagEnabled: (String) -> Boolean = { false },
) {
    private class Chunk(val session: String, val seq: Int, val events: List<Obj>, var tries: Int = 0)

    private val buf = ArrayList<Obj>()
    private val pending = ArrayDeque<Chunk>()
    private var lastSession: String? = null
    private var seq = 0
    private var snapshot: Snapshot? = null
    private var sessionStartMs = 0L
    private var released = false

    /** True when the session rotated since the last chunk: the host should re-capture the screen. */
    @Volatile var needsSnapshot = true
        private set

    @Volatile private var running = true
    @Volatile private var paused = false
    @Volatile private var remote: RemoteReplayConfig? = null
    @Volatile private var remoteLoaded = false
    @Volatile private var screenAllowed = true
    private var lastScreenAt = Long.MIN_VALUE
    @Volatile private var patterns: List<Regex> = ReplayMasking.compile(options.maskTextPatterns)
    private val sensitive = SensitiveCapture()
    private var lastDeadSwipeAt: Long? = null

    /** The screen the last [screen] call named; `$dead_swipe` and `$sensitive_capture` are attributed to it. */
    @Volatile var currentScreen = "Unknown"
        private set

    /** Manual control: stop() ends recording until start() and drops chunks still waiting for the minimum duration. */
    fun start() {
        running = true
    }

    @Synchronized
    fun stop() {
        running = false
        dropUnreleased()
    }

    /** Keeps the recorder alive but captures nothing until [resume]. */
    fun pause() {
        paused = true
    }

    fun resume() {
        paused = false
    }

    val isActive: Boolean get() = enabled && sampled() && flagOk()

    private fun flagOk() = options.linkedFlag?.let { flagEnabled(it) } ?: true

    private fun sampled(): Boolean {
        val rate = ReplayPolicy.sampleRate(options.sampleRate, remote)
        if (rate >= 1.0) return true
        if (rate <= 0.0) return false
        return (core.session.touch().hashCode().toLong() and 0x7fffffffL) % 10_000 / 10_000.0 < rate
    }

    val enabled: Boolean get() = running && !paused && core.consent.has("analytics") && core.consent.has("replay")

    /** Fetch the project's replay config once (blocking; call off the main thread). Unreachable: local settings stand. */
    fun loadRemote() {
        if (!options.useRemoteConfig || remoteLoaded || !core.consent.has("analytics")) return
        remoteLoaded = true
        val key = java.net.URLEncoder.encode(core.cfg.apiKey, "UTF-8")
        val r = runCatching { core.cfg.http.send("GET", "${core.host}/v1/config?api_key=$key") }.getOrNull() ?: return
        if (r.status !in 200..299) return
        val rc = RemoteReplayConfig.parse(r.body) ?: return
        patterns = ReplayMasking.compile(options.maskTextPatterns + rc.maskTextPatterns)
        remote = rc
    }

    /** P-M17: the local list plus the project's `replay_mask_screens`. */
    fun screenMasked(screen: String) = ReplayPolicy.screenMasked(screen, options.maskScreens + (remote?.maskScreens ?: emptyList()))

    /** P-M17 + P-M46 on a walked tree; [screen] applies it to wireframes itself, hosts call it before a screenshot plan. */
    fun applyPrivacy(root: ViewNode, screen: String, screenshot: Boolean): ViewNode = ReplayMasking.apply(root, screenMasked(screen), patterns, screenshot)

    /** P-L12 field ids for the view walker; empty unless the project sent both the list and its key. */
    fun exposureFields(): Set<String> = remote?.takeIf { it.exposureKey != null }?.exposureFields?.toSet() ?: emptySet()

    /**
     * P-L12: encrypts a listed field's value and captures `$sensitive_capture` (analytics + replay consent and the project
     * key required). Identical values are sent once per session; nothing is sent when encryption fails. Call off the main thread.
     */
    fun captureSensitive(field: String, value: String): Boolean {
        if (value.isEmpty() || !core.consent.has("analytics") || !core.consent.has("replay")) return false
        val r = remote ?: return false
        val key = r.exposureKey ?: return false
        if (field !in r.exposureFields) return false
        val p = sensitive.properties(field, value, currentScreen, key, core.session.touch()) ?: return false
        core.capture("\$sensitive_capture", p)
        return true
    }

    /** Recording touches right now: the gates hold and a snapshot of an allowed screen was taken. */
    val touchesRecording: Boolean
        @Synchronized get() = snapshot != null && enabled && screenAllowed

    /**
     * P-M46: [start] was walked when the swipe began on [startScreen], [end] ~700 ms after it ended; equal structure on the
     * same screen and a 48 dp swipe is a `$dead_swipe` (at most one per 2 s). Call off the main thread.
     */
    fun deadSwipe(startScreen: String, start: ViewNode, end: ViewNode, dx: Double, dy: Double): Boolean {
        if (!options.captureDeadSwipes || !touchesRecording) return false
        val fa = DeadSwipe.fingerprint(start)
        val fb = DeadSwipe.fingerprint(end)
        val now = core.clock.nowMs()
        val props = synchronized(this) {
            DeadSwipe.decide(currentScreen, startScreen, fa, fb, dx, dy, now, lastDeadSwipeAt)?.also { lastDeadSwipeAt = now }
        } ?: return false
        core.capture("\$dead_swipe", props)
        return true
    }

    /** Would [screen] be recorded right now (gates + throttle)? Lets a host skip an expensive screenshot. */
    fun shouldCapture(screen: String): Boolean = isActive && ReplayPolicy.screenAllowed(screen, options.screenAllowList, options.screenDenyList) &&
        (needsSnapshot || core.clock.nowMs() - lastScreenAt >= options.throttleMs)

    @Synchronized
    fun screen(root: ViewNode, screen: String, width: Int, height: Int, frame: ScreenshotFrame? = null) {
        currentScreen = screen
        if (!isActive) return
        screenAllowed = ReplayPolicy.screenAllowed(screen, options.screenAllowList, options.screenDenyList)
        if (!screenAllowed) {
            // Entering a denied screen pauses recording; coming back takes a fresh snapshot and taps there are dropped.
            needsSnapshot = true
            snapshot = null
            return
        }
        val now = core.clock.nowMs()
        if (!needsSnapshot && now - lastScreenAt < options.throttleMs) return
        lastScreenAt = now
        val s = if (frame != null) {
            Wireframe.screenshotSnapshot(frame.jpegBase64, screen, frame.width, frame.height, now)
        } else {
            Wireframe.snapshot(applyPrivacy(root, screen, false), screen, width, height, now)
        }
        snapshot = s
        needsSnapshot = false
        buf.addAll(s.events)
        sealIfFull()
    }

    @Synchronized
    fun tap(x: Double, y: Double) {
        val s = snapshot ?: return
        if (!enabled || !screenAllowed) return
        buf.add(Wireframe.tap(s, x, y, core.clock.nowMs()))
        sealIfFull()
    }

    private fun sealIfFull() {
        if (buf.size >= chunkEvents) seal()
    }

    private fun dropUnreleased() {
        if (!released) {
            buf.clear()
            pending.clear()
        }
    }

    private fun seal() {
        if (buf.isEmpty()) return
        val sid = core.session.touch()
        if (lastSession != sid) {
            if (lastSession != null) {
                seq = 0
                needsSnapshot = true
                if (!released) pending.removeAll { it.session == lastSession }  // session ended before the minimum duration
            }
            released = false
            sessionStartMs = core.clock.nowMs()
        }
        lastSession = sid
        pending.addLast(Chunk(sid, seq++, ArrayList(buf)))
        buf.clear()
        while (pending.size > maxPendingChunks) pending.removeFirst()
    }

    /** Seal what is buffered and POST every pending chunk in order; stops at the first failure. */
    fun flush() {
        loadRemote()
        val killed = ReplayPolicy.sampleRate(options.sampleRate, remote) <= 0.0
        val ok = synchronized(this) {
            seal()
            if (killed) {
                clear()
                false
            } else {
                val minMs = ReplayPolicy.minDurationMs(options.minDurationMs, remote)
                if (!released && pending.isNotEmpty()) released = core.clock.nowMs() - sessionStartMs >= minMs
                released || pending.isEmpty()
            }
        }
        if (!ok) return
        while (true) {
            val c = synchronized(this) { pending.firstOrNull() } ?: return
            val body = Json.encode(
                mapOf("api_key" to core.cfg.apiKey, "session_id" to c.session, "window_id" to core.session.windowId, "seq" to c.seq, "events" to c.events),
            )
            val status = runCatching {
                core.cfg.http.send("POST", "${core.host}/v1/replay?compression=gzip", body, mapOf("Content-Type" to "application/json"), gzip = true).status
            }.getOrDefault(0)
            synchronized(this) {
                if (status in 200..299 || !isRetryable(status) || ++c.tries > MAX_TRIES) {
                    pending.remove(c)
                } else {
                    return
                }
            }
        }
    }

    /** Drop everything (consent revoked). */
    @Synchronized
    fun clear() {
        buf.clear()
        pending.clear()
        snapshot = null
        needsSnapshot = true
        released = false
    }

    private companion object {
        const val MAX_TRIES = 5
    }
}
