import Foundation
import Lucida  // the Lucida iOS SDK (sdks/ios): ReplayBridge encodes the UIKit hierarchy

/// React Native module `NativeModules.LucidaReplay`. Contract: see src/replay.ts (NativeReplayModule).
/// Not compiled in this repository's CI (needs the React Native toolchain); the logic it calls
/// (ReplayBridge, RRWebWireframe, UIKitViewHierarchy) is covered by `swift test` in sdks/ios.
@objc(LucidaReplay)
final class LucidaReplay: NSObject {
    @objc static func requiresMainQueueSetup() -> Bool { false }

    // Keychain-held AES-256-GCM key (generated on first use); same ciphertext format as the iOS SDK's queue cipher.
    private let cipher = KeychainQueueCipher()

    /// Blocking synchronous (see src/native-cipher.ts). Fails closed with "".
    @objc(encryptQueue:)
    func encryptQueue(_ plain: String) -> String { cipher.encrypt(plain) }

    /// nil when the value cannot be decrypted (key lost or rotated); the queue then starts empty.
    @objc(decryptQueue:)
    func decryptQueue(_ value: String) -> String? { cipher.decrypt(value) }

    /// Resolves the JSON text of one wireframe (or masked screenshot) capture, or "" when there is no key window.
    @objc(captureWireframe:resolver:rejecter:)
    func captureWireframe(_ options: NSDictionary, resolver resolve: @escaping (Any?) -> Void, rejecter reject: @escaping (String?, String?, Error?) -> Void) {
        let screen = (options["screen"] as? String) ?? "Unknown"
        let maskText = (options["maskText"] as? Bool) ?? true
        let maskInputs = (options["maskAllTextInputs"] as? Bool) ?? true
        let maskImages = (options["maskAllImages"] as? Bool) ?? true
        let maskSandboxed = (options["maskSandboxedViews"] as? Bool) ?? true
        // Screenshot mode: UIKitScreenshot paints the mask plan over the drawn window before JPEG encoding.
        let quality: Double? = (options["mode"] as? String) == "screenshot" ? ((options["screenshotQuality"] as? Double) ?? 0.4) : nil
        // UIKitViewHierarchy hops to the main thread itself; this runs off it so the JS bridge never blocks.
        DispatchQueue.global(qos: .utility).async {
            resolve(ReplayBridge.capture(screen: screen, maskText: maskText, maskAllTextInputs: maskInputs, maskAllImages: maskImages, maskSandboxedViews: maskSandboxed, screenshotQuality: quality) ?? "")
        }
    }
}
