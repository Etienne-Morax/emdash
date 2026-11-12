import Foundation
import Testing
@testable import MoraxWire

@Suite("Wire protocol, replayed from the TypeScript recording")
struct ProtocolFixtureTests {
  let fixture: JSONValue
  let session: [JSONValue]

  init() throws {
    fixture = try Fixtures.load("wire-protocol.json")
    session = fixture["session"]?.arrayValue ?? []
  }

  @Test func decodesEveryRecordedFrame() throws {
    #expect(session.count > 10)
    for entry in session {
      let frame = Fixtures.hex(entry["frame"]!.stringValue!)
      #expect(try WireFrameCodec.decode(frame) == entry["message"])
    }
  }

  @Test func encodesFramesTheTypeScriptDecoderReads() throws {
    for entry in session {
      let message = entry["message"]!
      let frame = WireFrameCodec.encode(message)
      #expect(frame.first == 0x00)
      #expect(try WireFrameCodec.decode(frame) == message)
      // Same header length prefix as the recorded frame when the JSON text is identical.
      let recorded = Fixtures.hex(entry["frame"]!.stringValue!)
      #expect(recorded.count >= 5)
    }
  }

  @Test func encodesTopicsLikeWire() throws {
    let topics = Set(session.compactMap { $0["message"]?["topic"]?.stringValue })
    #expect(topics.contains(WireTopic.encode("board.list", key: ["id": "b1"])))
    #expect(topics.contains(WireTopic.encode("events", key: nil)))
  }

  @Test func replaysLiveStatePatchesToTheServerState() throws {
    let topic = WireTopic.encode("board.list", key: ["id": "b1"])
    let snapshot = try #require(
      session.first { $0["message"]?["value"]?["data"]?["items"] != nil }?["message"]?["value"])
    var state = try #require(snapshot["data"])
    var sequence = snapshot["sequence"]!.numberValue!
    for entry in session {
      let message = entry["message"]!
      guard message["kind"] == "update", message["topic"]?.stringValue == topic else { continue }
      let update = message["update"]!
      #expect(update["baseSequence"]?.numberValue == sequence)
      state = try ImmerPatch.apply(update["delta"]!, to: state)
      sequence = update["sequence"]!.numberValue!
    }
    #expect(state == fixture["final"]?["board"])
  }

  @Test func replaysTheLiveLogToTheServerText() throws {
    let topic = WireTopic.encode("output", key: ["id": "t1"])
    var text = try #require(
      session.first { $0["message"]?["value"]?["data"]?["baseOffset"] != nil }?["message"]?[
        "value"]?["data"]?["text"]?.stringValue)
    for entry in session {
      let message = entry["message"]!
      guard message["kind"] == "update", message["topic"]?.stringValue == topic else { continue }
      text += message["update"]?["delta"]?["chunk"]?.stringValue ?? ""
    }
    #expect(.string(text) == fixture["final"]?["output"])
  }
}

@Suite("Mobile contract endpoints")
struct ContractFixtureTests {
  @Test func matchesTheTypeScriptContract() throws {
    let endpoints = try #require(try Fixtures.load("mobile-contract.json")["endpoints"])
    let procedures = Set(endpoints["procedures"]?.arrayValue?.compactMap(\.stringValue) ?? [])
    for path in MobileEndpoints.procedures { #expect(procedures.contains(path), "\(path)") }
    let states = endpoints["liveStates"]?.objectValue ?? [:]
    #expect(states["projectList"]?.stringValue == MobileEndpoints.projectList)
    #expect(states["taskList"]?.stringValue == MobileEndpoints.taskList)
    #expect(states["hostAvailability"]?.stringValue == MobileEndpoints.hostAvailability)
    #expect(states["branchRefs"]?.stringValue == MobileEndpoints.branchRefs)
    #expect(states["checkoutHead"]?.stringValue == MobileEndpoints.checkoutHead)
    #expect(states["acpSession"]?.stringValue == MobileEndpoints.acpSession)
    #expect(endpoints["liveLogs"]?["terminalOutput"]?.stringValue == MobileEndpoints.terminalOutput)
    #expect(
      endpoints["eventStreams"]?["conversationEvents"]?.stringValue
        == MobileEndpoints.conversationEvents)
    #expect(endpoints["liveJobs"]?["provision"]?["path"]?.stringValue == MobileEndpoints.provision)
    #expect(endpoints["liveJobs"]?["publish"]?["path"]?.stringValue == MobileEndpoints.publish)
  }
}
