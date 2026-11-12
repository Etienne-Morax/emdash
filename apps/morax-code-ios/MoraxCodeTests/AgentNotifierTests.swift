import Testing
import MoraxWire
@testable import MoraxCode

@MainActor
struct AgentNotifierTests {
  @Test func notifiesOnlyWhenTheAgentNeedsTheUser() {
    #expect(AgentNotifier.body(for: .awaitingInput) != nil)
    #expect(AgentNotifier.body(for: .completed) != nil)
    #expect(AgentNotifier.body(for: .working) == nil)
    #expect(AgentNotifier.body(for: nil) == nil)
  }
}
