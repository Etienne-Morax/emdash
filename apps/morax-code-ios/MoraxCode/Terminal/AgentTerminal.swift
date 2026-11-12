import MoraxCodeKit
import MoraxWire
import SwiftTerm
import SwiftUI
import UIKit

/// A read-only SwiftTerm view: the phone types through the composer and key bar, never into
/// the terminal itself (iOS dictation duplicates words in terminal emulators).
final class DisplayTerminalView: TerminalView {
  override var canBecomeFirstResponder: Bool { false }
}

/// The agent's live terminal: hydrates (starts or resumes) the agent with the desktop's
/// launch config, takes the PTY size while watching, and streams the output log.
@MainActor @Observable
final class TerminalSession {
  enum State: Equatable { case starting, live, failed(String) }

  private(set) var state: State = .starting
  let conversationId: String
  private let projectId: String
  private let taskId: String
  private let workspaceId: String?
  private weak var model: AppModel?
  private var follower: LiveLogFollower?
  private var size: (cols: Int, rows: Int) = (80, 24)
  weak var view: DisplayTerminalView?

  init(model: AppModel, projectId: String, taskId: String, conversationId: String, workspaceId: String?) {
    self.model = model
    self.projectId = projectId
    self.taskId = taskId
    self.conversationId = conversationId
    self.workspaceId = workspaceId
  }

  func start() async {
    guard let model, let connection = model.connection else {
      state = .failed("Emdash is out of reach.")
      return
    }
    do {
      if let workspaceId { try await model.provision(workspaceId: workspaceId, taskId: taskId) }
      _ = try await connection.callResult(
        "conversations.hydrateConversation",
        [
          "projectId": .string(projectId), "taskId": .string(taskId),
          "conversationId": .string(conversationId),
          "initialSize": ["cols": .number(Double(size.cols)), "rows": .number(Double(size.rows))],
        ])
      await resize(cols: size.cols, rows: size.rows)
      let follower = LiveLogFollower(
        connection: connection,
        topic: WireTopic.encode(
          MobileEndpoints.terminalOutput, key: ["conversationId": .string(conversationId)]),
        onReset: { [weak self] text in Task { @MainActor in self?.reset(text) } },
        onChunk: { [weak self] chunk in Task { @MainActor in self?.feed(chunk) } })
      self.follower = follower
      try await follower.start()
      state = .live
    } catch {
      state = .failed(error.localizedDescription)
    }
  }

  func stop() async {
    await follower?.stop()
    follower = nil
  }

  private func reset(_ text: String) {
    guard let view else { return }
    view.getTerminal().resetToInitialState()
    view.feed(text: text)
  }

  private func feed(_ chunk: String) { view?.feed(text: chunk) }

  func resize(cols: Int, rows: Int) async {
    guard cols > 0, rows > 0 else { return }
    size = (cols, rows)
    _ = try? await model?.connection?.call(
      "conversations.tui.resize",
      [
        "conversationId": .string(conversationId), "cols": .number(Double(cols)),
        "rows": .number(Double(rows)),
      ])
  }

  func send(_ data: String) async {
    _ = try? await model?.connection?.call(
      "conversations.tui.sendInput", ["conversationId": .string(conversationId), "data": .string(data)])
  }

  func stopAgent() async {
    _ = try? await model?.connection?.call(
      "conversations.tui.stop", ["conversationId": .string(conversationId)])
  }
}

struct TerminalHost: UIViewRepresentable {
  let session: TerminalSession

  func makeUIView(context: Context) -> DisplayTerminalView {
    let view = DisplayTerminalView(frame: .zero)
    view.terminalDelegate = context.coordinator
    view.nativeBackgroundColor = UIColor(red: 0.03, green: 0.04, blue: 0.12, alpha: 1)
    view.nativeForegroundColor = UIColor(white: 0.92, alpha: 1)
    view.font = UIFont.monospacedSystemFont(ofSize: 11, weight: .regular)
    session.view = view
    return view
  }

  func updateUIView(_ view: DisplayTerminalView, context: Context) {}

  func makeCoordinator() -> Coordinator { Coordinator(session: session) }

  final class Coordinator: NSObject, TerminalViewDelegate {
    let session: TerminalSession
    init(session: TerminalSession) { self.session = session }

    func sizeChanged(source: TerminalView, newCols: Int, newRows: Int) {
      let session = session
      Task { @MainActor in await session.resize(cols: newCols, rows: newRows) }
    }
    func send(source: TerminalView, data: ArraySlice<UInt8>) {}
    func setTerminalTitle(source: TerminalView, title: String) {}
    func hostCurrentDirectoryUpdate(source: TerminalView, directory: String?) {}
    func scrolled(source: TerminalView, position: Double) {}
    func requestOpenLink(source: TerminalView, link: String, params: [String: String]) {}
    func bell(source: TerminalView) {}
    func clipboardCopy(source: TerminalView, content: Data) {
      UIPasteboard.general.string = String(data: content, encoding: .utf8)
    }
    func iTermContent(source: TerminalView, content: ArraySlice<UInt8>) {}
    func rangeChanged(source: TerminalView, startY: Int, endY: Int) {}
  }
}

/// Terminal, special keys and the dictation-friendly composer.
struct TerminalPanel: View {
  @State var session: TerminalSession
  @State private var draft = ""
  @FocusState private var composerFocused: Bool

  var body: some View {
    VStack(spacing: 10) {
      ZStack {
        TerminalHost(session: session)
          .clipShape(.rect(cornerRadius: 14))
        switch session.state {
        case .starting: ProgressView("Starting the agent…")
        case .failed(let message): ErrorNoteView(message: message)
        case .live: EmptyView()
        }
      }
      .frame(maxHeight: .infinity)
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 6) {
          ForEach(SpecialKey.all) { key in
            Button(key.label) { Task { await session.send(key.data) } }
              .font(.system(.callout, design: .monospaced))
              .buttonStyle(.bordered)
              .accessibilityLabel(key.accessibilityLabel)
          }
        }
      }
      HStack(alignment: .bottom, spacing: 8) {
        TextField("Message to the agent", text: $draft, axis: .vertical)
          .lineLimit(1...5)
          .focused($composerFocused)
          .padding(10)
          .background(.thinMaterial, in: .rect(cornerRadius: 12))
          .accessibilityLabel("Message to the agent")
        Button {
          let writes = Composer.writes(draft, submit: true)
          draft = ""
          Task { for write in writes { await session.send(write) } }
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

struct ErrorNoteView: View {
  let message: String
  var body: some View {
    Text(message)
      .font(.callout)
      .padding(14)
      .background(.thinMaterial, in: .rect(cornerRadius: 12))
  }
}
