package com.lucida.reactnative

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.UiThreadUtil
import com.lucida.android.KeystoreQueueCipher
import com.lucida.android.WireframeCapture
import com.lucida.core.ExposureKey
import com.lucida.core.SensitiveCapture

/**
 * React Native module `NativeModules.LucidaReplay`. Contract: see src/replay.ts (NativeReplayModule).
 * Not compiled in this repository's CI (needs the React Native toolchain); the logic it calls
 * (WireframeCapture -> ViewHierarchy -> ReplayBridge -> Wireframe, KeystoreQueueCipher) is covered by `make sdk-android`.
 */
class LucidaReplayModule(ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
    override fun getName() = "LucidaReplay"

    // Android Keystore AES-256-GCM key, created on first use; same ciphertext format as the Android SDK's queue cipher.
    private val cipher by lazy { KeystoreQueueCipher() }

    /** Blocking on purpose: the JS queue storage is synchronous (see src/native-cipher.ts). Fails closed with "". */
    @ReactMethod(isBlockingSynchronousMethod = true)
    fun encryptQueue(plain: String): String = runCatching { cipher.encrypt(plain) }.getOrDefault("")

    /** null when the value cannot be decrypted (key lost or rotated); the queue then starts empty. */
    @ReactMethod(isBlockingSynchronousMethod = true)
    fun decryptQueue(value: String): String? = runCatching { cipher.decrypt(value) }.getOrNull()

    /** Blocking synchronous (P-L12, src/sensitive.ts): RSA-OAEP with SHA-256 and MGF1-SHA-256 over (n, e); "" on failure. */
    @ReactMethod(isBlockingSynchronousMethod = true)
    fun encryptSensitive(pkcs1: String, n: String, e: String, plain: String): String =
        SensitiveCapture.encrypt(plain.toByteArray(Charsets.UTF_8), ExposureKey("", n, e, pkcs1)) ?: ""

    /**
     * Install attribution (src/install.ts): resolves `{platform: "android", referrer, clickTs, beginTs}` from the Play Install
     * Referrer, or null when the library is absent or the service is unavailable. Needs `com.android.installreferrer:installreferrer`.
     */
    @ReactMethod
    fun installInfo(promise: Promise) {
        try {
            val client = com.android.installreferrer.api.InstallReferrerClient.newBuilder(reactApplicationContext).build()
            client.startConnection(object : com.android.installreferrer.api.InstallReferrerStateListener {
                override fun onInstallReferrerSetupFinished(code: Int) {
                    try {
                        val m = Arguments.createMap()
                        m.putString("platform", "android")
                        if (code == com.android.installreferrer.api.InstallReferrerClient.InstallReferrerResponse.OK) {
                            val r = client.installReferrer
                            m.putString("referrer", r.installReferrer)
                            m.putDouble("clickTs", r.referrerClickTimestampSeconds.toDouble())
                            m.putDouble("beginTs", r.installBeginTimestampSeconds.toDouble())
                        }
                        promise.resolve(m)
                    } catch (_: Throwable) {
                        promise.resolve(null)
                    }
                    try { client.endConnection() } catch (_: Throwable) {}
                }

                override fun onInstallReferrerServiceDisconnected() = Unit
            })
        } catch (_: Throwable) { // includes NoClassDefFoundError
            promise.resolve(null)
        }
    }

    /** Resolves the JSON text of one wireframe (or masked screenshot) capture, or "" when there is no resumed Activity. */
    @ReactMethod
    fun captureWireframe(options: ReadableMap, promise: Promise) {
        val screen = if (options.hasKey("screen")) options.getString("screen") ?: "Unknown" else "Unknown"
        val maskText = if (options.hasKey("maskText")) options.getBoolean("maskText") else true
        fun flag(k: String) = if (options.hasKey(k)) options.getBoolean(k) else true
        val maskInputs = flag("maskAllTextInputs")
        val maskImages = flag("maskAllImages")
        val maskSandboxed = flag("maskSandboxedViews")
        // Screenshot mode: JPEG quality 0..100; masks are painted on the bitmap before it is encoded (ScreenshotCapture).
        val shots = options.hasKey("mode") && options.getString("mode") == "screenshot"
        val quality = if (!shots) null else Math.round(100 * (if (options.hasKey("screenshotQuality")) options.getDouble("screenshotQuality") else 0.4)).toInt()
        val maskScreen = options.hasKey("maskScreen") && options.getBoolean("maskScreen")  // P-M17
        val patterns = if (options.hasKey("maskTextPatterns")) options.getArray("maskTextPatterns")?.toArrayList()?.filterIsInstance<String>() ?: emptyList() else emptyList()  // P-M46
        val activity = currentActivity
        if (activity == null) {
            promise.resolve("")
            return
        }
        // View access must happen on the main thread.
        UiThreadUtil.runOnUiThread {
            promise.resolve(runCatching { WireframeCapture.capture(activity, screen, maskText, maskInputs, maskImages, maskSandboxed, quality, maskScreen, patterns) }.getOrDefault(""))
        }
    }
}
