package com.lucida.core

/**
 * Bridge for hosts that own session, consent and transport themselves (the React Native SDK): one wireframe
 * capture of an already-converted view tree, as the JSON `{"width","height","events":[meta, fullSnapshot]}` the
 * JS side ships to POST /v1/replay. Uses the same [Wireframe] encoder as [ReplayRecorder], so masking rules
 * (input values always starred, blocked views empty) are identical.
 */
object ReplayBridge {
    fun capture(root: ViewNode, screen: String, width: Int, height: Int, ts: Long): String =
        Json.encode(mapOf("width" to width, "height" to height, "events" to Wireframe.snapshot(root, screen, width, height, ts).events))

    /** Screenshot mode: the same shape, the full snapshot holding the already-masked JPEG (see [Wireframe.screenshotSnapshot]). */
    fun screenshot(frame: ScreenshotFrame, screen: String, ts: Long): String =
        Json.encode(mapOf("width" to frame.width, "height" to frame.height, "events" to Wireframe.screenshotSnapshot(frame.jpegBase64, screen, frame.width, frame.height, ts).events))
}
