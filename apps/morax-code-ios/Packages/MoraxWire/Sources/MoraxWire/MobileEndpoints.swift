/// The mobile contract endpoints the app uses (`mobileWireContract` on the desktop).
/// Checked against `Fixtures/mobile-contract.json`, which the desktop tests generate.
public enum MobileEndpoints {
  public static let procedures = [
    "mobile.session", "mobile.machines", "mobile.appearance", "mobile.taskDefaults",
    "mobile.colors",
    "mobile.pullRequests.forBranch", "mobile.pullRequests.create",
    "tasks.createTask", "tasks.generateTaskName", "agents.listMetadata",
    "sourceControl.repository.getDefaultBranch", "sourceControl.checkout.getChangedFiles",
    "sourceControl.checkout.getFile", "sourceControl.checkout.getLog",
    "conversations.getConversationsForProject", "conversations.markConversationSeen",
    "conversations.hydrateConversation", "conversations.tui.sendInput",
    "conversations.tui.resize", "conversations.tui.stop", "conversations.acp.sendPrompt",
    "conversations.acp.cancelTurn", "conversations.acp.resolvePermission",
    "conversations.acp.loadHistory",
  ]
  public static let projectList = "projects.projectList.list"
  public static let taskList = "tasks.taskList.list"
  public static let hostAvailability = "hosts.availability.state"
  public static let branchRefs = "sourceControl.repository.model.refs"
  public static let checkoutHead = "sourceControl.checkout.model.head"
  public static let acpSession = "conversations.acp.session.state"
  public static let terminalOutput = "conversations.tui.output"
  public static let conversationEvents = "conversations.events"
  public static let provision = "workspaces.provision"
  public static let publish = "sourceControl.checkout.publish"
}
