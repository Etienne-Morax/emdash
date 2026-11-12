import MoraxCodeKit
import MoraxDesign
import MoraxWire
import SwiftUI

/// A chat (ACP) conversation: recent transcript, live reply, permission requests, prompt.
@MainActor @Observable
final class ChatSession {
  private(set) var lines: [ChatLine] = []
  private(set) var state: JSONValue?
  var error: String?
  let conversationId: String
  private let taskId: String
  private let workspaceId: String?
  private weak var model: AppModel?
  private var follower: LiveStateFollower?
  private var lastTurnKey = ""

  static let historyPage = 50

  init(model: AppModel, conversationId: String, taskId: String, workspaceId: String?) {
    self.model = model
    self.conversationId = conversationId
    self.taskId = taskId
    self.workspaceId = workspaceId
  }

  var permissions: [PermissionRequest] { ChatTranscript.permissions(state: state) }
  var liveText: String { ChatTranscript.liveText(state: state) }
  var isGenerating: Bool { state?["isGenerating"]?.boolValue == true }

  func start() async {
    guard let model, let connection = model.connection else { return }
    do {
      if let workspaceId { try await model.provision(workspaceId: workspaceId, taskId: taskId) }
      _ = try await connection.callResult(
        "conversations.acp.attach", ["conversationId": .string(conversationId)])
      let follower = LiveStateFollower(
        connection: connection,
        topic: WireTopic.encode(
          MobileEndpoints.acpSession, key: ["conversationId": .string(conversationId)])
      ) { [weak self] value in Task { @MainActor in self?.stateChanged(value) } }
      self.follower = follower
      try await follower.start()
      await reload()
    } catch {
      self.error = error.localizedDescription
    }
  }

  func stop() async { await follower?.stop() }

  private func stateChanged(_ value: JSONValue) {
    state = value
    // Refresh the transcript whenever a turn settles or the agent starts/stops working.
    let key = "\(value["transcript"]?["lastCommittedTurnSeq"]?.serialized() ?? ""):\(isGenerating)"
    if key != lastTurnKey {
      lastTurnKey = key
      Task { await reload() }
    }
  }

  func reload() async {
    guard let connection = model?.connection,
      let page = try? await connection.callResult(
        "conversations.acp.loadHistory",
        ["conversationId": .string(conversationId), "limit": .number(Double(Self.historyPage))]),
      page["kind"] == "available"
    else { return }
    lines = ChatTranscript.lines(turns: page["turns"]?.arrayValue ?? [])
  }

  func send(_ text: String) async {
    do {
      _ = try await model?.connection?.callResult(
        "conversations.acp.sendPrompt",
        [
          "conversationId": .string(conversationId),
          "promptId": .string(UUID().uuidString.lowercased()), "prompt": ["text": .string(text)],
        ])
    } catch {
      self.error = "The message was not sent."
    }
  }

  func resolve(_ request: PermissionRequest, option: PermissionRequest.Option) async {
    do {
      _ = try await model?.connection?.callResult(
        "conversations.acp.resolvePermission",
        [
          "conversationId": .string(conversationId), "requestId": .string(request.id),
          "optionId": .string(option.id),
        ])
    } catch {
      self.error = "The answer was not delivered."
    }
  }

  func cancel() async {
    _ = try? await model?.connection?.call(
      "conversations.acp.cancelTurn", ["conversationId": .string(conversationId)])
  }
}

struct ChatPanel: View {
  @State var session: ChatSession
  @State private var draft = ""

  var body: some View {
    VStack(spacing: 10) {
      ScrollViewReader { proxy in
        ScrollView {
          LazyVStack(alignment: .leading, spacing: 10) {
            ForEach(session.lines) { line in
              switch line {
              case .message(_, let role, let text):
                Text(text)
                  .textSelection(.enabled)
                  .padding(12)
                  .frame(maxWidth: .infinity, alignment: role == "user" ? .trailing : .leading)
                  .glassCard(tint: role == "user" ? Palette.accent : nil)
              case .tool(_, let title):
                Label(title, systemImage: "hammer").font(.moraxCaption).foregroundStyle(.secondary)
              }
            }
            if !session.liveText.isEmpty {
              Text(session.liveText).padding(12).glassCard().id("live")
            }
          }
        }
        .onChange(of: session.lines.count) { proxy.scrollTo(session.lines.last?.id, anchor: .bottom) }
      }
      ForEach(session.permissions) { request in
        VStack(alignment: .leading, spacing: 10) {
          Text("Permission").moraxEyebrowStyle()
          Text(request.title).font(.moraxHeadline)
          HStack {
            ForEach(request.options) { option in
              Button(option.name) { Task { await session.resolve(request, option: option) } }
                .buttonStyle(.borderedProminent)
                .tint(option.isAllow ? Palette.success : Palette.danger)
            }
          }
        }
        .padding(14)
        .glassCard(tint: Palette.accent)
      }
      if let error = session.error {
        Text(error).font(.callout).foregroundStyle(Palette.dangerText)
      }
      HStack(alignment: .bottom, spacing: 8) {
        TextField("Message to the agent", text: $draft, axis: .vertical)
          .lineLimit(1...5)
          .padding(10)
          .background(.thinMaterial, in: .rect(cornerRadius: 12))
        if session.isGenerating {
          Button { Task { await session.cancel() } } label: {
            Image(systemName: "stop.circle.fill").font(.title)
          }
          .accessibilityLabel("Stop")
        }
        Button {
          let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
          guard !text.isEmpty else { return }
          draft = ""
          Task { await session.send(text) }
        } label: {
          Image(systemName: "arrow.up.circle.fill").font(.title)
        }
        .accessibilityLabel("Send")
      }
    }
    .task { await session.start() }
    .onDisappear { Task { await session.stop() } }
  }
}
