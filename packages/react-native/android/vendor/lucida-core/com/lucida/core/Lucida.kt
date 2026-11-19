package com.lucida.core

import java.util.concurrent.Executors

/**
 * Facade: the one object a host app holds. Wires core + flags + lifecycle + replay.
 * Network calls (flags, replay flush) run on a private background thread.
 */
class Lucida(
    config: CoreConfig,
    appVersion: String,
    appBuild: String? = null,
    flagDefinitions: List<Obj> = emptyList(),
    deviceProperties: Obj = emptyMap(),
    val guidesConfig: GuidesConfig = GuidesConfig(),
    flagOptions: FlagOptions = FlagOptions(),
    replayOptions: ReplayOptions = ReplayOptions(),
    autocaptureConfig: AutocaptureConfig = AutocaptureConfig(),
    installSource: InstallSource? = null,
) {
    val core = Core(config)
    private val preload = flagOptions.preload
    val flags = Flags(core, flagDefinitions, deviceProperties, appVersion, flagOptions)
    val lifecycle = Lifecycle(core, appVersion, appBuild, installSource)
    val replay = ReplayRecorder(core, replayOptions, flagEnabled = { flags.isEnabled(it) })
    val autocapture = Autocapture(core, autocaptureConfig)
    val guides = GuidesService(core, guidesConfig) { flags.isEnabled(it) }
    private val io = Executors.newSingleThreadExecutor { r -> Thread(r, "lucida-io").apply { isDaemon = true } }

    /** Emit launch lifecycle events, then load flags in the background. */
    fun start() {
        lifecycle.launched()
        io.execute { reloadAll() }
    }

    // Guides after flags: `flag_key` targeting reads them. Blocking; call off the main thread.
    private fun reloadAll() {
        replay.loadRemote()
        if (preload) flags.reload()
        guides.reload()
    }

    fun capture(event: String, properties: Obj = emptyMap(), set: Obj? = null, setOnce: Obj? = null) = core.capture(event, properties, set, setOnce)
    fun screen(name: String, properties: Obj = emptyMap()): Obj? {
        guides.show(name)
        return core.screen(name, properties)
    }

    fun identify(id: String, set: Obj? = null, setOnce: Obj? = null) {
        core.identify(id, set, setOnce)
        io.execute { reloadAll() }
    }

    fun alias(alias: String) = core.alias(alias)
    fun setPersonProperties(set: Obj? = null, setOnce: Obj? = null) = core.setPersonProperties(set, setOnce)
    fun register(props: Obj) = core.register(props)
    fun registerOnce(props: Obj) = core.registerOnce(props)
    fun unregister(key: String) = core.unregister(key)
    fun setConsent(update: Map<String, Boolean>) = core.setConsent(update)
    fun isOptedOut() = core.isOptedOut
    fun getAnonymousId() = core.anonymousId
    val distinctId get() = core.distinctId

    /** Current session id; touching it extends the idle window, like iOS `sessionId`. */
    val sessionId: String get() = core.session.touch()
    fun debug(on: Boolean) {
        core.debug = on
    }

    fun deepLink(url: String, referrer: String? = null) = core.deepLink(url, referrer)

    /** Host-header helper for your own backend calls; see [TracingHeaders]. */
    val tracing get() = core.tracing
    fun group(type: String, key: String, properties: Obj? = null) = core.group(type, key, properties)

    fun reset() {
        core.reset()
        io.execute { reloadAll() }
    }

    fun optIn() {
        core.optIn()
        io.execute { reloadAll() }
    }

    fun optOut() {
        core.optOut()
        replay.clear()
    }

    /** Manual replay control: consent, sampling, the linked flag and screen lists still apply. */
    fun startReplay() = replay.start()
    fun stopReplay() = replay.stop()
    fun pauseReplay() = replay.pause()
    fun resumeReplay() = replay.resume()
    val isReplayActive get() = replay.isActive

    /**
     * Controlled exposure (P-L12): sends [value] RSA-encrypted with the project key as `$sensitive_capture`, only when [field]
     * is listed in the project's exposure fields, the key is present and analytics + replay consent is held. Only an
     * audited reveal on the server can read it; identical values are sent once per session. Encrypts on the io thread.
     */
    fun captureSensitive(field: String, value: String) = io.execute { replay.captureSensitive(field, value) }

    /** `$dead_swipe` check for hosts that walk the view tree (see [ReplayRecorder.deadSwipe]); runs on the io thread. */
    fun deadSwipe(startScreen: String, start: ViewNode, end: ViewNode, dx: Double, dy: Double) = io.execute { replay.deadSwipe(startScreen, start, end, dx, dy) }

    fun foregrounded() = lifecycle.foregrounded()

    fun backgrounded() {
        lifecycle.backgrounded()
        io.execute { replay.flush() }
    }

    fun flush() {
        core.flush()
        io.execute { replay.flush() }
    }
}
