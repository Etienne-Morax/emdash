import Foundation
import MoraxWire
import Testing

@testable import MoraxCode

/// Answers like the desktop gateway: calls, attaches and snapshots succeed with empty data.
final class FakeGatewayTransport: WireTransport, @unchecked Sendable {
  private let lock = NSLock()
  private var inbox: [Data] = []
  private var waiters: [CheckedContinuation<Data, Error>] = []
  private var isClosed = false

  func send(_ frame: Data) async throws {
    let message = try WireFrameCodec.decode(frame)
    guard let id = message["id"] else { return }
    let value: JSONValue
    switch (message["kind"]?.stringValue, message["path"]?.stringValue) {
    case ("call", "mobile.session"):
      value = ["deviceId": "d1", "label": "Test", "desktopName": "Test Mac"]
    case ("call", "mobile.machines"): value = []
    case ("call", "mobile.appearance"): value = ["localMachineName": "Test Mac"]
    case ("snapshot", _): value = ["data": ["projects": []], "generation": 0, "sequence": 0]
    default: value = nil
    }
    deliver(WireFrameCodec.encode(["kind": "result", "id": id, "ok": true, "value": value]))
  }

  private func deliver(_ frame: Data) {
    lock.lock()
    if waiters.isEmpty {
      inbox.append(frame)
      lock.unlock()
    } else {
      let waiter = waiters.removeFirst()
      lock.unlock()
      waiter.resume(returning: frame)
    }
  }

  func receive() async throws -> Data {
    try await withCheckedThrowingContinuation { continuation in
      lock.lock()
      if isClosed {
        lock.unlock()
        continuation.resume(throwing: WireCallError.disconnected)
      } else if inbox.isEmpty {
        waiters.append(continuation)
        lock.unlock()
      } else {
        let frame = inbox.removeFirst()
        lock.unlock()
        continuation.resume(returning: frame)
      }
    }
  }

  func close() {
    lock.lock()
    isClosed = true
    let pending = waiters
    waiters.removeAll()
    lock.unlock()
    for waiter in pending { waiter.resume(throwing: WireCallError.disconnected) }
  }
}

final class TransportCounter: @unchecked Sendable {
  private let lock = NSLock()
  private var count = 0
  var value: Int { lock.withLock { count } }
  func make() -> WireTransport {
    lock.withLock { count += 1 }
    return FakeGatewayTransport()
  }
}

@MainActor
struct ConnectionTests {
  private static let pairing = Keychain.Pairing(
    gateway: URL(string: "https://mac.invalid:8443")!, token: "token")
  /// Longer than the first reconnect delay (1 s), so a reconnect loop would show.
  private static let settle: Duration = .milliseconds(2_500)

  @Test func replacingTheConnectionDoesNotStartAReconnectLoop() async throws {
    let counter = TransportCounter()
    let model = AppModel(pairing: Self.pairing) { _, _ in counter.make() }

    await model.boot()
    await model.connect()  // A second attempt, as when the app returns to the foreground.
    try await Task.sleep(for: Self.settle)

    #expect(model.phase == .online)
    #expect(counter.value == 2)
  }

  @Test func resumeDoesNotReconnectWhileOnline() async throws {
    let counter = TransportCounter()
    let model = AppModel(pairing: Self.pairing) { _, _ in counter.make() }

    await model.boot()
    await model.resume()
    try await Task.sleep(for: Self.settle)

    #expect(model.phase == .online)
    #expect(counter.value == 1)
  }
}
