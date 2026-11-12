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
          await model.boot()
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
  @State private var path: [Route] = []

  var body: some View {
    switch model.phase {
    case .loading:
      ZStack { MeshBackground().ignoresSafeArea() }
    case .unpaired:
      PairingView()
    case .online, .offline:
      NavigationStack(path: $path) {
        HomeView()
          .navigationDestination(for: Route.self) { route in
            switch route {
            case .task(let projectId, let taskId):
              TaskScreen(projectId: projectId, taskId: taskId)
            case .newTask:
              NewTaskScreen { projectId, taskId in
                path = [.task(projectId: projectId, taskId: taskId)]
              }
            }
          }
      }
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
        case .task(let projectId, let taskId): path = [.task(projectId: projectId, taskId: taskId)]
        case .newTask: path = [.newTask]
        }
      }
    }
  }
}
