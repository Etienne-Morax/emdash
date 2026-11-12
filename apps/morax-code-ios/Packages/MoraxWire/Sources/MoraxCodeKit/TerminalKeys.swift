/// Keys a phone keyboard lacks, as the bytes a terminal expects.
public struct SpecialKey: Identifiable, Sendable, Equatable {
  public let id: String
  public let label: String
  public let accessibilityLabel: String
  public let data: String

  public static let all: [SpecialKey] = [
    SpecialKey(id: "esc", label: "Esc", accessibilityLabel: "Escape", data: "\u{1B}"),
    SpecialKey(id: "tab", label: "Tab", accessibilityLabel: "Tab", data: "\t"),
    SpecialKey(id: "shift-tab", label: "⇧Tab", accessibilityLabel: "Shift Tab", data: "\u{1B}[Z"),
    SpecialKey(id: "up", label: "↑", accessibilityLabel: "Up arrow", data: "\u{1B}[A"),
    SpecialKey(id: "down", label: "↓", accessibilityLabel: "Down arrow", data: "\u{1B}[B"),
    SpecialKey(id: "left", label: "←", accessibilityLabel: "Left arrow", data: "\u{1B}[D"),
    SpecialKey(id: "right", label: "→", accessibilityLabel: "Right arrow", data: "\u{1B}[C"),
    SpecialKey(id: "ctrl-c", label: "^C", accessibilityLabel: "Control C", data: "\u{03}"),
    SpecialKey(id: "enter", label: "⏎", accessibilityLabel: "Return", data: "\r"),
  ]
}

public enum Composer {
  /// Turns composer text into PTY writes. The text goes first, Enter separately: agent TUIs
  /// treat a write ending in "\r" as a paste and would not submit it. Dictation and smart
  /// punctuation produce curly quotes and non-breaking spaces; they are normalized so shell
  /// commands typed by voice still run. Line breaks become "\r".
  public static func writes(_ text: String, submit: Bool) -> [String] {
    let normalized = text
      .replacingOccurrences(of: "\r\n", with: "\r")
      .replacingOccurrences(of: "\n", with: "\r")
      .map { character -> String in
        switch character {
        case "\u{2018}", "\u{2019}": "'"
        case "\u{201C}", "\u{201D}": "\""
        case "\u{00A0}": " "
        default: String(character)
        }
      }
      .joined()
    var writes: [String] = []
    if !normalized.isEmpty { writes.append(normalized) }
    if submit { writes.append("\r") }
    return writes
  }
}
