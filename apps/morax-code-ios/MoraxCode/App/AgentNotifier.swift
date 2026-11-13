import Foundation
import MoraxCodeKit
import MoraxWire
import UserNotifications

/// Local notifications while the app is connected: an agent waits for an answer or has
/// finished. (Remote push needs APNs, a paid developer account and a sender: see README.)
@MainActor
final class AgentNotifier: NSObject, UNUserNotificationCenterDelegate {
  /// The task to open when a notification is tapped (`projectId`, `taskId`).
  var onOpen: ((String, String) -> Void)?

  override init() {
    super.init()
    UNUserNotificationCenter.current().delegate = self
  }

  func requestPermission() async {
    _ = try? await UNUserNotificationCenter.current()
      .requestAuthorization(options: [.alert, .sound, .badge])
  }

  func statusChanged(_ conversation: Conversation, taskName: String) {
    guard conversation.agentStatusSeen == false,
      let body = Self.body(for: conversation.agentStatus)
    else { return }
    let content = UNMutableNotificationContent()
    content.title = taskName
    content.body = body
    content.sound = .default
    content.threadIdentifier = conversation.taskId
    content.userInfo = ["projectId": conversation.projectId, "taskId": conversation.taskId]
    let request = UNNotificationRequest(
      identifier: "agent-\(conversation.id)", content: content, trigger: nil)
    UNUserNotificationCenter.current().add(request)
  }

  static func body(for status: AgentStatus?) -> String? {
    switch status {
    case .awaitingInput: "The agent is waiting for your answer."
    case .completed: "The agent has finished."
    case .error: "The agent stopped with an error."
    default: nil
    }
  }

  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter, willPresent notification: UNNotification
  ) async -> UNNotificationPresentationOptions {
    [.banner, .sound, .list]
  }

  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse
  ) async {
    let info = response.notification.request.content.userInfo
    guard let projectId = info["projectId"] as? String, let taskId = info["taskId"] as? String
    else { return }
    await MainActor.run { onOpen?(projectId, taskId) }
  }
}
