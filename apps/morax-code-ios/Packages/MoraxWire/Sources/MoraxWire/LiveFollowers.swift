import Foundation

/// Follows one live state topic: snapshot, then ordered Immer patches. A missed sequence, a
/// new generation or a failed patch triggers a fresh snapshot, as the TypeScript followers do.
///
/// Resyncs are coalesced: concurrent triggers share one run, and a trigger that arrives while a
/// snapshot is in flight makes that run take another snapshot (at most `maxSnapshotsPerResync`).
/// After `stop()`, even one called while `start()` is still attaching, nothing is delivered.
public actor LiveStateFollower {
  /// Bounds a resync loop when every snapshot is immediately invalidated by the next update.
  static let maxSnapshotsPerResync = 3

  private let connection: WireConnection
  private let topic: String
  private let onValue: @Sendable (JSONValue) -> Void
  private var state: JSONValue?
  private var generation: Double = -1
  private var sequence: Double = -1
  private var buffered: [JSONValue] = []
  private var token: UUID?
  private var isStopped = false
  private var resyncTask: Task<Void, Error>?
  private var needsAnotherSnapshot = false

  public init(
    connection: WireConnection, topic: String, onValue: @escaping @Sendable (JSONValue) -> Void
  ) {
    self.connection = connection
    self.topic = topic
    self.onValue = onValue
  }

  public func start() async throws {
    let attached = try await connection.attach(
      topic,
      onUpdate: { [weak self] update in Task { await self?.receive(update) } },
      onGap: { [weak self] in Task { try? await self?.resync() } })
    // `stop()` ran while attaching: release the subscription instead of leaking it.
    guard !isStopped, !Task.isCancelled else {
      await connection.detach(topic, token: attached)
      throw CancellationError()
    }
    token = attached
    try await resync()
  }

  public func stop() async {
    isStopped = true
    resyncTask?.cancel()
    guard let token else { return }
    self.token = nil
    await connection.detach(topic, token: token)
  }

  /// Takes a fresh snapshot, sharing the run already in flight if there is one.
  func resync() async throws {
    guard !isStopped else { return }
    if let resyncTask {
      needsAnotherSnapshot = true
      return try await resyncTask.value
    }
    let task = Task { try await self.runResync() }
    resyncTask = task
    try await task.value
  }

  /// The body of the current `resyncTask`; it clears the slot itself, so a caller resuming
  /// late can never clear a newer run.
  private func runResync() async throws {
    defer { resyncTask = nil }
    for _ in 0..<Self.maxSnapshotsPerResync {
      needsAnotherSnapshot = false
      let snapshot = try await connection.snapshot(topic)
      guard !isStopped else { return }
      state = snapshot["data"] ?? .null
      generation = snapshot["generation"]?.numberValue ?? 0
      sequence = snapshot["sequence"]?.numberValue ?? 0
      let pendingUpdates = buffered
      buffered.removeAll()
      for update in pendingUpdates where (update["sequence"]?.numberValue ?? 0) > sequence {
        guard apply(update) else { break }
      }
      if !needsAnotherSnapshot {
        if let state { onValue(state) }
        return
      }
    }
    throw WireCallError(code: "RESYNC_FAILED", message: "Could not follow \(topic).")
  }

  func receive(_ update: JSONValue) async {
    guard !isStopped else { return }
    if resyncTask != nil || state == nil {
      buffered.append(update)
      return
    }
    if apply(update) {
      if let state { onValue(state) }
    } else {
      try? await resync()
    }
  }

  /// Applies one update. On a gap or a failed patch, returns false and flags a new snapshot.
  private func apply(_ update: JSONValue) -> Bool {
    guard let current = state,
      update["generation"]?.numberValue == generation,
      update["baseSequence"]?.numberValue == sequence,
      let delta = update["delta"],
      let next = try? ImmerPatch.apply(delta, to: current)
    else {
      needsAnotherSnapshot = true
      return false
    }
    state = next
    sequence = update["sequence"]?.numberValue ?? sequence + 1
    return true
  }
}

/// Follows a live log (agent terminal output): the retained tail, then appended chunks.
/// `onReset` delivers the full retained text (initially and after a gap). Resyncs are coalesced
/// and `stop()` is safe mid-start, as for `LiveStateFollower`.
public actor LiveLogFollower {
  private let connection: WireConnection
  private let topic: String
  private let onReset: @Sendable (String) -> Void
  private let onChunk: @Sendable (String) -> Void
  private var sequence: Double = -1
  private var generation: Double = -1
  private var seeded = false
  private var token: UUID?
  private var isStopped = false
  private var resyncTask: Task<Void, Error>?

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
    let attached = try await connection.attach(
      topic,
      onUpdate: { [weak self] update in Task { await self?.receive(update) } },
      onGap: { [weak self] in Task { try? await self?.resync() } })
    guard !isStopped, !Task.isCancelled else {
      await connection.detach(topic, token: attached)
      throw CancellationError()
    }
    token = attached
    try await resync()
  }

  public func stop() async {
    isStopped = true
    resyncTask?.cancel()
    guard let token else { return }
    self.token = nil
    await connection.detach(topic, token: token)
  }

  func resync() async throws {
    guard !isStopped else { return }
    if let resyncTask { return try await resyncTask.value }
    let task = Task { try await self.runResync() }
    resyncTask = task
    try await task.value
  }

  private func runResync() async throws {
    defer { resyncTask = nil }
    seeded = false
    let snapshot = try await connection.snapshot(topic)
    guard !isStopped else { return }
    generation = snapshot["generation"]?.numberValue ?? 0
    sequence = snapshot["sequence"]?.numberValue ?? 0
    seeded = true
    onReset(snapshot["data"]?["text"]?.stringValue ?? "")
  }

  func receive(_ update: JSONValue) async {
    guard seeded, !isStopped else { return }
    guard update["generation"]?.numberValue == generation,
      update["baseSequence"]?.numberValue == sequence,
      let chunk = update["delta"]?["chunk"]?.stringValue
    else {
      // Older than the snapshot: already in the retained text.
      if let next = update["sequence"]?.numberValue, next <= sequence { return }
      try? await resync()
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
