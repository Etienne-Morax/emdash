import Foundation

/// Why a gateway address is refused.
public enum GatewayAddressError: Error, Equatable, Sendable {
  case empty
  case invalid
  case notHTTPS
  /// Mobile access is published with `tailscale serve`: only tailnet names are accepted, so
  /// the app never talks to a gateway exposed on the public internet.
  case notTailnet
}

/// The Mobile access address of the Mac running Emdash, e.g.
/// `https://my-mac.tail1234.ts.net:8443/`.
public enum GatewayAddress {
  static let tailnetSuffix = ".ts.net"

  /// Accepts `my-mac.tail1234.ts.net:8443` with or without `https://` and a path; returns
  /// the origin with a trailing slash.
  public static func parse(_ input: String) -> Result<URL, GatewayAddressError> {
    let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return .failure(.empty) }
    let withScheme = trimmed.contains("://") ? trimmed : "https://\(trimmed)"
    guard let components = URLComponents(string: withScheme), let host = components.host,
      !host.isEmpty
    else { return .failure(.invalid) }
    guard components.scheme?.lowercased() == "https" else { return .failure(.notHTTPS) }
    guard host.lowercased().hasSuffix(tailnetSuffix) else { return .failure(.notTailnet) }
    guard components.user == nil, components.password == nil else { return .failure(.invalid) }
    var origin = URLComponents()
    origin.scheme = "https"
    origin.host = host.lowercased()
    origin.port = components.port
    origin.path = "/"
    guard let url = origin.url else { return .failure(.invalid) }
    return .success(url)
  }

  /// `https://host[:port]`, the `Origin` the gateway expects.
  public static func origin(of gateway: URL) -> String {
    var value = "https://\(gateway.host ?? "")"
    if let port = gateway.port { value += ":\(port)" }
    return value
  }

  /// The gateway's WebSocket endpoint.
  public static func wireURL(of gateway: URL) -> URL {
    var components = URLComponents(url: gateway, resolvingAgainstBaseURL: false)!
    components.scheme = "wss"
    components.path = "/wire"
    return components.url!
  }

  public static func message(for error: GatewayAddressError) -> String {
    switch error {
    case .empty: "Enter the address shown under Settings → Interface → Mobile access on your Mac."
    case .invalid: "That does not look like an address."
    case .notHTTPS: "Use the https:// address that tailscale serve publishes."
    case .notTailnet: "Use your Mac's tailnet name (it ends in .ts.net)."
    }
  }
}

/// What the desktop's pairing QR code carries: `moraxcode://pair?gateway=<url>&code=<code>`.
public struct PairingLink: Equatable, Sendable {
  public let gateway: URL
  public let code: String

  public init(gateway: URL, code: String) {
    self.gateway = gateway
    self.code = code
  }

  public static let scheme = "moraxcode"

  public static func parse(_ text: String) -> PairingLink? {
    guard let components = URLComponents(string: text.trimmingCharacters(in: .whitespaces)),
      components.scheme?.lowercased() == scheme, components.host == "pair",
      let items = components.queryItems,
      let rawGateway = items.first(where: { $0.name == "gateway" })?.value,
      let code = items.first(where: { $0.name == "code" })?.value.map(normalizeCode),
      !code.isEmpty,
      case .success(let gateway) = GatewayAddress.parse(rawGateway)
    else { return nil }
    return PairingLink(gateway: gateway, code: code)
  }

  /// Upper-cases and drops spaces and dashes, as people type codes.
  public static func normalizeCode(_ code: String) -> String {
    code.uppercased().filter { $0.isLetter || $0.isNumber }
  }
}

/// In-app links: `moraxcode://task/<projectId>/<taskId>` and `moraxcode://new`.
public enum AppLink: Equatable, Sendable {
  case task(projectId: String, taskId: String)
  case newTask

  public static func parse(_ url: URL) -> AppLink? {
    guard url.scheme?.lowercased() == PairingLink.scheme else { return nil }
    let parts = url.path.split(separator: "/").map { $0.removingPercentEncoding ?? String($0) }
    switch url.host {
    case "task" where parts.count == 2: return .task(projectId: parts[0], taskId: parts[1])
    case "new": return .newTask
    default: return nil
    }
  }
}
