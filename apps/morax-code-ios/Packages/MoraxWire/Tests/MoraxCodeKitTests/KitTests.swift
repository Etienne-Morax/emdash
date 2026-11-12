import Foundation
import MoraxWire
import Testing
@testable import MoraxCodeKit

@Suite struct GatewayAddressTests {
  @Test func acceptsATailnetNameWithOrWithoutScheme() throws {
    let bare = try GatewayAddress.parse("My-Mac.tail1234.ts.net:8443").get()
    #expect(bare.absoluteString == "https://my-mac.tail1234.ts.net:8443/")
    #expect(GatewayAddress.origin(of: bare) == "https://my-mac.tail1234.ts.net:8443")
    #expect(GatewayAddress.wireURL(of: bare).absoluteString == "wss://my-mac.tail1234.ts.net:8443/wire")
  }

  @Test func refusesAnythingOutsideTheTailnetOrNotHTTPS() {
    #expect(GatewayAddress.parse("") == .failure(.empty))
    #expect(GatewayAddress.parse("http://my-mac.tail1234.ts.net:8443") == .failure(.notHTTPS))
    #expect(GatewayAddress.parse("https://example.com") == .failure(.notTailnet))
    #expect(GatewayAddress.parse("https://my-mac.ts.net.evil.com") == .failure(.notTailnet))
    #expect(GatewayAddress.parse("https://user:pw@my-mac.tail1234.ts.net") == .failure(.invalid))
  }
}

@Suite struct PairingLinkTests {
  @Test func readsTheDesktopQRCode() throws {
    let link = try #require(
      PairingLink.parse(
        "moraxcode://pair?gateway=https%3A%2F%2Fmac.tail1.ts.net%3A8443&code=abcd-2345"))
    #expect(link.gateway.absoluteString == "https://mac.tail1.ts.net:8443/")
    #expect(link.code == "ABCD2345")
  }

  @Test func refusesOtherSchemesAndPublicHosts() {
    #expect(PairingLink.parse("https://mac.tail1.ts.net/?code=x") == nil)
    #expect(PairingLink.parse("moraxcode://pair?gateway=https://evil.com&code=ABCD") == nil)
    #expect(PairingLink.parse("moraxcode://pair?gateway=https://mac.tail1.ts.net") == nil)
  }
}

@Suite struct GatewayHTTPTests {
  @Test func readsTheTokenFromTheCookieAndSendsItAsBearer() throws {
    let response = HTTPURLResponse(
      url: URL(string: "https://mac.tail1.ts.net/api/pair")!, statusCode: 200, httpVersion: nil,
      headerFields: ["Set-Cookie": "emdash_mobile_token=t0k3n; Path=/; HttpOnly; Secure"])!
    #expect(GatewayHTTP.token(from: response) == "t0k3n")
    let headers = GatewayHTTP.headers(gateway: URL(string: "https://mac.tail1.ts.net:8443/")!, token: "t0k3n")
    #expect(headers == ["Origin": "https://mac.tail1.ts.net:8443", "Authorization": "Bearer t0k3n"])
  }
}

@Suite struct TaskBoardTests {
  let project = Project(id: "p", name: "demo", type: "ssh", path: "/srv/demo", connectionId: "m5")
  func task(_ id: String, updated: String) -> TaskRow {
    TaskRow(id: id, projectId: "p", name: id, type: "task", archivedAt: nil, workspaceId: "w",
            lastInteractedAt: nil, updatedAt: updated)
  }
  func conversation(_ task: String, _ status: AgentStatus, seen: Bool) -> Conversation {
    Conversation(id: "c-\(task)", projectId: "p", taskId: task, title: "Claude", providerId: "claude",
                 lastInteractedAt: nil, isInitialConversation: true, agentStatus: status,
                 agentStatusSeen: seen, type: "pty")
  }

  @Test func putsWaitingTasksFirstThenRecentOnes() {
    let rows = TaskBoard.rows(
      projects: [project],
      tasksByProject: ["p": [
        task("old", updated: "2026-11-10T10:00:00Z"), task("recent", updated: "2026-11-12T10:00:00Z"),
        task("asks", updated: "2026-11-01T10:00:00Z"),
      ]],
      conversations: [conversation("asks", .awaitingInput, seen: false)],
      machines: [Machine(id: "m5", kind: "remote", name: "M5 Max")],
      colors: Colors(projects: ["p": "#123456"], machines: ["m5": "#abcdef"], localMachine: "#000"),
      localName: "M1 Max")
    #expect(rows.map(\.taskId) == ["asks", "recent", "old"])
    #expect(rows[0].status == .awaitingInput)
    #expect(rows[0].machineName == "M5 Max")
    #expect(rows[0].machineColor == "#abcdef")
    #expect(rows[0].projectColor == "#123456")
  }
}

@Suite struct NewTaskTests {
  let refs: JSONValue = [
    "branches": [
      ["type": "local", "ref": "refs/heads/main"],
      ["type": "remote", "ref": "refs/remotes/origin/main", "remote": ["name": "origin", "url": "git@x:o/r"]],
      ["type": "remote", "ref": "refs/remotes/origin/dev", "remote": ["name": "origin", "url": "git@x:o/r"]],
      ["type": "remote", "ref": "refs/remotes/origin/HEAD", "remote": ["name": "origin", "url": "git@x:o/r"]],
    ]
  ]

