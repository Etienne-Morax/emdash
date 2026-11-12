import MoraxCodeKit
import MoraxDesign
import MoraxWire
import SwiftUI

extension Color {
  /// `#rrggbb` from the desktop's colour resolution.
  init(hex: String) {
    let digits = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
    let value = UInt64(digits, radix: 16) ?? 0x8A94A6
    self.init(
      red: Double((value >> 16) & 0xFF) / 255, green: Double((value >> 8) & 0xFF) / 255,
      blue: Double(value & 0xFF) / 255)
  }
}

struct StatusPill: View {
  let status: AgentStatus?

  private var tint: Color {
    switch status {
    case .awaitingInput: Palette.accent
    case .working: Palette.calm
    case .error: Palette.danger
    case .completed: Palette.success
    default: .secondary
    }
  }

  var body: some View {
    HStack(spacing: 6) {
      Circle().fill(tint).frame(width: 8, height: 8)
      Text(TaskBoard.label(status)).font(.moraxCaption.weight(.semibold))
    }
    .padding(.horizontal, 10)
    .padding(.vertical, 5)
    .background(tint.opacity(0.18), in: .capsule)
    .foregroundStyle(status == .awaitingInput ? Palette.accentText : .primary)
    .accessibilityElement(children: .combine)
  }
}

struct MachineChip: View {
  let name: String
  let color: String

  var body: some View {
    HStack(spacing: 6) {
      Circle().fill(Color(hex: color)).frame(width: 8, height: 8)
      Text(name).font(.moraxCaption)
    }
    .padding(.horizontal, 10)
    .padding(.vertical, 5)
    .background(.thinMaterial, in: .capsule)
  }
}

struct OfflineBanner: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    if model.phase == .offline {
      Label(
        "Emdash is out of reach. Is the Mac awake with Emdash open, and Tailscale on?",
        systemImage: "wifi.exclamationmark"
      )
      .font(.moraxCaption)
      .padding(12)
      .frame(maxWidth: .infinity, alignment: .leading)
      .glassCard(tint: Palette.caution)
    }
  }
}
