import Foundation

/// Follows one live state topic: snapshot, then ordered Immer patches. A missed sequence, a
/// new generation or a failed patch triggers a fresh snapshot, as the TypeScript followers do.
public actor LiveStateFollower {
  private let connection: WireConnection
  private let topic: String
  private let onValue: @Sendable (JSONValue) -> Void
  private var state: JSONValue?
  private var generation: Double = -1
  private var sequence: Double = -1
  private var buffered: [JSONValue] = []
  private var seeding = false
  private var token: UUID?

  public init(
    connection: WireConnection, topic: String, onValue: @escaping @Sendable (JSONValue) -> Void
  ) {
    self.connection = connection
    self.topic = topic
    self.onValue = onValue
  }

  public func start() async throws {
    token = try await connection.attach(
      topic,
      onUpdate: { [weak self] update in Task { await self?.receive(update) } },
      onGap: { [weak self] in Task { try? await self?.resync() } })
    try await resync()
  }

  public func stop() async {
    guard let token else { return }
    self.token = nil
    await connection.detach(topic, token: token)
  }

  func resync() async throws {
    seeding = true
    defer { seeding = false }
    let snapshot = try await connection.snapshot(topic)
    state = snapshot["data"] ?? .null
    generation = snapshot["generation"]?.numberValue ?? 0
    sequence = snapshot["sequence"]?.numberValue ?? 0
    let pendingUpdates = buffered
    buffered.removeAll()
    for update in pendingUpdates where (update["sequence"]?.numberValue ?? 0) > sequence {
      apply(update)
    }
    if let state { onValue(state) }
  }

  func receive(_ update: JSONValue) async {
    if seeding || state == nil {
      buffered.append(update)
      return
    }
    if apply(update), let state { onValue(state) }
  }

  /// Applies one update; on a gap or a failed patch, resyncs from a snapshot.
  @discardableResult
  private func apply(_ update: JSONValue) -> Bool {
    guard let current = state,
      update["generation"]?.numberValue == generation,
      update["baseSequence"]?.numberValue == sequence,
      let delta = update["delta"],
      let next = try? ImmerPatch.apply(delta, to: current)
    else {
      Task { try? await resync() }
      return false
    }
    state = next
    sequence = update["sequence"]?.numberValue ?? sequence + 1
    return true
  }
}

/// Follows a live log (agent terminal output): the retained tail, then appended chunks.
/// `onReset` delivers the full retained text (initially and after a gap).
public actor LiveLogFollower {
  private let connection: WireConnection
  private let topic: String
  private let onReset: @Sendable (String) -> Void
  private let onChunk: @Sendable (String) -> Void
  private var sequence: Double = -1
  private var generation: Double = -1
  private var seeded = false
  private var token: UUID?

  public init(
    connection: WireConnection, topic: String,
    onReset: @escaping @Sendable (String) -> Void,
    onChunk: @escaping @Sendable (String) -> Void
  ) {
    self.connection = connection
    self.topic = topic
    self.onReset = onReset
    self.onChunk = onChunk
  }

  public func start() async throws {
    token = try await connection.attach(
      topic,
      onUpdate: { [weak self] update in Task { await self?.receive(update) } },
      onGap: { [weak self] in Task { try? await self?.resync() } })
    try await resync()
  }

  public func stop() async {
    guard let token else { return }
    self.token = nil
    await connection.detach(topic, token: token)
  }

  func resync() async throws {
    seeded = false
    let snapshot = try await connection.snapshot(topic)
    generation = snapshot["generation"]?.numberValue ?? 0
    sequence = snapshot["sequence"]?.numberValue ?? 0
    seeded = true
    onReset(snapshot["data"]?["text"]?.stringValue ?? "")
  }

  func receive(_ update: JSONValue) async {
    guard seeded else { return }
    guard update["generation"]?.numberValue == generation,
      update["baseSequence"]?.numberValue == sequence,
      let chunk = update["delta"]?["chunk"]?.stringValue
    else {
      // Older than the snapshot: already in the retained text.
      if let next = update["sequence"]?.numberValue, next <= sequence { return }
      Task { try? await resync() }
      return
    }
    sequence = update["sequence"]?.numberValue ?? sequence + 1
    onChunk(chunk)
  }
}

extension WireConnection {
  /// Subscribes to an event stream; `onEvent` receives each `delta.event`.
  public func subscribeEvents(
    _ topic: String, onEvent: @escaping @Sendable (JSONValue) -> Void,
    onGap: @escaping @Sendable () -> Void = {}
  ) async throws -> UUID {
    try await attach(
      topic,
      onUpdate: { update in
        if let event = update["delta"]?["event"] { onEvent(event) }
      }, onGap: onGap)
  }

  /// Runs a live job (`<path>.start`, then its state topic) to completion. Returns the job's
  /// `result`, or throws its error message.
  public func runJob(path: String, topicId: String, input: JSONValue) async throws -> JSONValue {
    let started = try await call("\(path).start", input)
    guard let jobId = started["jobId"]?.stringValue else {
      throw WireCallError(code: "HANDLER_ERROR", message: "The job did not start.")
    }
    let topic = WireTopic.encode(topicId, key: ["jobId": .string(jobId)])
    let stream = AsyncStream<JSONValue> { continuation in
      let follower = LiveStateFollower(connection: self, topic: topic) { state in
        continuation.yield(state)
        if state["status"]?.stringValue != "running" { continuation.finish() }
      }
      let task = Task {
        do { try await follower.start() } catch { continuation.finish() }
      }
      continuation.onTermination = { _ in
        task.cancel()
        Task { await follower.stop() }
      }
    }
    var last: JSONValue?
    for await state in stream { last = state }
    switch last?["status"]?.stringValue {
    case "succeeded": return last?["result"] ?? .null
    case "failed":
      let error = last?["error"]
      throw WireCallError(
        code: "JOB_FAILED",
        message: error?["message"]?.stringValue ?? last?["cause"]?["message"]?.stringValue
          ?? "The operation failed.")
    case "cancelled": throw WireCallError(code: "CANCELLED", message: "Cancelled.")
    default: throw WireCallError.disconnected
    }
  }
}
