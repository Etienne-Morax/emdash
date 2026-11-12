import MoraxCodeKit
import MoraxDesign
import MoraxWire
import SwiftUI

/// Start an agent in any repository of any machine: the desktop's Create Task call (new
/// worktree on a new branch from the chosen base), then open it.
struct NewTaskScreen: View {
  let onCreated: (String, String) -> Void
  @Environment(AppModel.self) private var model
  @State private var projectId = ""
  @State private var refs: JSONValue?
  @State private var defaultBranch: String?
  @State private var baseId = ""
  @State private var agents: [AgentInfo] = []
  @State private var defaults: TaskDefaults?
  @State private var provider = ""
  @State private var prompt = ""
  @State private var busy = false
  @State private var error: String?
  @State private var refsFollower: LiveStateFollower?
  /// Why the branch list is missing (failed or timed out), with a Retry action.
  @State private var branchError: String?
  /// Bumped by each branch load; a slower, superseded load drops its result.
  @State private var branchLoad = 0
  private static let branchTimeout: Duration = .seconds(15)
  private let suffix = NewTask.randomSuffix()
  private static let maxFormWidth: CGFloat = 720

  private var options: [BaseBranch] { NewTask.baseBranches(refs: refs) }
  private var base: BaseBranch? {
    options.first { $0.id == baseId } ?? NewTask.defaultBase(options, defaultBranch: defaultBranch)
  }

  var body: some View {
    Form {
      Section("Project") {
        Picker("Project", selection: $projectId) {
          ForEach(model.projects) { project in
            let machine = TaskBoard.machine(
              for: project, machines: model.machines, colors: model.colors,
              localName: model.localName)
            Text("\(project.name) — \(machine.name)").tag(project.id)
          }
        }
      }
      Section("Base branch") {
        if let branchError {
          Text(branchError).foregroundStyle(Palette.dangerText)
          Button("Retry") { Task { await loadBranches() } }
        } else if options.isEmpty {
          LabeledContent("Base branch") {
            if refs == nil { ProgressView() } else { Text("No branch") }
          }
        } else {
          Picker("Base branch", selection: Binding(get: { base?.id ?? "" }, set: { baseId = $0 })) {
            ForEach(options) { option in Text(option.label).tag(option.id) }
          }
        }
      }
      Section("Agent") {
        Picker("Agent", selection: $provider) {
          ForEach(agents) { agent in Text(agent.name).tag(agent.id) }
        }
      }
      Section("What should the agent do?") {
        TextField("Describe the task. Dictation works here.", text: $prompt, axis: .vertical)
          .lineLimit(4...12)
      }
      if let error {
        Section { Text(error).foregroundStyle(Palette.dangerText) }
      }
      Section {
        Button(busy ? "Creating…" : "Create task") { Task { await create() } }
          .disabled(busy || base == nil || provider.isEmpty || defaults == nil)
      }
    }
    .scrollContentBackground(.hidden)
    // Readable column on iPad and in wide windows.
    .frame(maxWidth: Self.maxFormWidth)
    .frame(maxWidth: .infinity)
    .background(QuietBackground().ignoresSafeArea())
    .navigationTitle("New task")
    .task { await load() }
    .onChange(of: projectId) { Task { await loadBranches() } }
    // The connection was replaced (reconnect): the branch follower died with the old one.
    .onChange(of: model.phase) { _, phase in
      if phase == .online, refs == nil { Task { await loadBranches() } }
    }
    .onDisappear { Task { await refsFollower?.stop() } }
  }

  private func load() async {
    guard let connection = model.connection else { return }
    if projectId.isEmpty, let first = model.projects.first { projectId = first.id }
    agents = (try? await connection.call("agents.listMetadata").decode()) ?? []
    defaults = try? await connection.call("mobile.taskDefaults").decode()
    if provider.isEmpty { provider = defaults?.defaultAgent ?? agents.first?.id ?? "" }
  }

  private func loadBranches() async {
    branchLoad += 1
    let load = branchLoad
    await refsFollower?.stop()
    refsFollower = nil
    refs = nil
    defaultBranch = nil
    baseId = ""
    branchError = nil
    guard let connection = model.connection, !projectId.isEmpty else {
      branchError = "Emdash is out of reach. Try again once it is back."
      return
    }
    let follower = LiveStateFollower(
      connection: connection,
      topic: WireTopic.encode(MobileEndpoints.branchRefs, key: ["projectId": .string(projectId)])
    ) { value in Task { @MainActor in if load == branchLoad { refs = value } } }
    refsFollower = follower
    // The list arrives through the follower; a load that never answers ends in an error.
    Task {
      try? await Task.sleep(for: Self.branchTimeout)
      if load == branchLoad, refs == nil, branchError == nil {
        branchError = "The branches did not load."
      }
    }
    do {
      try await follower.start()
    } catch {
      if load == branchLoad { branchError = "The branches did not load: \(error.localizedDescription)" }
      return
    }
    if let data = try? await connection.callResult(
      "sourceControl.repository.getDefaultBranch",
      ["projectId": .string(projectId), "remote": "origin"]),
      load == branchLoad
    {
      defaultBranch = data["branch"]?.stringValue
    }
  }

  private func create() async {
    guard let connection = model.connection, let base, let defaults, !busy else { return }
    if prompt.trimmingCharacters(in: .whitespaces).hasPrefix("-") {
      error = "Start the prompt with a word, not \"-\"."
      return
    }
    busy = true
    error = nil
    defer { busy = false }
    let generated =
      (try? await connection.call(
        "tasks.generateTaskName", ["description": .string(String(prompt.prefix(2_000)))]))?
      .stringValue ?? ""
    let name = generated.trimmingCharacters(in: .whitespaces).isEmpty
      ? NewTask.fallbackName(prompt: prompt) : generated
    let input = NewTask.createTaskInput(
      projectId: projectId, taskName: name, base: base, provider: provider, prompt: prompt,
      defaults: defaults, suffix: suffix, taskId: UUID().uuidString.lowercased(),
      conversationId: UUID().uuidString.lowercased())
    do {
      let data = try await connection.callResult("tasks.createTask", input)
      guard let task = data["task"], let taskId = task["id"]?.stringValue else { return }
      if let workspaceId = task["workspaceId"]?.stringValue {
        Task { try? await model.provision(workspaceId: workspaceId, taskId: taskId) }
      }
      await refsFollower?.stop()
      onCreated(projectId, taskId)
    } catch {
      self.error = error.localizedDescription
    }
  }
}
