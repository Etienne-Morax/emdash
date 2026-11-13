import Foundation

/// A byte transport carrying one Wire frame per message (the gateway's WebSocket).
public protocol WireTransport: Sendable {
  func send(_ frame: Data) async throws
  /// The next incoming frame; throws when the transport closes.
  func receive() async throws -> Data
  func close()
}

/// A failed call or subscription, as the peer reported it (`WireErrorCode`) or locally.
public struct WireCallError: Error, Equatable, Sendable, LocalizedError {
  public let code: String
  public let message: String

  public init(code: String, message: String) {
    self.code = code
    self.message = message
  }

  public static let disconnected = WireCallError(code: "DISCONNECTED", message: "Disconnected")
  public static let timeout = WireCallError(code: "TIMEOUT", message: "The Mac did not answer in time.")
  public var errorDescription: String? { message }
}

/// `refId|stableJSON(key)`, as `packages/wire/src/api/topics.ts` encodes topics.
public enum WireTopic {
  public static func encode(_ refId: String, key: JSONValue?) -> String {
    guard let key else { return refId }
    return "\(refId)|\(key.serialized(sortedKeys: true))"
  }
}

/// Client side of the Wire RPC protocol (`packages/wire/src/api/protocol.ts`): calls,
/// snapshots and topic subscriptions over one transport. Reconnection is the owner's job:
/// a closed connection fails pending calls and reports `onClose` once.
public actor WireConnection {
  public typealias UpdateHandler = @Sendable (JSONValue) -> Void
  public typealias GapHandler = @Sendable () -> Void

  private struct Subscriber {
    let onUpdate: UpdateHandler
    let onGap: GapHandler
  }

  private let transport: WireTransport
  private var pending: [String: CheckedContinuation<JSONValue, Error>] = [:]
  private var timers: [String: Task<Void, Never>] = [:]
  private let requestTimeout: Duration
  private var subscribers: [String: [UUID: Subscriber]] = [:]
  private var closed = false
  private var reader: Task<Void, Never>?
  private let onClose: @Sendable () -> Void

  /// Long enough for slow git operations on the Mac; a lost reply must not hang a screen forever.
  public static let defaultRequestTimeout: Duration = .seconds(60)

  public init(
    transport: WireTransport, requestTimeout: Duration = defaultRequestTimeout,
    onClose: @escaping @Sendable () -> Void = {}
  ) {
    self.transport = transport
    self.requestTimeout = requestTimeout
    self.onClose = onClose
  }

  public func start() {
    guard reader == nil else { return }
    reader = Task { [weak self] in
      guard let self else { return }
      await self.readLoop()
    }
  }

  public var isClosed: Bool { closed }

  public func close() {
    transport.close()
    finish()
  }

  // MARK: Requests

  public func call(_ path: String, _ input: JSONValue = .null) async throws -> JSONValue {
    var message: [String: JSONValue] = ["kind": "call", "id": .string(Self.newId()), "path": .string(path)]
    if input != .null { message["input"] = input }
    return try await request(message)
  }

  /// Calls a procedure whose output is a `Result` (`{ success, data | error }`), returning
  /// `data` or throwing the error's message.
  public func callResult(_ path: String, _ input: JSONValue = .null) async throws -> JSONValue {
    let output = try await call(path, input)
    if output["success"]?.boolValue == false {
      let error = output["error"]
      let message =
        error?["message"]?.stringValue ?? error?["type"]?.stringValue ?? "The request failed."
      throw WireCallError(code: "RESULT_ERROR", message: message)
    }
    return output["data"] ?? .null
  }

  public func snapshot(_ topic: String) async throws -> JSONValue {
    try await request(["kind": "snapshot", "id": .string(Self.newId()), "topic": .string(topic)])
  }

  /// Subscribes to a topic. The first subscriber attaches; the last `detach` releases it.
  public func attach(
    _ topic: String, onUpdate: @escaping UpdateHandler, onGap: @escaping GapHandler = {}
  ) async throws -> UUID {
    let token = UUID()
    let first = subscribers[topic, default: [:]].isEmpty
    subscribers[topic, default: [:]][token] = Subscriber(onUpdate: onUpdate, onGap: onGap)
    if first {
      do {
        _ = try await request(["kind": "attach", "id": .string(Self.newId()), "topic": .string(topic)])
      } catch {
        subscribers[topic]?.removeValue(forKey: token)
        throw error
      }
    }
    return token
  }

  public func detach(_ topic: String, token: UUID) async {
    subscribers[topic]?.removeValue(forKey: token)
    guard subscribers[topic]?.isEmpty == true else { return }
    subscribers.removeValue(forKey: topic)
    try? await send(["kind": "detach", "topic": .string(topic)])
  }

  // MARK: Internals

  /// Sends one request and waits for its result. Fails with `timeout` when no reply comes in
  /// time, and with `CancellationError` when the calling task is cancelled.
  private func request(_ message: [String: JSONValue]) async throws -> JSONValue {
    guard !closed else { throw WireCallError.disconnected }
    let id = message["id"]!.stringValue!
    let timeout = requestTimeout
    return try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { continuation in
        pending[id] = continuation
        // Cancelled before the handler could see the pending id: fail now.
        if Task.isCancelled {
          fail(id: id, error: CancellationError())
          return
        }
        timers[id] = Task { [weak self] in
          try? await Task.sleep(for: timeout)
          guard !Task.isCancelled else { return }
          await self?.fail(id: id, error: WireCallError.timeout)
        }
        Task { [weak self] in
          do {
            try await self?.send(message)
          } catch {
            await self?.fail(id: id, error: error)
          }
        }
      }
    } onCancel: {
      Task { [weak self] in await self?.fail(id: id, error: CancellationError()) }
    }
  }

  /// Removes a pending request and its timer; nil when it was already resolved.
  private func takePending(_ id: String) -> CheckedContinuation<JSONValue, Error>? {
    timers.removeValue(forKey: id)?.cancel()
    return pending.removeValue(forKey: id)
  }

  private func send(_ message: [String: JSONValue]) async throws {
    try await transport.send(WireFrameCodec.encode(.object(message)))
  }

  private func fail(id: String, error: Error) {
    takePending(id)?.resume(throwing: error)
  }

  private func readLoop() async {
    while !closed {
      do {
        let frame = try await transport.receive()
        handle(try WireFrameCodec.decode(frame))
      } catch {
        finish()
        return
      }
    }
  }

  /// Routes one incoming message. Internal so tests can replay recorded sessions.
  func handle(_ message: JSONValue) {
    switch message["kind"]?.stringValue {
    case "result":
      guard let id = message["id"]?.stringValue,
        let continuation = takePending(id)
      else { return }
      if message["ok"]?.boolValue == true {
        continuation.resume(returning: message["value"] ?? .null)
      } else {
        continuation.resume(
          throwing: WireCallError(
            code: message["code"]?.stringValue ?? "HANDLER_ERROR",
            message: message["message"]?.stringValue ?? "The request failed."))
      }
    case "update":
      guard let topic = message["topic"]?.stringValue, let update = message["update"] else { return }
      for subscriber in subscribers[topic, default: [:]].values { subscriber.onUpdate(update) }
    case "topic-gap", "topic-error":
      guard let topic = message["topic"]?.stringValue else { return }
      for subscriber in subscribers[topic, default: [:]].values { subscriber.onGap() }
    default:
      return
    }
  }

  private func finish() {
    guard !closed else { return }
    closed = true
    reader?.cancel()
    for continuation in pending.values { continuation.resume(throwing: WireCallError.disconnected) }
    pending.removeAll()
    for timer in timers.values { timer.cancel() }
    timers.removeAll()
    subscribers.removeAll()
    onClose()
  }

  private static func newId() -> String { UUID().uuidString.lowercased() }
}
