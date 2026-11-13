import Foundation
import Security

/// The paired Mac's address and device token, in the Keychain (this device only, after
/// first unlock so a reconnect works when the phone wakes).
enum Keychain {
  private static let service = "com.morax.moraxcode.gateway"

  struct Pairing: Codable, Equatable {
    let gateway: URL
    let token: String
  }

  static func load() -> Pairing? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
      let data = item as? Data
    else { return nil }
    return try? JSONDecoder().decode(Pairing.self, from: data)
  }

  static func save(_ pairing: Pairing) {
    clear()
    guard let data = try? JSONEncoder().encode(pairing) else { return }
    let item: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
      kSecValueData as String: data,
    ]
    SecItemAdd(item as CFDictionary, nil)
  }

  static func clear() {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
    ]
    SecItemDelete(query as CFDictionary)
  }
}
