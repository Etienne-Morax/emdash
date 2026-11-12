import MoraxCodeKit
import MoraxDesign
import MoraxWire
import SwiftUI

/// One task: its conversations (terminal agent or chat), stop and resume.
struct TaskScreen: View {
  let projectId: String
  let taskId: String
  @Environment(AppModel.self) private var model
  @State private var selected: String?
  /// Bumped to rebuild the terminal, which re-hydrates (resumes) the agent.
  @State private var generation = 0

  var body: some View {
    let conversations = model.conversations(forTask: taskId)
    let activeId =
      selected.flatMap { id in conversations.contains { $0.id == id } ? id : nil }
      ?? TaskBoard.defaultConversation(conversations)
    let active = conversations.first { $0.id == activeId }
    let task = model.task(projectId, taskId)

    ZStack {
      QuietBackground().ignoresSafeArea()
      VStack(alignment: .leading, spacing: 12) {
        OfflineBanner()
        if let row = model.board.first(where: { $0.taskId == taskId }) {
          HStack {
            StatusPill(status: row.status)
            MachineChip(name: row.machineName, color: row.machineColor)
          }
        }
        if conversations.count > 1 {
          Picker("Conversation", selection: Binding(get: { activeId ?? "" }, set: { selected = $0 })) {
            ForEach(conversations) { conversation in
              Text(conversation.title).tag(conversation.id)
            }
          }
          .pickerStyle(.segmented)
        }
        if let active {
          if active.isChat {
            ChatPanel(
              session: ChatSession(
                model: model, conversationId: active.id, taskId: taskId,
                workspaceId: task?.workspaceId)
            )
            .id(active.id)
          } else {
            TerminalPanel(
              session: TerminalSession(
                model: model, projectId: projectId, taskId: taskId, conversationId: active.id,
                workspaceId: task?.workspaceId)
            )
            .id("\(active.id):\(generation)")
          }
        } else {
          EmptyStateView(symbol: "bubble.left.and.text.bubble.right", title: "No conversation")
        }
      }
      .padding(.horizontal, 12)
    }
    .navigationTitle(task?.name ?? "Task")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      if let active, !active.isChat {
        ToolbarItem(placement: .topBarTrailing) {
          Menu {
            Button("Stop agent", systemImage: "stop.circle") {
              Task {
                _ = try? await model.connection?.call(
                  "conversations.tui.stop", ["conversationId": .string(active.id)])
              }
            }
            Button("Resume", systemImage: "arrow.clockwise") { generation += 1 }
          } label: {
            Label("Agent", systemImage: "ellipsis.circle")
          }
        }
      }
    }
    .onChange(of: activeId, initial: true) { _, id in
      if let id { model.markSeen(id) }
    }
  }
}
