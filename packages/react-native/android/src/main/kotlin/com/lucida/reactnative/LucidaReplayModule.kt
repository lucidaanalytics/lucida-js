package com.lucida.reactnative

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.UiThreadUtil
import com.lucida.android.KeystoreQueueCipher
import com.lucida.android.WireframeCapture

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

    /** Resolves the JSON text of one wireframe capture, or "" when there is no resumed Activity. */
    @ReactMethod
    fun captureWireframe(options: ReadableMap, promise: Promise) {
        val screen = if (options.hasKey("screen")) options.getString("screen") ?: "Unknown" else "Unknown"
        val maskText = if (options.hasKey("maskText")) options.getBoolean("maskText") else true
        fun flag(k: String) = if (options.hasKey(k)) options.getBoolean(k) else true
        val maskInputs = flag("maskAllTextInputs")
        val maskImages = flag("maskAllImages")
        val maskSandboxed = flag("maskSandboxedViews")
        val activity = currentActivity
        if (activity == null) {
            promise.resolve("")
            return
        }
        // View access must happen on the main thread.
        UiThreadUtil.runOnUiThread {
            promise.resolve(runCatching { WireframeCapture.capture(activity, screen, maskText, maskInputs, maskImages, maskSandboxed) }.getOrDefault(""))
        }
    }
}