  @Test func listsLocalBranchesThenRemoteOnlyOnes() {
    let options = NewTask.baseBranches(refs: refs)
    #expect(options.map(\.label) == ["main", "origin/dev"])
    #expect(NewTask.defaultBase(options, defaultBranch: "main")?.label == "main")
  }

  @Test func namesBranchesLikeTheDesktop() {
    let defaults = TaskDefaults(defaultAgent: "claude", branchPrefix: "/emdash/", appendRandomBranchSuffix: true)
    #expect(NewTask.branchName(taskName: "fix-login", defaults: defaults, suffix: "ab12c") == "emdash/fix-login-ab12c")
    let plain = TaskDefaults(defaultAgent: "claude", branchPrefix: "", appendRandomBranchSuffix: false)
    #expect(NewTask.branchName(taskName: "fix-login", defaults: plain, suffix: "x") == "fix-login")
    #expect(NewTask.fallbackName(prompt: "Fix the login page, please now!") == "fix-the-login-page-please")
    #expect(NewTask.fallbackName(prompt: "   ") == "mobile-task")
  }

  @Test func buildsTheDesktopCreateTaskInput() {
    let base = NewTask.baseBranches(refs: refs)[1]
    let defaults = TaskDefaults(defaultAgent: "claude", branchPrefix: "emdash", appendRandomBranchSuffix: true)
    let input = NewTask.createTaskInput(
      projectId: "p", taskName: "fix", base: base, provider: "claude", prompt: "  Fix it  ",
      defaults: defaults, suffix: "abcde", taskId: "t", conversationId: "c")
    #expect(input["workspaceConfig"]?["git"]?["branchName"] == "emdash/fix-abcde")
    #expect(input["workspaceConfig"]?["git"]?["fromBranch"] == [
      "type": "remote", "branch": "dev", "remote": ["name": "origin", "url": "git@x:o/r"],
    ])
    #expect(input["taskConfig"]?["initialConversation"]?["initialPrompt"] == "Fix it")
  }
}

@Suite struct ComposerTests {
  @Test func sendsTextThenEnterAndNormalizesDictation() {
    #expect(Composer.writes("say \u{201C}hi\u{201D}\u{00A0}it\u{2019}s\nok", submit: true)
            == ["say \"hi\" it's\rok", "\r"])
    #expect(Composer.writes("", submit: true) == ["\r"])
    #expect(Composer.writes("x", submit: false) == ["x"])
  }

  @Test func specialKeysMatchTerminalSequences() {
    let keys = Dictionary(uniqueKeysWithValues: SpecialKey.all.map { ($0.id, $0.data) })
    #expect(keys["shift-tab"] == "\u{1B}[Z")
    #expect(keys["ctrl-c"] == "\u{03}")
    #expect(keys["enter"] == "\r")
  }
}

@Suite struct ChatTranscriptTests {
  @Test func flattensTurnsIntoMessagesAndToolCalls() {
    let turns: [JSONValue] = [
      ["id": "t2", "seq": 2, "items": [["kind": "message", "id": "m3", "role": "assistant", "text": "Done."]]],
      ["id": "t1", "seq": 1, "items": [
        ["kind": "message", "id": "m1", "role": "user", "text": "Fix it"],
        ["kind": "message", "id": "m2", "role": "assistant", "text": "  "],
        ["toolCall": ["id": "x", "title": "Edit app.ts"]],
      ]],
    ]
    #expect(ChatTranscript.lines(turns: turns) == [
      .message(id: "t1:m1", role: "user", text: "Fix it"),
      .tool(id: "t1:x", title: "Edit app.ts"),
      .message(id: "t2:m3", role: "assistant", text: "Done."),
    ])
  }

  @Test func readsPermissionsAndLiveText() {
    let state: JSONValue = [
      "isGenerating": true,
      "transcript": ["activeTurn": ["items": [["kind": "message", "role": "assistant", "text": "Work"]]]],
      "pendingPermissions": [[
        "requestId": "r1", "toolCall": ["title": "Run tests"],
        "options": [["optionId": "a", "name": "Allow", "kind": "allow_once"],
                    ["optionId": "d", "name": "Reject", "kind": "reject_once"]],
      ]],
    ]
    #expect(ChatTranscript.liveText(state: state) == "Work")
    let request = ChatTranscript.permissions(state: state).first
    #expect(request?.title == "Run tests")
    #expect(request?.options.map(\.isAllow) == [true, false])
  }
}

@Suite struct AppLinkTests {
  @Test func readsTaskAndNewTaskLinks() {
    #expect(AppLink.parse(URL(string: "moraxcode://task/p%201/t2")!) == .task(projectId: "p 1", taskId: "t2"))
    #expect(AppLink.parse(URL(string: "moraxcode://new")!) == .newTask)
    #expect(AppLink.parse(URL(string: "moraxcode://task/p1")!) == nil)
    #expect(AppLink.parse(URL(string: "https://task/p/t")!) == nil)
  }
}
