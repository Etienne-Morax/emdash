import Foundation

/// Agent status as the desktop reports it (`AgentStatus` in agent-events.ts).
public enum AgentStatus: String, Codable, Sendable, CaseIterable {
  case idle
  case working
  case awaitingInput = "awaiting-input"
  case error
  case completed
}

/// Port of the desktop's agent-status rules (`agent-status-rollup.ts` and the agent grid's
/// `pickTaskGridConversation`). Kept identical by `Fixtures/status-logic.json`, which the
/// desktop tests generate from the TypeScript functions.
public enum StatusRules {
  public struct Facts: Sendable, Equatable {
    public let status: AgentStatus
    public let seen: Bool
    public init(status: AgentStatus, seen: Bool) {
      self.status = status
      self.seen = seen
    }
  }

  public struct Candidate: Sendable {
    public let id: String
    public let facts: Facts
    public let lastInteractedAt: String?
    public let isInitialConversation: Bool
    public init(id: String, facts: Facts, lastInteractedAt: String?, isInitialConversation: Bool) {
      self.id = id
      self.facts = facts
      self.lastInteractedAt = lastInteractedAt
      self.isInitialConversation = isInitialConversation
    }
  }

  /// What a conversation's indicator shows: working, or an unseen question/error/finish.
  public static func indicator(_ facts: Facts) -> AgentStatus? {
    if facts.status == .working { return .working }
    if facts.seen { return nil }
    switch facts.status {
    case .awaitingInput, .error, .completed: return facts.status
    default: return nil
    }
  }

  /// A task's status from its conversations.
  public static func rollup(_ conversations: [Facts]) -> AgentStatus? {
    var hasWorking = false
    var hasUnseenError = false
    var hasUnseenCompleted = false
    for conversation in conversations {
      if !conversation.seen && conversation.status == .awaitingInput { return .awaitingInput }
      if conversation.status == .working { hasWorking = true }
      if !conversation.seen && conversation.status == .error { hasUnseenError = true }
      if !conversation.seen && conversation.status == .completed { hasUnseenCompleted = true }
    }
    if hasWorking { return .working }
    if hasUnseenError { return .error }
    if hasUnseenCompleted { return .completed }
    return nil
  }

  /// Sort order: waiting for an answer first.
  public static func attentionRank(_ status: AgentStatus?) -> Int {
    switch status {
    case .awaitingInput: 0
    case .error: 1
    case .working: 2
    case .completed: 3
    default: 4
    }
  }

  /// The conversation a task opens on: most in need of attention, then most recent, then
  /// the initial one.
  public static func pickConversation(_ candidates: [Candidate]) -> String? {
    func rank(_ candidate: Candidate) -> Int {
      let facts = candidate.facts
      if facts.status == .awaitingInput && !facts.seen { return 0 }
      if facts.status == .working { return 1 }
      if facts.status == .error && !facts.seen { return 2 }
      if facts.status == .awaitingInput { return 3 }
      return 4
    }
    return candidates.enumerated().sorted { left, right in
      let (a, b) = (left.element, right.element)
      if rank(a) != rank(b) { return rank(a) < rank(b) }
      let (timeA, timeB) = (time(a.lastInteractedAt), time(b.lastInteractedAt))
      if timeA != timeB { return timeA > timeB }
      if a.isInitialConversation != b.isInitialConversation { return a.isInitialConversation }
      return left.offset < right.offset  // JavaScript's sort is stable
    }.first?.element.id
  }

  /// Epoch milliseconds of an ISO date, 0 when absent or invalid (like `Date.parse`).
  public static func time(_ iso: String?) -> Double {
    guard let iso else { return 0 }
    let withFraction = ISO8601DateFormatter()
    withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = withFraction.date(from: iso) { return date.timeIntervalSince1970 * 1000 }
    if let date = ISO8601DateFormatter().date(from: iso) { return date.timeIntervalSince1970 * 1000 }
    return 0
  }
}
