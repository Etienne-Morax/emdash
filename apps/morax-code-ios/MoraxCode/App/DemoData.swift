#if DEBUG
  import Foundation
  import MoraxCodeKit

  /// Sample board for simulator screenshots and layout checks without a paired Mac
  /// (`simctl launch … -MoraxDemo YES`). Debug builds only.
  enum DemoData {
    static let projects: [Project] = decode(
      """
      [{"id":"p1","name":"emdash","type":"local","path":"/demo/emdash"},
       {"id":"p2","name":"morax-os","type":"local","path":"/demo/morax-os"},
       {"id":"p3","name":"speak-like-jess","type":"ssh","path":"/demo/jess","connectionId":"m5"}]
      """)

    static let tasks: [String: [TaskRow]] = [
      "p1": decode(
        """
        [{"id":"t1","projectId":"p1","name":"iPad split view","lastInteractedAt":"2026-11-12T18:00:00Z"},
         {"id":"t2","projectId":"p1","name":"Review the gateway audit log","lastInteractedAt":"2026-11-12T17:00:00Z"}]
        """),
      "p2": decode(
        """
        [{"id":"t3","projectId":"p2","name":"Radar: weekly digest","lastInteractedAt":"2026-11-12T16:00:00Z"}]
        """),
      "p3": decode(
        """
        [{"id":"t4","projectId":"p3","name":"Fix lesson streak reset","lastInteractedAt":"2026-11-12T15:00:00Z"}]
        """),
    ]

    static let conversations: [Conversation] = decode(
      """
      [{"id":"c1","projectId":"p1","taskId":"t1","title":"Claude Code","isInitialConversation":true,
        "agentStatus":"awaiting-input","agentStatusSeen":false,"type":"pty"},
       {"id":"c2","projectId":"p1","taskId":"t2","title":"Codex","isInitialConversation":true,
        "agentStatus":"working","type":"pty"},
       {"id":"c3","projectId":"p2","taskId":"t3","title":"Claude Code","isInitialConversation":true,
        "agentStatus":"completed","agentStatusSeen":false,"type":"pty"},
       {"id":"c4","projectId":"p3","taskId":"t4","title":"Claude Code","isInitialConversation":true,
        "agentStatus":"error","agentStatusSeen":false,"type":"pty"}]
      """)

    static let machines: [Machine] = decode(#"[{"id":"m5","kind":"ssh","name":"M5 Max"}]"#)

    static let colors: Colors = decode(
      """
      {"projects":{"p1":"#f5a524","p2":"#7c8cff","p3":"#3ccf91"},
       "machines":{"m5":"#c084fc"},"localMachine":"#38bdf8"}
      """)

    private static func decode<T: Decodable>(_ json: String) -> T {
      // Static sample data: a decoding failure is a programming error caught on first launch.
      try! JSONDecoder().decode(T.self, from: Data(json.utf8))
    }
  }
#endif
