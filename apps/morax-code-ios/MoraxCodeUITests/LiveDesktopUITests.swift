import XCTest

/// Drives the app against a live, paired dev desktop (Emdash with Mobile access, published
/// with `tailscale serve`). Skipped unless `MORAX_LIVE_DESKTOP=1`: it creates a real task.
final class LiveDesktopUITests: XCTestCase {
  override func setUpWithError() throws {
    try XCTSkipUnless(
      ProcessInfo.processInfo.environment["MORAX_LIVE_DESKTOP"] == "1",
      "Needs a paired dev desktop")
    continueAfterFailure = false
  }

  private func shot(_ app: XCUIApplication, _ name: String) {
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }

  func testCreateATaskThenTalkToItsAgent() throws {
    let app = XCUIApplication()
    app.launchArguments = ["-MoraxOpenURL", "moraxcode://new"]
    app.launch()

    let prompt = app.textFields["Describe the task. Dictation works here."]
    XCTAssertTrue(prompt.waitForExistence(timeout: 30))
    prompt.tap()
    prompt.typeText("Reply with the single word ready and wait.")
    shot(app, "new-task")

    let create = app.buttons["Create task"]
    XCTAssertTrue(create.waitForExistence(timeout: 10))
    let deadline = Date().addingTimeInterval(20)
    while !create.isEnabled && Date() < deadline { sleep(1) }
    create.tap()

    let composer = app.textFields["Message to the agent"]
    XCTAssertTrue(composer.waitForExistence(timeout: 60))
    sleep(15)
    shot(app, "terminal")

    composer.tap()
    composer.typeText("hello from Morax Code")
    app.buttons["Send"].tap()
    sleep(6)
    shot(app, "terminal-after-send")

    app.navigationBars.buttons.element(boundBy: 0).tap()
    XCTAssertTrue(app.staticTexts["Agents"].waitForExistence(timeout: 10))
    sleep(2)
    shot(app, "home")
  }
}
