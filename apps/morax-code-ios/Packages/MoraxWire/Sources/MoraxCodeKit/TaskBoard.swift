import Foundation
import MoraxWire

/// One row of the home screen: a task of any project on any machine.
public struct TaskBoardRow: Identifiable, Sendable, Hashable {
  public var id: String { "\(projectId):\(taskId)" }
  public let projectId: String
  public let projectName: String
  public let projectColor: String
  public let taskId: String
  public let taskName: String
  public let status: AgentStatus?
  public let machineName: String
  public let machineColor: String
  /// Latest activity, epoch ms; 0 when unknown.
  public let activityAt: Double
}

public enum TaskBoard {
  /// The machine chip of a project: its SSH machine, or this Mac.
  public static func machine(
    for project: Project, machines: [Machine], colors: Colors, localName: String
  ) -> (name: String, color: String) {
    guard project.isRemote else { return (localName, colors.localMachine) }
    let id = project.machineId
    let name = machines.first { $0.id == id }?.name ?? "SSH machine"
    return (name, colors.machines[id] ?? colors.localMachine)
  }

  /// Every live task, questions waiting for a human first (the agent grid's order), then
  /// most recent activity. Mirrors the desktop's task board.
  public static func rows(
    projects: [Project],
    tasksByProject: [String: [TaskRow]],
    conversations: [Conversation],
    machines: [Machine],
    colors: Colors,
    localName: String
  ) -> [TaskBoardRow] {
    let byTask = Dictionary(grouping: conversations, by: \.taskId)
    var rows: [TaskBoardRow] = []
    for project in projects {
      let chip = machine(for: project, machines: machines, colors: colors, localName: localName)
      for task in tasksByProject[project.id] ?? [] {
        if task.archivedAt != nil || task.type == "automation-run" { continue }
        let taskConversations = byTask[task.id] ?? []
        let activity = ([task.lastInteractedAt, task.updatedAt] + taskConversations.map(\.lastInteractedAt))
          .map(StatusRules.time).max() ?? 0
        rows.append(
          TaskBoardRow(
            projectId: project.id, projectName: project.name,
            projectColor: colors.projects[project.id] ?? colors.localMachine,
            taskId: task.id, taskName: task.name,
            status: StatusRules.rollup(taskConversations.map(\.facts)),
            machineName: chip.name, machineColor: chip.color, activityAt: activity))
      }
    }
    return rows.sorted {
      let (a, b) = (StatusRules.attentionRank($0.status), StatusRules.attentionRank($1.status))
      return a != b ? a < b : $0.activityAt > $1.activityAt
    }
  }

  public static func label(_ status: AgentStatus?) -> String {
    switch status {
    case .awaitingInput: "Waiting for you"
    case .working: "Working"
    case .error: "Error"
    case .completed: "Done"
    default: "Idle"
    }
  }

  /// The conversation a task opens on (the agent grid's rule).
  public static func defaultConversation(_ conversations: [Conversation]) -> String? {
    StatusRules.pickConversation(
      conversations.map {
        StatusRules.Candidate(
          id: $0.id, facts: $0.facts, lastInteractedAt: $0.lastInteractedAt,
          isInitialConversation: $0.isInitialConversation == true)
      })
  }
}
