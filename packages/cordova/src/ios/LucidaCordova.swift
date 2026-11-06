import Foundation
import Lucida  // the Lucida iOS SDK (sdks/ios)

/// Cordova plugin `Lucida`. Contract: www/lucida.js. Delegates to `LucidaClient`; not compiled in this repository's CI
/// (needs a Cordova iOS project).
@objc(LucidaCordova)
final class LucidaCordova: CDVPlugin {
    private var client: LucidaClient?

    // Native action is "setup": a selector named init: would clash with NSObject init-family rules.
    @objc(setup:) func setup(_ c: CDVInvokedUrlCommand) {
        guard let key = c.argument(at: 0) as? String else { return fail(c, "apiKey must be a string") }
        let o = (c.argument(at: 1) as? [String: Any]) ?? [:]
        let host = (o["apiHost"] as? String).flatMap(URL.init(string:)) ?? URL(string: "https://capture.lucidace.com")!
        var cfg = LucidaConfig(apiKey: key, apiHost: host)
        let consent = o["consent"] as? [String: Any]
        cfg.consentMode = (consent?["mode"] as? String) == "opt_in" ? .optIn : .optOut
        cfg.queueBeforeConsent = (consent?["queueBeforeConsent"] as? Bool) ?? false
        cfg.debug = (o["debug"] as? Bool) ?? false
        if let v = o["flushAt"] as? Int { cfg.flushAt = v }
        if let v = o["flushIntervalMs"] as? Double { cfg.flushInterval = v / 1000 }
        if let v = o["maxQueueSize"] as? Int { cfg.maxQueueSize = v }
        if let v = o["appVersion"] as? String { cfg.appVersion = v }
        if let r = o["replay"] as? [String: Any], (r["enabled"] as? Bool) == true {
            cfg.replay.enabled = true
            cfg.replay.maskText = (r["maskAllText"] as? Bool) ?? true
            cfg.replay.maskAllTextInputs = (r["maskAllTextInputs"] as? Bool) ?? true
            cfg.replay.maskAllImages = (r["maskAllImages"] as? Bool) ?? true
            cfg.replay.maskSandboxedViews = (r["maskSandboxedViews"] as? Bool) ?? true
            cfg.replay.sampleRate = (r["sampleRate"] as? Double) ?? 1.0
            cfg.replay.captureTouches = (r["captureTouches"] as? Bool) ?? true
            if let v = r["throttleMs"] as? Double { cfg.replay.throttleDelay = v / 1000 }
        }
        client = LucidaClient(config: cfg)
        ok(c)
    }

    @objc(capture:) func capture(_ c: CDVInvokedUrlCommand) {
        with(c) { $0.capture(str(c, 0), LucidaJson.props(c.argument(at: 1))) }
    }

    @objc(screen:) func screen(_ c: CDVInvokedUrlCommand) {
        with(c) { $0.screen(str(c, 0), LucidaJson.props(c.argument(at: 1))) }
    }

    @objc(identify:) func identify(_ c: CDVInvokedUrlCommand) {
        with(c) { $0.identify(str(c, 0), set: LucidaJson.props(c.argument(at: 1)), setOnce: LucidaJson.props(c.argument(at: 2))) }
    }

    @objc(alias:) func alias(_ c: CDVInvokedUrlCommand) { with(c) { $0.alias(str(c, 0)) } }

    @objc(group:) func group(_ c: CDVInvokedUrlCommand) {
        with(c) { $0.group(str(c, 0), str(c, 1), properties: LucidaJson.props(c.argument(at: 2))) }
    }

    @objc(register:) func register(_ c: CDVInvokedUrlCommand) { with(c) { $0.register(LucidaJson.props(c.argument(at: 0))) } }
    @objc(registerOnce:) func registerOnce(_ c: CDVInvokedUrlCommand) { with(c) { $0.registerOnce(LucidaJson.props(c.argument(at: 0))) } }
    @objc(unregister:) func unregister(_ c: CDVInvokedUrlCommand) { with(c) { $0.unregister(str(c, 0)) } }
    @objc(reset:) func reset(_ c: CDVInvokedUrlCommand) { with(c) { $0.reset() } }

