import Foundation
import Testing
@testable import MoraxWire

@Suite struct ImmerPatchTests {
  @Test func appliesAddReplaceRemoveAndLength() throws {
    let state: JSONValue = ["a": [1, 2, 3], "b": ["c": "x"]]
    let patches: JSONValue = [
      ["op": "add", "path": ["a", 1], "value": 9],
      ["op": "replace", "path": ["b", "c"], "value": "y"],
      ["op": "remove", "path": ["a", 0]],
      ["op": "replace", "path": ["a", "length"], "value": 2],
      ["op": "add", "path": ["d"], "value": nil],
    ]
    #expect(try ImmerPatch.apply(patches, to: state) == ["a": [9, 2], "b": ["c": "y"], "d": nil])
  }

  @Test func rejectsAPathThatDoesNotExist() {
    #expect(throws: ImmerPatch.PatchError.badPath) {
      try ImmerPatch.apply([["op": "replace", "path": ["x", "y"], "value": 1]], to: ["a": 1])
    }
  }
}

@Suite struct FrameCodecTests {
  @Test func refusesCorruptFrames() {
    #expect(throws: WireFrameCodec.FrameError.truncated) { try WireFrameCodec.decode(Data([0])) }
    #expect(throws: WireFrameCodec.FrameError.unknownKind(7)) {
      try WireFrameCodec.decode(Data([7, 0, 0, 0, 0]))
    }
    #expect(throws: WireFrameCodec.FrameError.tooLarge) {
      try WireFrameCodec.decode(Data([0, 0xFF, 0xFF, 0xFF, 0xFF]))
    }
  }

  @Test func serializesLikeJavaScript() {
    #expect(JSONValue.number(3).serialized() == "3")
    #expect(JSONValue.number(1.5).serialized() == "1.5")
    #expect(JSONValue.string("a\"b\\\n\u{1}é/").serialized() == "\"a\\\"b\\\\\\n\\u0001é/\"")
    #expect(JSONValue.object(["b": 1, "a": 2]).serialized(sortedKeys: true) == "{\"a\":2,\"b\":1}")
  }
}

/// A transport whose server side answers like the gateway: calls echo, attach acks.
final class ScriptedTransport: WireTransport, @unchecked Sendable {
  private let lock = NSLock()
  private var inbox: [Data] = []
  private var waiters: [CheckedContinuation<Data, Error>] = []
  private var isClosed = false
  let respond: @Sendable (JSONValue) -> [JSONValue]

  init(respond: @escaping @Sendable (JSONValue) -> [JSONValue]) { self.respond = respond }

  func send(_ frame: Data) async throws {
    let message = try WireFrameCodec.decode(frame)
    for reply in respond(message) { deliver(WireFrameCodec.encode(reply)) }
  }

  func deliver(_ frame: Data) {
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

@Suite struct WireConnectionTests {
  @Test func callsAndReportsErrors() async throws {
    let transport = ScriptedTransport { message in
      guard let id = message["id"] else { return [] }
      if message["path"] == "fail" {
        return [["kind": "result", "id": id, "ok": false, "code": "NOT_FOUND", "message": "nope"]]
      }
      return [["kind": "result", "id": id, "ok": true, "value": message["input"] ?? nil]]
    }
    let connection = WireConnection(transport: transport)
    await connection.start()
    #expect(try await connection.call("echo", ["x": 1]) == ["x": 1])
    await #expect(throws: WireCallError(code: "NOT_FOUND", message: "nope")) {
      try await connection.call("fail")
    }
    await connection.close()
    await #expect(throws: WireCallError.disconnected) { try await connection.call("echo") }
  }

  @Test func followsALiveStateAndResyncsOnAGap() async throws {
    let transport = ScriptedTransport { message in
      guard let id = message["id"] else { return [] }
      switch message["kind"]?.stringValue {
      case "snapshot":
        return [["kind": "result", "id": id, "ok": true,
                 "value": ["generation": 1, "sequence": 5, "timestamp": 0, "data": ["n": 5]]]]
      default:
        return [["kind": "result", "id": id, "ok": true]]
      }
    }
    let connection = WireConnection(transport: transport)
    await connection.start()
    let values = Recorder()
    let follower = LiveStateFollower(connection: connection, topic: "m.s|{}") { value in
      values.append(value)
    }
    try await follower.start()
    let update: (Double, Double, JSONValue) -> JSONValue = { base, seq, n in
      ["kind": "update", "topic": "m.s|{}",
       "update": ["generation": 1, "baseSequence": .number(base), "sequence": .number(seq),
                  "timestamp": 0, "delta": [["op": "replace", "path": ["n"], "value": n]]]]
    }
    transport.deliver(WireFrameCodec.encode(update(5, 6, 6)))
    transport.deliver(WireFrameCodec.encode(update(9, 10, 10)))  // gap: resync to n = 5
    try await Task.sleep(for: .milliseconds(200))
    #expect(values.all.first == ["n": 5])
    #expect(values.all.contains(["n": 6]))
    #expect(values.all.last == ["n": 5])
    #expect(!values.all.contains(["n": 10]))
  }
}

final class Recorder: @unchecked Sendable {
  private let lock = NSLock()
  private var values: [JSONValue] = []
  func append(_ value: JSONValue) {
    lock.lock()
    values.append(value)
    lock.unlock()
  }
  var all: [JSONValue] {
    lock.lock()
    defer { lock.unlock() }
    return values
  }
}
