import MoraxCodeKit
import MoraxDesign
import SwiftUI

/// Every machine and every task of every project, waiting-for-you first.
struct HomeView: View {
  /// The route shown next to the list on iPad; nil on iPhone (the stack covers the list).
  let selection: Route?
  let open: (Route) -> Void
  @Environment(AppModel.self) private var model
  @State private var confirmForget = false

  var body: some View {
    ZStack {
      MeshBackground().ignoresSafeArea()
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 16) {
          ScreenHeader("Agents", eyebrow: model.session?.desktopName ?? "Morax Code")
          OfflineBanner()
          machines
          let rows = model.board
          if rows.isEmpty {
            EmptyStateView(
              symbol: "sparkles", title: "No task yet",
              message: "Start an agent with New task.")
          }
          ForEach(rows) { row in
            let route = Route.task(projectId: row.projectId, taskId: row.taskId)
            Button { open(route) } label: {
              TaskCard(row: row, isSelected: selection == route)
            }
            .buttonStyle(.plain)
            .contentShape(.hoverEffect, .rect(cornerRadius: MoraxTokens.Radius.card))
            .hoverEffect(.highlight)
            .accessibilityAddTraits(selection == route ? .isSelected : [])
          }
        }
        .padding(20)
      }
      .refreshable { await model.reloadConversations() }
    }
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        Button { open(.newTask) } label: { Label("New task", systemImage: "plus") }
      }
      ToolbarItem(placement: .topBarLeading) {
        Menu {
          Button("Unpair this device", role: .destructive) { confirmForget = true }
        } label: {
          Label("Settings", systemImage: "ellipsis.circle")
        }
      }
    }
    .confirmationDialog("Unpair this device?", isPresented: $confirmForget) {
      Button("Unpair", role: .destructive) { Task { await model.forget() } }
    } message: {
      Text("The Mac revokes this device. Pair again with a new code.")
    }
  }

  private var machines: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 8) {
        machineCard(model.localName, color: model.colors.localMachine, online: model.phase == .online)
        ForEach(model.machines) { machine in
          machineCard(
            machine.name, color: model.colors.machines[machine.id] ?? model.colors.localMachine,
            online: model.phase == .online && model.machineOnline[machine.id] == true)
        }
      }
    }
  }

  private func machineCard(_ name: String, color: String, online: Bool) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      MachineChip(name: name, color: color)
      Text(online ? "Online" : "Offline")
        .font(.moraxCaption)
        .foregroundStyle(online ? Palette.successText : .secondary)
    }
    .padding(12)
    .glassCard()
    .accessibilityElement(children: .combine)
  }
}

struct TaskCard: View {
  let row: TaskBoardRow
  var isSelected = false

  var body: some View {
    HStack(spacing: 12) {
      RoundedRectangle(cornerRadius: 2).fill(Color(hex: row.projectColor)).frame(width: 4)
      VStack(alignment: .leading, spacing: 8) {
        HStack {
          Text(row.projectName).moraxEyebrowStyle()
          Spacer()
          StatusPill(status: row.status)
        }
        Text(row.taskName).font(.moraxHeadline).lineLimit(2)
        MachineChip(name: row.machineName, color: row.machineColor)
      }
    }
    .padding(14)
    .glassCard(tint: row.status == .awaitingInput ? Palette.accent : nil, interactive: true)
    .overlay {
      if isSelected {
        RoundedRectangle(cornerRadius: MoraxTokens.Radius.card)
          .strokeBorder(Palette.accent, lineWidth: 2)
      }
    }
    .accessibilityElement(children: .combine)
  }
}
