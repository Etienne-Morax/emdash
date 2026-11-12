import MoraxCodeKit
import MoraxDesign
import SwiftUI

@main
struct MoraxCodeApp: App {
  @State private var model = AppModel()
  @Environment(\.scenePhase) private var scenePhase

  var body: some Scene {
    WindowGroup {
      RootView()
        .environment(model)
        .preferredColorScheme(.dark)
        .task {
          #if DEBUG
            if UserDefaults.standard.bool(forKey: "MoraxDemo") {
              model.loadDemo()
            } else {
              await model.boot()
            }
          #else
            await model.boot()
          #endif
          #if DEBUG
            // Simulator scripting (screenshots): `simctl launch … -MoraxOpenURL <link>`.
            if let raw = UserDefaults.standard.string(forKey: "MoraxOpenURL"),
              let url = URL(string: raw)
            {
              open(url)
            }
          #endif
        }
        .onOpenURL(perform: open)
        .onChange(of: scenePhase) { _, phase in
          if phase == .active { Task { await model.resume() } }
        }
    }
    .commands {
      // iPad menu bar and hardware keyboards: ⌘N starts a task.
      CommandGroup(replacing: .newItem) {
        Button("New Task") { model.pendingLink = .newTask }
          .keyboardShortcut("n", modifiers: .command)
          .disabled(model.phase == .loading || model.phase == .unpaired)
      }
    }
  }
}

/// Navigation destinations.
enum Route: Hashable {
  case task(projectId: String, taskId: String)
  case newTask
}

extension MoraxCodeApp {
  /// Pairing QR links pair; task and new-task links navigate.
  private func open(_ url: URL) {
    if let link = PairingLink.parse(url.absoluteString) {
      Task { try? await model.pair(link) }
    } else if let link = AppLink.parse(url) {
      model.pendingLink = link
    }
  }
}

struct RootView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.horizontalSizeClass) private var sizeClass
  /// One navigation state for both layouts, so resizing an iPad window (Split View, Stage
  /// Manager) keeps the open task: a stack on compact widths, a sidebar and a detail on regular.
  @State private var path: [Route] = []

  var body: some View {
    switch model.phase {
    case .loading:
      ZStack { MeshBackground().ignoresSafeArea() }
    case .unpaired:
      PairingView()
    case .online, .offline:
      navigation
        .tint(Palette.accent)
        .onAppear {
          model.notifier.onOpen = { projectId, taskId in
            model.pendingLink = .task(projectId: projectId, taskId: taskId)
          }
        }
        .onChange(of: model.pendingLink, initial: true) { _, link in
          guard let link else { return }
          model.pendingLink = nil
          switch link {
          case .task(let projectId, let taskId): open(.task(projectId: projectId, taskId: taskId))
          case .newTask: open(.newTask)
          }
        }
    }
  }

  @ViewBuilder private var navigation: some View {
    if sizeClass == .regular {
      NavigationSplitView {
        HomeView(selection: path.last, open: open)
          .navigationSplitViewColumnWidth(min: 320, ideal: 380, max: 460)
      } detail: {
        NavigationStack {
          if let route = path.last {
            destination(route).id(route)
          } else {
            EmptyStateView(
              symbol: "rectangle.split.2x1", title: "Choose a task",
              message: "Pick a task in the sidebar, or start one with New task.")
          }
        }
      }
      .navigationSplitViewStyle(.balanced)
    } else {
      NavigationStack(path: $path) {
        HomeView(selection: nil, open: open)
          .navigationDestination(for: Route.self, destination: destination)
      }
    }
  }

  @ViewBuilder private func destination(_ route: Route) -> some View {
    switch route {
    case .task(let projectId, let taskId):
      TaskScreen(projectId: projectId, taskId: taskId)
    case .newTask:
      NewTaskScreen { projectId, taskId in open(.task(projectId: projectId, taskId: taskId)) }
    }
  }

  private func open(_ route: Route) { path = [route] }
}
