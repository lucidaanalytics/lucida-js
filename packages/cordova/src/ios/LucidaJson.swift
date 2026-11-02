import Foundation
import Lucida

/// Cordova carries Foundation JSON (`[AnyHashable: Any]`); the Lucida SDK carries `JSONValue`. These two bridge them.
enum LucidaJson {
    static func props(_ any: Any?) -> Props {
        guard let dict = any as? [String: Any], !dict.isEmpty,
              let data = try? JSONSerialization.data(withJSONObject: dict),
              let props = try? JSONDecoder().decode(Props.self, from: data) else { return [:] }
        return props
    }

    /// Foundation object for a CDVPluginResult (`NSNull` for null).
    static func foundation(_ v: JSONValue?) -> Any {
        guard let v, let data = try? JSONEncoder().encode(v),
              let obj = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) else { return NSNull() }
        return obj
    }

    static func foundation(_ v: FlagValue?) -> Any {
        switch v {
        case .bool(let b)?: return b
        case .variant(let s)?: return s
        case nil: return NSNull()
        }
    }

    static func foundation(_ flags: [String: FlagValue]) -> [String: Any] { flags.mapValues { foundation($0) } }
}
