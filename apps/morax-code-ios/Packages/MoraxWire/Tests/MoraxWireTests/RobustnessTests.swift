import Foundation
import Testing
@testable import MoraxWire

/// Requests that never get a reply, followers stopped mid-start, and overlapping resyncs.
@Suite struct RobustnessTests {
  private static let topic = "m.s|{}"

  private func result(_ message: JSONValue, _ value: JSONValue = .null) -> JSONValue {
    ["kind": "result", "id": message["id"] ?? .null, "ok": true, "value": value]
  }

  private func snapshotValue(_ n: Double) -> JSONValue {
    ["generation": 1, "sequence": .number(n), "timestamp": 0, "data": ["n": .number(n)]]
  }

  @Test func failsARequestThatGetsNoReplyInTime() async throws {
    let transport = ScriptedTransport { _ in [] }
    let connection = WireConnection(transport: transport, requestTimeout: .milliseconds(100))
    await connection.start()
    await #expect(throws: WireCallError.timeout) { try await connection.call("silent") }
  }

  @Test func cancellingTheCallerFailsItsPendingRequest() async throws {
    let transport = ScriptedTransport { _ in [] }
    let connection = WireConnection(transport: transport)
    await connection.start()
    let call = Task { try await connection.call("silent") }
    try await Task.sleep(for: .milliseconds(50))
    call.cancel()
    await #expect(throws: CancellationError.self) { try await call.value }
  }

  @Test func stopDuringStartReleasesTheSubscriptionAndDeliversNothing() async throws {
    let sent = Recorder()
    let transport = ScriptedTransport { message in
      sent.append(message)
      return []  // Every reply is delivered by hand below.
    }
    let connection = WireConnection(transport: transport)
    await connection.start()
    let values = Recorder()
    let follower = LiveStateFollower(connection: connection, topic: Self.topic) { values.append($0) }
    let starting = Task { try await follower.start() }
    try await waitUntil { sent.all.contains { $0["kind"] == "attach" } }

    await follower.stop()
    let attach = try #require(sent.all.first { $0["kind"] == "attach" })
    transport.deliver(WireFrameCodec.encode(result(attach)))

    await #expect(throws: CancellationError.self) { try await starting.value }
    try await waitUntil { sent.all.contains { $0["kind"] == "detach" } }
    #expect(sent.all.contains { $0["kind"] == "detach" })
    #expect(!sent.all.contains { $0["kind"] == "snapshot" })
    #expect(values.all.isEmpty)
  }

  @Test func gapsDuringASnapshotShareOneExtraSnapshot() async throws {
    let sent = Recorder()
    let transport = ScriptedTransport { message in
      sent.append(message)
      // Attach is acknowledged at once; snapshots wait for the test.
      return message["kind"] == "attach" ? [["kind": "result", "id": message["id"]!, "ok": true]] : []
    }
    let connection = WireConnection(transport: transport)
    await connection.start()
    let values = Recorder()
    let follower = LiveStateFollower(connection: connection, topic: Self.topic) { values.append($0) }
    let starting = Task { try await follower.start() }
    let snapshots: @Sendable () -> [JSONValue] = { sent.all.filter { $0["kind"] == "snapshot" } }
    try await waitUntil { snapshots().count == 1 }

    for _ in 0..<3 {
      transport.deliver(WireFrameCodec.encode(["kind": "topic-gap", "topic": .string(Self.topic)]))
    }
    try await Task.sleep(for: .milliseconds(200))
    #expect(snapshots().count == 1, "gaps must not start a second snapshot in parallel")

    transport.deliver(WireFrameCodec.encode(result(snapshots()[0], snapshotValue(1))))
    try await waitUntil { snapshots().count == 2 }
    transport.deliver(WireFrameCodec.encode(result(snapshots()[1], snapshotValue(2))))
    try await starting.value

    try await Task.sleep(for: .milliseconds(100))
    #expect(snapshots().count == 2)
    #expect(values.all == [["n": 2]])
  }
}