    @objc(getDistinctId:) func getDistinctId(_ c: CDVInvokedUrlCommand) { read(c) { $0.distinctId } }
    @objc(getAnonymousId:) func getAnonymousId(_ c: CDVInvokedUrlCommand) { read(c) { $0.anonymousId } }

    @objc(optIn:) func optIn(_ c: CDVInvokedUrlCommand) { with(c) { $0.optIn() } }
    @objc(optOut:) func optOut(_ c: CDVInvokedUrlCommand) { with(c) { $0.optOut() } }
    @objc(setConsent:) func setConsent(_ c: CDVInvokedUrlCommand) {
        let u = (c.argument(at: 0) as? [String: Any]) ?? [:]
        with(c) { $0.setConsent(analytics: u["analytics"] as? Bool, replay: u["replay"] as? Bool, marketing: u["marketing"] as? Bool) }
    }
    @objc(isOptedOut:) func isOptedOut(_ c: CDVInvokedUrlCommand) { read(c) { $0.isOptedOut } }

    @objc(getFlag:) func getFlag(_ c: CDVInvokedUrlCommand) { read(c) { LucidaJson.foundation($0.flag(self.str(c, 0))) } }
    @objc(isFeatureEnabled:) func isFeatureEnabled(_ c: CDVInvokedUrlCommand) { read(c) { $0.isFeatureEnabled(self.str(c, 0)) } }
    @objc(getFlagPayload:) func getFlagPayload(_ c: CDVInvokedUrlCommand) { read(c) { LucidaJson.foundation($0.flagPayload(self.str(c, 0))) } }

    @objc(reloadFlags:) func reloadFlags(_ c: CDVInvokedUrlCommand) {
        guard let client else { return notInitialised(c) }
        Task { await client.reloadFlags(); self.ok(c) }
    }

    /// Keeps the callback open: each flag refresh is one more success call.
    @objc(onFlags:) func onFlags(_ c: CDVInvokedUrlCommand) {
        guard let client else { return notInitialised(c) }
        client.onFlags { [weak self] flags in
            let r = CDVPluginResult(status: CDVCommandStatus_OK, messageAs: LucidaJson.foundation(flags))
            r?.setKeepCallbackAs(true)
            self?.commandDelegate.send(r, callbackId: c.callbackId)
        }
    }

    @objc(startReplay:) func startReplay(_ c: CDVInvokedUrlCommand) { with(c) { $0.startReplay() } }
    @objc(stopReplay:) func stopReplay(_ c: CDVInvokedUrlCommand) { with(c) { $0.stopReplay() } }
    @objc(pauseReplay:) func pauseReplay(_ c: CDVInvokedUrlCommand) { with(c) { $0.pauseReplay() } }
    @objc(resumeReplay:) func resumeReplay(_ c: CDVInvokedUrlCommand) { with(c) { $0.resumeReplay() } }
    @objc(isReplayActive:) func isReplayActive(_ c: CDVInvokedUrlCommand) { read(c) { $0.isReplayActive } }

    @objc(flush:) func flush(_ c: CDVInvokedUrlCommand) {
        guard let client else { return notInitialised(c) }
        Task { await client.flush(); self.ok(c) }
    }

    // MARK: helpers

    private func str(_ c: CDVInvokedUrlCommand, _ i: Int) -> String { (c.argument(at: i) as? String) ?? "" }

    private func with(_ c: CDVInvokedUrlCommand, _ body: (LucidaClient) -> Void) {
        guard let client else { return notInitialised(c) }
        body(client)
        ok(c)
    }

    private func read(_ c: CDVInvokedUrlCommand, _ body: (LucidaClient) -> Any) {
        guard let client else { return notInitialised(c) }
        commandDelegate.send(CDVPluginResult(status: CDVCommandStatus_OK, messageAs: body(client)), callbackId: c.callbackId)
    }

    private func ok(_ c: CDVInvokedUrlCommand) {
        commandDelegate.send(CDVPluginResult(status: CDVCommandStatus_OK), callbackId: c.callbackId)
    }

    private func fail(_ c: CDVInvokedUrlCommand, _ msg: String) {
        commandDelegate.send(CDVPluginResult(status: CDVCommandStatus_ERROR, messageAs: msg), callbackId: c.callbackId)
    }

    private func notInitialised(_ c: CDVInvokedUrlCommand) { fail(c, "Lucida is not initialised: call init() first") }
}
