import Foundation
import MoraxWire

/// A base branch the new task's worktree starts from.
public struct BaseBranch: Identifiable, Hashable, Sendable {
  public let id: String
  public let label: String
  public let branch: String
  /// Nil for a local branch.
  public let remote: (name: String, url: String)?

  public static func == (a: BaseBranch, b: BaseBranch) -> Bool { a.id == b.id }
  public func hash(into hasher: inout Hasher) { hasher.combine(id) }

  var fromBranch: JSONValue {
    if let remote {
      return [
        "type": "remote", "branch": .string(branch),
        "remote": ["name": .string(remote.name), "url": .string(remote.url)],
      ]
    }
    return ["type": "local", "branch": .string(branch)]
  }
}

/// The desktop's Create Task flow: same branch options, naming and `tasks.createTask` input.
public enum NewTask {
  static let localPrefix = "refs/heads/"
  static let remotePrefix = "refs/remotes/"

  /// Local branches first, then remote branches not already checked out locally (from the
  /// `sourceControl.repository.model` refs state).
  public static func baseBranches(refs: JSONValue?) -> [BaseBranch] {
    let branches = refs?["branches"]?.arrayValue ?? []
    var options: [BaseBranch] = []
    var localNames = Set<String>()
    for branch in branches where branch["type"] == "local" {
      guard let ref = branch["ref"]?.stringValue, ref.hasPrefix(localPrefix) else { continue }
      let name = String(ref.dropFirst(localPrefix.count))
      localNames.insert(name)
      options.append(BaseBranch(id: ref, label: name, branch: name, remote: nil))
    }
    for branch in branches where branch["type"] == "remote" {
      guard let ref = branch["ref"]?.stringValue,
        let remoteName = branch["remote"]?["name"]?.stringValue,
        let remoteURL = branch["remote"]?["url"]?.stringValue
      else { continue }
      let prefix = "\(remotePrefix)\(remoteName)/"
      guard ref.hasPrefix(prefix) else { continue }
      let name = String(ref.dropFirst(prefix.count))
      if name == "HEAD" || localNames.contains(name) { continue }
      options.append(
        BaseBranch(
          id: ref, label: "\(remoteName)/\(name)", branch: name, remote: (remoteName, remoteURL)))
    }
    return options
  }

  /// The default branch's option (local first), else the first option.
  public static func defaultBase(_ options: [BaseBranch], defaultBranch: String?) -> BaseBranch? {
    if let defaultBranch {
      if let local = options.first(where: { $0.remote == nil && $0.branch == defaultBranch }) {
        return local
      }
      if let any = options.first(where: { $0.branch == defaultBranch }) { return any }
    }
    return options.first
  }

  /// `resolveTaskBranchName` (desktop): prefix + name + optional random suffix.
  public static func branchName(
    taskName: String, defaults: TaskDefaults, suffix: String
  ) -> String {
    let prefix = defaults.branchPrefix.trimmingCharacters(in: .whitespaces)
      .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    let branch = defaults.appendRandomBranchSuffix ? "\(taskName)-\(suffix)" : taskName
    return prefix.isEmpty ? branch : "\(prefix)/\(branch)"
  }

  /// Slug the desktop uses as a task name when none is generated.
  public static func fallbackName(prompt: String) -> String {
    let words = prompt.lowercased()
      .split(whereSeparator: { !($0.isASCII && ($0.isLetter || $0.isNumber)) })
      .prefix(5)
    return words.isEmpty ? "mobile-task" : words.joined(separator: "-")
  }

  /// Random lowercase base-36 suffix, as the desktop appends to branch names.
  public static func randomSuffix(length: Int = 5) -> String {
    let alphabet = Array("0123456789abcdefghijklmnopqrstuvwxyz")
    return String((0..<length).map { _ in alphabet[Int.random(in: 0..<alphabet.count)] })
  }

  /// The exact `tasks.createTask` input of the desktop's "new worktree on a new branch".
  public static func createTaskInput(
    projectId: String, taskName: String, base: BaseBranch, provider: String, prompt: String,
    defaults: TaskDefaults, suffix: String, taskId: String, conversationId: String
  ) -> JSONValue {
    var conversation: [String: JSONValue] = [
      "id": .string(conversationId), "provider": .string(provider),
    ]
    let trimmed = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
    if !trimmed.isEmpty { conversation["initialPrompt"] = .string(trimmed) }
    return [
      "id": .string(taskId),
      "projectId": .string(projectId),
      "taskConfig": [
        "version": "1", "name": .string(taskName), "initialConversation": .object(conversation),
      ],
      "workspaceConfig": [
        "version": "2",
        "git": [
          "kind": "create-branch",
          "branchName": .string(branchName(taskName: taskName, defaults: defaults, suffix: suffix)),
          "fromBranch": base.fromBranch,
        ],
        "workspace": ["kind": "new-worktree"],
      ],
    ]
  }
}
