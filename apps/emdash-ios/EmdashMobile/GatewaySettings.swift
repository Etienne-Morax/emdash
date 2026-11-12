import Foundation
import Observation

/// The saved gateway address. The device token itself never touches native code: it lives in
/// the web view's HttpOnly cookie, in the app's persistent website data store.
@MainActor
@Observable
final class GatewaySettings {
    private static let key = "gatewayURL"
    private let defaults: UserDefaults

    private(set) var gatewayURL: URL?

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        if let saved = defaults.string(forKey: Self.key),
           case let .success(url) = GatewayAddress.parse(saved)
        {
            gatewayURL = url
        }
    }

    func save(_ url: URL) {
        gatewayURL = url
        defaults.set(url.absoluteString, forKey: Self.key)
    }

    func forget() {
        gatewayURL = nil
        defaults.removeObject(forKey: Self.key)
    }
}
