import MoraxWire

/// One line of a chat (ACP) conversation as the phone shows it.
public enum ChatLine: Identifiable, Equatable, Sendable {
  case message(id: String, role: String, text: String)
  case tool(id: String, title: String)

  public var id: String {
    switch self {
    case .message(let id, _, _), .tool(let id, _): id
    }
  }
}

/// A pending tool permission request and its answers.
public struct PermissionRequest: Identifiable, Equatable, Sendable {
  public struct Option: Identifiable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let isAllow: Bool
  }

  public let id: String
  public let title: String
  public let options: [Option]
}

public enum ChatTranscript {
  /// Flattens ACP turns (`conversations.acp.loadHistory`) into messages and one line per tool
  /// call; thinking and notifications are left out.
  public static func lines(turns: [JSONValue]) -> [ChatLine] {
    var lines: [ChatLine] = []
    let ordered = turns.sorted { ($0["seq"]?.numberValue ?? 0) < ($1["seq"]?.numberValue ?? 0) }
    for turn in ordered {
      let turnId = turn["id"]?.stringValue ?? ""
      for (index, item) in (turn["items"]?.arrayValue ?? []).enumerated() {
        if item["kind"] == "message" {
          let text = item["text"]?.stringValue ?? ""
          if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { continue }
          lines.append(
            .message(
              id: "\(turnId):\(item["id"]?.stringValue ?? "\(index)")",
              role: item["role"]?.stringValue ?? "assistant", text: text))
          continue
        }
        let call = item["toolCall"] ?? item
        if let title = call["title"]?.stringValue, !title.isEmpty {
          let key = item["id"]?.stringValue ?? call["id"]?.stringValue ?? "item-\(index)"
          lines.append(.tool(id: "\(turnId):\(key)", title: title))
        }
      }
    }
    return lines
  }

  /// Assistant text streamed in the turn in progress.
  public static func liveText(state: JSONValue?) -> String {
    guard state?["isGenerating"]?.boolValue == true else { return "" }
    return (state?["transcript"]?["activeTurn"]?["items"]?.arrayValue ?? [])
      .filter { $0["kind"] == "message" && $0["role"] == "assistant" }
      .compactMap { $0["text"]?.stringValue }
      .joined()
  }

  public static func permissions(state: JSONValue?) -> [PermissionRequest] {
    (state?["pendingPermissions"]?.arrayValue ?? []).compactMap { request in
      guard let id = request["requestId"]?.stringValue else { return nil }
      let options = (request["options"]?.arrayValue ?? []).compactMap { option -> PermissionRequest.Option? in
        guard let optionId = option["optionId"]?.stringValue else { return nil }
        return PermissionRequest.Option(
          id: optionId, name: option["name"]?.stringValue ?? optionId,
          isAllow: option["kind"]?.stringValue?.hasPrefix("allow") == true)
      }
      return PermissionRequest(
        id: id, title: request["toolCall"]?["title"]?.stringValue ?? "Permission", options: options)
    }
  }
}
