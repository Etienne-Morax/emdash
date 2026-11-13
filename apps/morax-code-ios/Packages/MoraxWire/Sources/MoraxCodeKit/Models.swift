import Foundation
import MoraxWire

/// The desktop records the app reads. Decoding is lenient: unknown fields are ignored and
/// optional fields may be absent, so a newer desktop does not break the app.
public struct Project: Codable, Sendable, Identifiable, Hashable {
  public let id: String
  public let name: String
  public let type: String
  public let path: String
  public let connectionId: String?

  public var isRemote: Bool { type == "ssh" }
  /// Machine id: `local`, or the SSH connection id.
  public var machineId: String { isRemote ? (connectionId ?? "unknown") : "local" }
}

public struct ProjectList: Codable, Sendable {
  public let projects: [Project]
}

public struct TaskRow: Codable, Sendable, Identifiable, Hashable {
  public let id: String
  public let projectId: String
  public let name: String
  public let type: String?
  public let archivedAt: String?
  public let workspaceId: String?
  public let lastInteractedAt: String?
  public let updatedAt: String?
}

public struct TaskList: Codable, Sendable {
  public let tasks: [TaskRow]
}

public struct Conversation: Codable, Sendable, Identifiable, Hashable {
  public let id: String
  public let projectId: String
  public let taskId: String
  public var title: String
  public let providerId: String?
  public var lastInteractedAt: String?
  public let isInitialConversation: Bool?
  public var agentStatus: AgentStatus?
  public var agentStatusSeen: Bool?
  public let type: String?

  public var isChat: Bool { type == "acp" }
  public var facts: StatusRules.Facts {
    StatusRules.Facts(status: agentStatus ?? .idle, seen: agentStatusSeen ?? true)
  }
}

public struct Machine: Codable, Sendable, Identifiable, Hashable {
  public let id: String
  public let kind: String
  public let name: String
}

public struct Colors: Codable, Sendable, Equatable {
  public var projects: [String: String]
  public var machines: [String: String]
  public var localMachine: String

  public static let empty = Colors(projects: [:], machines: [:], localMachine: "#8a94a6")
}

public struct Appearance: Codable, Sendable {
  public let localMachineName: String
}

public struct TaskDefaults: Codable, Sendable {
  public let defaultAgent: String
  public let branchPrefix: String
  public let appendRandomBranchSuffix: Bool
}

public struct AgentInfo: Codable, Sendable, Identifiable, Hashable {
  public let id: String
  public let name: String
}

public struct DeviceSession: Codable, Sendable {
  public let deviceId: String
  public let label: String
  public let desktopName: String
}
