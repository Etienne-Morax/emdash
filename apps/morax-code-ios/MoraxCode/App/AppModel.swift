import Foundation
import MoraxCodeKit
import MoraxWire
import Observation
import UIKit

/// The app's connection to Emdash on the Mac and everything it shows: one Wire connection
/// over the gateway WebSocket, live replicas of projects and tasks, the conversation index,
/// and local notifications while connected.
@MainActor @Observable
final class AppModel {
  enum Phase: Equatable {
    case loading
    case unpaired
    case online
    /// Paired, but the Mac is out of reach; retrying.
    case offline
  }

  private(set) var phase: Phase = .loading
  private(set) var pairing: Keychain.Pairing?
  private(set) var session: DeviceSession?
  private(set) var connection: WireConnection?

  private(set) var projects: [Project] = []
  private(set) var tasksByProject: [String: [TaskRow]] = [:]
  private(set) var conversations: [String: Conversation] = [:]
  private(set) var machines: [Machine] = []
  private(set) var machineOnline: [String: Bool] = [:]
  private(set) var colors = Colors.empty
  private(set) var localName = "This Mac"

  let notifier = AgentNotifier()
  /// A deep link or tapped notification waiting for the navigation stack.
  var pendingLink: AppLink?

  private var followers: [String: LiveStateFollower] = [:]
  private var eventsToken: UUID?
  private var retryDelay: Duration = .seconds(1)
  private var retryTask: Task<Void, Never>?
  /// Bumped by every `connect()`; only the latest attempt may change the connection state.
  private var connectAttempt = 0
  private let makeTransport: @Sendable (URL, String) -> WireTransport

  init(
    pairing: Keychain.Pairing? = nil,
    makeTransport: @escaping @Sendable (URL, String) -> WireTransport = {
      WebSocketTransport(gateway: $0, token: $1)
    }
  ) {
    self.pairing = pairing
    self.makeTransport = makeTransport
  }

  var board: [TaskBoardRow] {
    TaskBoard.rows(
      projects: projects, tasksByProject: tasksByProject,
      conversations: Array(conversations.values), machines: machines, colors: colors,
      localName: localName)
  }

  func conversations(forTask taskId: String) -> [Conversation] {
    conversations.values.filter { $0.taskId == taskId }
      .sorted { ($0.isInitialConversation == true) && ($1.isInitialConversation != true) }
  }

  func task(_ projectId: String, _ taskId: String) -> TaskRow? {
    tasksByProject[projectId]?.first { $0.id == taskId }
  }

  func project(_ id: String) -> Project? { projects.first { $0.id == id } }

  // MARK: Pairing

  func boot() async {
    if pairing != nil {
      await connect()
    } else if let saved = Keychain.load() {
      pairing = saved
      await connect()
    } else {
      phase = .unpaired
    }
  }

  #if DEBUG
    /// Sample board, offline, for screenshots and layout checks (see `DemoData`).
    func loadDemo() {
      projects = DemoData.projects
      tasksByProject = DemoData.tasks
      conversations = Dictionary(uniqueKeysWithValues: DemoData.conversations.map { ($0.id, $0) })
      machines = DemoData.machines
      machineOnline = ["m5": true]
      colors = DemoData.colors
      localName = "MacBook Pro"
      phase = .offline
    }
  #endif

  func pair(_ link: PairingLink) async throws {
    let token = try await GatewayHTTP(gateway: link.gateway)
      .pair(code: link.code, label: UIDevice.current.name)
    let saved = Keychain.Pairing(gateway: link.gateway, token: token)
    Keychain.save(saved)
    pairing = saved
    await connect()
  }

  func forget() async {
    connectAttempt += 1  // The connection closed below must not trigger a reconnect.
    if let pairing { await GatewayHTTP(gateway: pairing.gateway).logout(token: pairing.token) }
    await teardown()
    Keychain.clear()
    pairing = nil
    session = nil
    phase = .unpaired
  }

  // MARK: Connection

  func connect() async {
    retryTask?.cancel()
    guard let pairing else { return }
    // Each attempt supersedes the previous ones: a slower attempt that resumes after a newer
    // one started must not touch the state (two attempts run at launch: boot and foreground).
    connectAttempt += 1
    let attempt = connectAttempt
    await teardown()
    guard attempt == connectAttempt else { return }
    let connection = WireConnection(transport: makeTransport(pairing.gateway, pairing.token)) {
      [weak self] in
      Task { @MainActor in self?.connectionClosed(attempt: attempt) }
    }
    await connection.start()
    guard attempt == connectAttempt else {
      await connection.close()
      return
    }
    self.connection = connection
    do {
      session = try await connection.call("mobile.session").decode()
      guard attempt == connectAttempt else { return }
      retryDelay = .seconds(1)
      phase = .online
      await loadDesktopInfo()
      try await follow(
        WireTopic.encode(MobileEndpoints.projectList, key: nil),
        id: "projects"
      ) { model, value in
        model.projectsChanged((try? value.decode(ProjectList.self))?.projects ?? [])
      }
      eventsToken = try await connection.subscribeEvents(
        WireTopic.encode(MobileEndpoints.conversationEvents, key: nil),
        onEvent: { [weak self] event in Task { @MainActor in self?.apply(event) } },
        onGap: { [weak self] in Task { @MainActor in await self?.reloadConversations() } })
    } catch {
      // A refused upgrade closes the socket; the session check tells revoked from offline.
      connectionClosed(attempt: attempt)
    }
  }

