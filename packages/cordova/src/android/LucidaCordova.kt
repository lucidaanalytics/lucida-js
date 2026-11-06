package com.lucida.cordova

import com.lucida.android.AndroidOptions
import com.lucida.android.LucidaAndroid
import com.lucida.android.ReplayConfig
import com.lucida.core.ConsentMode
import com.lucida.core.Lucida
import org.apache.cordova.CallbackContext
import org.apache.cordova.CordovaPlugin
import org.apache.cordova.PluginResult
import org.json.JSONArray
import org.json.JSONObject

/**
 * Cordova plugin `Lucida`. Contract: www/lucida.js. Delegates to the Lucida Android SDK (sdks/android);
 * not compiled in this repository's CI (needs a Cordova Android project).
 */
class LucidaCordova : CordovaPlugin() {
    private val client: Lucida get() = LucidaAndroid.client

    override fun execute(action: String, args: JSONArray, cb: CallbackContext): Boolean {
        // Flag reloads do blocking network I/O and init touches the Application: neither may run on the WebView thread.
        cordova.threadPool.execute {
            try {
                dispatch(action, args, cb)
            } catch (e: UninitializedPropertyAccessException) {
                cb.error("Lucida is not initialised: call init() first")
            } catch (e: Exception) {
                cb.error(e.message ?: e.javaClass.simpleName)
            }
        }
        return true
    }

    private fun dispatch(action: String, a: JSONArray, cb: CallbackContext) {
        when (action) {
            "setup" -> setup(a.getString(0), a.getJSONObject(1), cb)
            "capture" -> client.capture(a.getString(0), a.obj(1))
            "screen" -> client.screen(a.getString(0), a.obj(1))
            "identify" -> client.identify(a.getString(0), a.obj(1), a.obj(2))
            "alias" -> client.alias(a.getString(0))
            "group" -> client.group(a.getString(0), a.getString(1), a.obj(2))
            "register" -> client.register(a.obj(0))
            "registerOnce" -> client.registerOnce(a.obj(0))
            "unregister" -> client.unregister(a.getString(0))
            "reset" -> client.reset()
            "getDistinctId" -> return cb.success(client.distinctId)
            "getAnonymousId" -> return cb.success(client.getAnonymousId())
            "optIn" -> client.optIn()
            "optOut" -> client.optOut()
            "setConsent" -> client.setConsent(consent(a.getJSONObject(0)))
            "isOptedOut" -> return bool(cb, client.isOptedOut())
            "getFlag" -> return reply(cb, client.flags.get(a.getString(0)))
            "isFeatureEnabled" -> return bool(cb, client.flags.isEnabled(a.getString(0)))
            "getFlagPayload" -> return reply(cb, client.flags.payload(a.getString(0)))
            "reloadFlags" -> client.flags.reload()
            "onFlags" -> return onFlags(cb)
            "startReplay" -> client.startReplay()
            "stopReplay" -> client.stopReplay()
            "pauseReplay" -> client.pauseReplay()
            "resumeReplay" -> client.resumeReplay()
            "isReplayActive" -> return bool(cb, client.isReplayActive)
            "flush" -> client.flush()
            else -> return cb.error("unknown action $action")
        }
        cb.success()
    }

    private fun setup(apiKey: String, o: JSONObject, cb: CallbackContext) {
        val consent = o.optJSONObject("consent")
        val mode = if (consent?.optString("mode") == "opt_in") ConsentMode.OPT_IN else ConsentMode.OPT_OUT
        val opts = AndroidOptions(
            debug = o.optBoolean("debug", false),
            flushAt = o.optInt("flushAt", 20),
            flushIntervalMs = o.optLong("flushIntervalMs", 5000),
            maxQueueSize = o.optInt("maxQueueSize", 1000),
        )
        val replay = o.optJSONObject("replay")?.takeIf { it.optBoolean("enabled", false) }?.let(::replayConfig)
        LucidaAndroid.init(
            cordova.activity.application, apiKey, o.optString("apiHost", "https://capture.lucidace.com"), mode, replay, options = opts,
        )
        cb.success()
    }

    private fun replayConfig(r: JSONObject) = ReplayConfig(
        maskAllText = r.optBoolean("maskAllText", true),
        maskAllTextInputs = r.optBoolean("maskAllTextInputs", true),
        maskAllImages = r.optBoolean("maskAllImages", true),
        maskSandboxedViews = r.optBoolean("maskSandboxedViews", true),
        sampleRate = r.optDouble("sampleRate", 1.0),
        throttleMs = r.optLong("throttleMs", 0),
        captureTouches = r.optBoolean("captureTouches", true),
        minDurationMs = r.optLong("minDurationMs", 0),
        maskScreens = strings(r.optJSONArray("maskScreens")),
        maskTextPatterns = strings(r.optJSONArray("maskTextPatterns")),
    )

    private fun strings(a: JSONArray?): List<String> = if (a == null) emptyList() else List(a.length()) { a.getString(it) }

    private fun consent(o: JSONObject): Map<String, Boolean> =
        listOf("analytics", "replay", "marketing").filter { o.has(it) }.associateWith { o.getBoolean(it) }

    private fun bool(cb: CallbackContext, b: Boolean) = cb.sendPluginResult(PluginResult(PluginResult.Status.OK, b))

    /** Flag values and payloads: booleans, strings, numbers, objects, arrays; null when the flag is unknown. */
    private fun reply(cb: CallbackContext, v: Any?) {
        when (val js = toJs(v)) {
            is JSONObject -> cb.success(js)
            is JSONArray -> cb.success(js)
            is Boolean -> bool(cb, js)
            is Int -> cb.success(js)
            is String -> cb.success(js)
            is Number -> cb.sendPluginResult(PluginResult(PluginResult.Status.OK, js.toFloat()))
            else -> cb.success()
        }
    }

    /** Keeps the callback open: each flag refresh is one more success call. */
    private fun onFlags(cb: CallbackContext) {
        cb.sendPluginResult(PluginResult(PluginResult.Status.NO_RESULT).apply { keepCallback = true })
        client.flags.onFeatureFlags { flags ->
            cb.sendPluginResult(PluginResult(PluginResult.Status.OK, toJs(flags) as JSONObject).apply { keepCallback = true })
        }
    }
}
