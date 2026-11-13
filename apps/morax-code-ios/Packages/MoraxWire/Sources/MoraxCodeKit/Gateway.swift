import Foundation
import MoraxWire

/// How the gateway answered a pairing or session check.
public enum GatewayError: Error, Equatable, Sendable, LocalizedError {
  /// 401: wrong or expired code, revoked device, or not this tailnet user.
  case refused
  case rateLimited
  case unreachable
  case unexpected(Int)

  public var errorDescription: String? {
    switch self {
    case .refused: "The Mac refused. Check the code, or pair again from Settings → Mobile access."
    case .rateLimited: "Too many attempts. Wait a minute, then try again."
    case .unreachable: "The Mac is out of reach. Is it awake with Emdash open, and Tailscale on?"
    case .unexpected(let status): "The Mac answered with an unexpected error (\(status))."
    }
  }
}

/// HTTP side of the gateway (`mobile-http-server.ts`): pairing and session checks. The
/// device token comes back in an `HttpOnly` cookie; the app keeps it in the Keychain and
/// sends it as a bearer token.
public struct GatewayHTTP: Sendable {
  public let gateway: URL
  let session: URLSession

  public init(gateway: URL, session: URLSession = .shared) {
    self.gateway = gateway
    self.session = session
  }

  static let tokenCookie = "emdash_mobile_token"

  public func pair(code: String, label: String) async throws -> String {
    let body = try JSONEncoder().encode(["code": code, "label": label])
    let (data, response) = try await post("api/pair", body: body, token: nil)
    _ = data
    try check(response)
    guard let token = Self.token(from: response) else { throw GatewayError.unexpected(200) }
    return token
  }

  /// Confirms the token is still valid.
  public func checkSession(token: String) async throws {
    let (_, response) = try await post("api/session", body: Data("{}".utf8), token: token)
    try check(response)
  }

  public func logout(token: String) async {
    _ = try? await post("api/logout", body: Data("{}".utf8), token: token)
  }

  /// The request headers the gateway requires besides `Tailscale-User-Login` (added by
  /// `tailscale serve`): the expected `Origin` and the device token.
  public static func headers(gateway: URL, token: String?) -> [String: String] {
    var headers = ["Origin": GatewayAddress.origin(of: gateway)]
    if let token { headers["Authorization"] = "Bearer \(token)" }
    return headers
  }

  static func token(from response: HTTPURLResponse) -> String? {
    let header = response.value(forHTTPHeaderField: "Set-Cookie") ?? ""
    for part in header.split(separator: ";") {
      let pair = part.trimmingCharacters(in: .whitespaces).split(separator: "=", maxSplits: 1)
      if pair.count == 2, pair[0] == Substring(tokenCookie) { return String(pair[1]) }
    }
    return nil
  }

  private func post(_ path: String, body: Data, token: String?) async throws -> (
    Data, HTTPURLResponse
  ) {
    var request = URLRequest(url: gateway.appendingPathComponent(path))
    request.httpMethod = "POST"
    request.httpBody = body
    request.httpShouldHandleCookies = false
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    for (name, value) in Self.headers(gateway: gateway, token: token) {
      request.setValue(value, forHTTPHeaderField: name)
    }
    do {
      let (data, response) = try await session.data(for: request)
      guard let http = response as? HTTPURLResponse else { throw GatewayError.unreachable }
      return (data, http)
    } catch let error as GatewayError {
      throw error
    } catch {
      throw GatewayError.unreachable
    }
  }

  private func check(_ response: HTTPURLResponse) throws {
    switch response.statusCode {
    case 200: return
    case 401: throw GatewayError.refused
    case 429: throw GatewayError.rateLimited
    default: throw GatewayError.unexpected(response.statusCode)
    }
  }
}

/// The gateway's `/wire` WebSocket as a Wire transport: one binary frame per message.
public final class WebSocketTransport: WireTransport, @unchecked Sendable {
  private let task: URLSessionWebSocketTask

  public init(gateway: URL, token: String, session: URLSession = .shared) {
    var request = URLRequest(url: GatewayAddress.wireURL(of: gateway))
    request.httpShouldHandleCookies = false
    for (name, value) in GatewayHTTP.headers(gateway: gateway, token: token) {
      request.setValue(value, forHTTPHeaderField: name)
    }
    task = session.webSocketTask(with: request)
    task.maximumMessageSize = WireFrameCodec.maxFrameBytes + 16
    task.resume()
  }

  public func send(_ frame: Data) async throws {
    try await task.send(.data(frame))
  }

  public func receive() async throws -> Data {
    while true {
      switch try await task.receive() {
      case .data(let data): return data
      case .string: continue  // The gateway never sends text; ignore rather than fail.
      @unknown default: continue
      }
    }
  }

  public func close() {
    task.cancel(with: .normalClosure, reason: nil)
  }
}
