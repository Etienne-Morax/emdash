import Foundation

/// Why an address typed on the setup screen is refused.
enum GatewayAddressError: Error, Equatable {
    case empty
    case invalid
    case notHTTPS
    /// Mobile access is published with `tailscale serve`: only tailnet names are accepted, so
    /// the app never talks to a gateway exposed on the public internet.
    case notTailnet
}

/// The Mobile access address of the Mac running Emdash, e.g.
/// `https://my-mac.tail1234.ts.net:8443/`.
enum GatewayAddress {
    static let tailnetSuffix = ".ts.net"

    /// Accepts `my-mac.tail1234.ts.net:8443` with or without `https://` and a path; returns
    /// the origin with a trailing slash.
    static func parse(_ input: String) -> Result<URL, GatewayAddressError> {
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

    /// True when `url` belongs to the gateway (same scheme, host and port).
    static func isSameOrigin(_ url: URL, as gateway: URL) -> Bool {
        url.scheme?.lowercased() == gateway.scheme?.lowercased()
            && url.host?.lowercased() == gateway.host?.lowercased()
            && (url.port ?? 443) == (gateway.port ?? 443)
    }

    static func message(for error: GatewayAddressError) -> String {
        switch error {
        case .empty:
            "Enter the address shown under Settings → Interface → Mobile access on your Mac."
        case .invalid:
            "That does not look like an address."
        case .notHTTPS:
            "Use the https:// address that tailscale serve publishes."
        case .notTailnet:
            "Use your Mac's tailnet name (it ends in .ts.net)."
        }
    }
}