  /// The connection of `attempt` closed or failed. A connection this app closed itself (a
  /// newer attempt replaced it) is ignored: reacting to it would start a reconnect loop.
  private func connectionClosed(attempt: Int) {
    guard attempt == connectAttempt, pairing != nil, phase != .unpaired else { return }
    connection = nil
    followers.removeAll()
    phase = .offline
    retryTask?.cancel()
    retryTask = Task { [weak self] in
      guard let self else { return }
      try? await Task.sleep(for: retryDelay)
      retryDelay = min(retryDelay * 2, .seconds(30))
      guard !Task.isCancelled else { return }
      if await isRevoked() {
        Keychain.clear()
        pairing = nil
        phase = .unpaired
        return
      }
      await connect()
    }
  }

  private func isRevoked() async -> Bool {
    guard let pairing else { return true }
    do {
      try await GatewayHTTP(gateway: pairing.gateway).checkSession(token: pairing.token)
      return false
    } catch GatewayError.refused {
      return true
    } catch {
      return false
    }
  }

  /// Reconnects at once when the app returns to the foreground.
  func resume() async {
    // Only from offline: at launch, `boot()` is already connecting (phase `.loading`).
    guard pairing != nil, phase == .offline else { return }
    retryDelay = .seconds(1)
    await connect()
  }

  private func teardown() async {
    for follower in followers.values { await follower.stop() }
    followers.removeAll()
    if let connection { await connection.close() }
    connection = nil
    eventsToken = nil
  }

  private func follow(
    _ topic: String, id: String, onValue: @escaping @MainActor (AppModel, JSONValue) -> Void
  ) async throws {
    guard let connection, followers[id] == nil else { return }
    let follower = LiveStateFollower(connection: connection, topic: topic) { [weak self] value in
      Task { @MainActor in
        guard let self else { return }
        onValue(self, value)
      }
    }
    followers[id] = follower
    try await follower.start()
  }

  // MARK: Data

  private func loadDesktopInfo() async {
    guard let connection else { return }
    if let value = try? await connection.call("mobile.machines"),
      let list: [Machine] = try? value.decode()
    {
      machines = list.filter { $0.kind == "remote" }
    }
    if let appearance: Appearance = try? await connection.call("mobile.appearance").decode() {
      localName = appearance.localMachineName
    }
    for machine in machines {
      try? await follow(
        WireTopic.encode(
          MobileEndpoints.hostAvailability,
          key: ["host": ["type": "remote", "id": .string(machine.id)]]),
        id: "host:\(machine.id)"
      ) { model, value in
        model.machineOnline[machine.id] = value["kind"]?.stringValue == "ready"
      }
    }
  }

  private func projectsChanged(_ list: [Project]) {
    projects = list
    Task { await refreshColors() }
    for project in list {
      Task {
        try? await follow(
          WireTopic.encode(MobileEndpoints.taskList, key: ["projectId": .string(project.id)]),
          id: "tasks:\(project.id)"
        ) { model, value in
          model.tasksByProject[project.id] = (try? value.decode(TaskList.self))?.tasks ?? []
        }
        await loadConversations(projectId: project.id)
      }
    }
  }

  private func refreshColors() async {
    guard let connection else { return }
    let request: JSONValue = [
      "projects": .array(
        projects.map { ["id": .string($0.id), "path": .string($0.path)] })
    ]
    if let value = try? await connection.call("mobile.colors", request),
      let resolved: Colors = try? value.decode()
    {
      colors = resolved
    }
  }

  private func loadConversations(projectId: String) async {
    guard let connection,
      let value = try? await connection.call(
        "conversations.getConversationsForProject", ["projectId": .string(projectId)]),
      let list: [Conversation] = try? value.decode()
    else { return }
    conversations = conversations.filter { $0.value.projectId != projectId }
    for conversation in list { conversations[conversation.id] = conversation }
  }

  func reloadConversations() async {
    for project in projects { await loadConversations(projectId: project.id) }
  }

  private func apply(_ event: JSONValue) {
    switch event["type"]?.stringValue {
    case "created":
      if let conversation: Conversation = try? event["conversation"]?.decode() {
        conversations[conversation.id] = conversation
      }
    case "deleted":
      if let id = event["conversationId"]?.stringValue { conversations.removeValue(forKey: id) }
    case "changed":
      guard let id = event["conversationId"]?.stringValue, var current = conversations[id] else {
        return
      }
      if let title = event["changes"]?["title"]?.stringValue { current.title = title }
      if let time = event["changes"]?["lastInteractedAt"]?.stringValue {
        current.lastInteractedAt = time
      }
      conversations[id] = current
    case "agent-status-changed":
      guard let id = event["conversationId"]?.stringValue, var current = conversations[id] else {
        return
      }
      current.agentStatus = event["status"]?.stringValue.flatMap(AgentStatus.init(rawValue:))
      current.agentStatusSeen = event["seen"]?.boolValue
      conversations[id] = current
      notifier.statusChanged(
        current, taskName: task(current.projectId, current.taskId)?.name ?? current.title)
    default:
      return
    }
  }

  /// Clears the attention marker once the user looks at a conversation.
  func markSeen(_ conversationId: String) {
    guard var conversation = conversations[conversationId], conversation.agentStatusSeen == false
    else { return }
    conversation.agentStatusSeen = true
    conversations[conversationId] = conversation
    Task {
      _ = try? await connection?.call(
        "conversations.markConversationSeen", ["conversationId": .string(conversationId)])
    }
  }

  /// Activates a task's workspace and session on its machine (the desktop's
  /// `TaskManagerStore.provisionTask`), required before an agent can be hydrated.
  func provision(workspaceId: String, taskId: String) async throws {
    guard let connection else { throw WireCallError.disconnected }
    _ = try await connection.runJob(
      path: MobileEndpoints.provision, topicId: MobileEndpoints.provision,
      input: ["workspaceId": .string(workspaceId), "taskId": .string(taskId)])
  }
}
