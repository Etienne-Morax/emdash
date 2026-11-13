import Testing
@testable import MoraxWire

@Suite("Status rules, checked against the desktop's TypeScript")
struct StatusRulesTests {
  let fixture: JSONValue

  init() throws { fixture = try Fixtures.load("status-logic.json") }

  private func facts(_ value: JSONValue) -> StatusRules.Facts {
    StatusRules.Facts(
      status: AgentStatus(rawValue: value["status"]!.stringValue!)!, seen: value["seen"]!.boolValue!)
  }

  private func status(_ value: JSONValue?) -> AgentStatus? {
    value?.stringValue.flatMap(AgentStatus.init(rawValue:))
  }

  @Test func indicator() {
    for entry in fixture["indicator"]!.arrayValue! {
      #expect(StatusRules.indicator(facts(entry)) == status(entry["result"]), "\(entry)")
    }
  }

  @Test func rollup() {
    for entry in fixture["rollup"]!.arrayValue! {
      let conversations = entry["conversations"]!.arrayValue!.map(facts)
      #expect(StatusRules.rollup(conversations) == status(entry["result"]), "\(entry)")
    }
  }

  @Test func attentionRank() {
    for entry in fixture["attentionRank"]!.arrayValue! {
      #expect(StatusRules.attentionRank(status(entry["status"])) == Int(entry["rank"]!.numberValue!))
    }
  }

  @Test func pickConversation() {
    for entry in fixture["picks"]!.arrayValue! {
      let candidates = entry["candidates"]!.arrayValue!.map { value in
        StatusRules.Candidate(
          id: value["id"]!.stringValue!, facts: facts(value),
          lastInteractedAt: value["lastInteractedAt"]?.stringValue,
          isInitialConversation: value["isInitialConversation"]!.boolValue!)
      }
      #expect(StatusRules.pickConversation(candidates) == entry["picked"]?.stringValue, "\(entry)")
    }
  }

  @Test("time parses ISO dates with and without fractional seconds, 0 otherwise")
  func timeParsesIsoDates() {
    #expect(StatusRules.time("2026-11-12T10:00:00.250Z") == 1_794_477_600_250)
    #expect(StatusRules.time("2026-11-12T10:00:00Z") == 1_794_477_600_000)
    #expect(StatusRules.time("2026-11-12T11:00:00+01:00") == 1_794_477_600_000)
    #expect(StatusRules.time("not a date") == 0)
    #expect(StatusRules.time(nil) == 0)
  }
}
