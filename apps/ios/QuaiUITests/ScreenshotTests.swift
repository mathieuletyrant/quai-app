import XCTest

/// The app paired to the preview server (`pnpm --filter @quai/cloud preview`: the real Quai Cloud
/// and a fake Quai Home answering from the recorded fixtures), photographed tab by tab.
///
/// `QUAI_PREVIEW_URL` (default `http://127.0.0.1:8787`) is where the preview server listens;
/// `QUAI_SCREENSHOTS_DIR`, a folder of the Mac the PNGs are also written to. From xcodebuild, pass
/// them as `TEST_RUNNER_QUAI_PREVIEW_URL` and `TEST_RUNNER_QUAI_SCREENSHOTS_DIR`.
@MainActor
final class ScreenshotTests: XCTestCase {
    private var app: XCUIApplication!

    override func setUp() async throws {
        continueAfterFailure = true
        let link = try await Self.pairingLink()
        app = XCUIApplication()
        app.launchEnvironment["QUAI_PREVIEW_PAIRING"] = link
        app.launch()
        allowNotifications()
    }

    func testTabs() throws {
        XCTAssertTrue(tab("Home").waitForExistence(timeout: 20), "The app didn't pair with the preview server")
        // The Home's tiles load after the pairing.
        _ = app.staticTexts["To fix"].waitForExistence(timeout: 10)
        settle()
        screenshot("01-home")

        tab("Library").tap()
        settle()
        screenshot("02-library")

        tab("Activity").tap()
        settle()
        screenshot("03-activity")

        tab("Settings").tap()
        settle()
        screenshot("04-settings")

        app.buttons["Notifications"].firstMatch.tap()
        settle()
        screenshot("05-settings-notifications")
    }

    func testLiveSheet() throws {
        XCTAssertTrue(tab("Home").waitForExistence(timeout: 20), "The app didn't pair with the preview server")
        let liveBar = app.buttons["liveBar"]
        guard liveBar.waitForExistence(timeout: 20) else {
            screenshot("06-live-bar-missing")
            XCTFail("No live bar: the preview's download didn't reach the app")
            return
        }
        liveBar.tap()
        settle()
        screenshot("06-live-sheet")
    }

    /// Search and request: "dune" from the Library, the results, then Dune (2021) requested on Seerr.
    func testSearch() throws {
        XCTAssertTrue(tab("Home").waitForExistence(timeout: 20), "The app didn't pair with the preview server")
        tab("Library").tap()
        let entry = app.descendants(matching: .any)["searchEntry"].firstMatch
        XCTAssertTrue(entry.waitForExistence(timeout: 10), "No search in the Library")
        entry.tap()
        let field = app.textFields["searchField"]
        XCTAssertTrue(field.waitForExistence(timeout: 10), "No search field")
        field.tap()
        // The return key searches and puts the keyboard away.
        field.typeText("dune\n")
        let request = app.buttons["request-movie:tmdb:438631"]
        guard request.waitForExistence(timeout: 20) else {
            screenshot("07-search-no-results")
            XCTFail("No \"Request on Seerr\" for Dune (2021): the search didn't answer")
            return
        }
        settle()
        screenshot("07-search-results")

        request.tap()
        XCTAssertTrue(app.staticTexts["Requested on Seerr"].waitForExistence(timeout: 15), "Dune wasn't requested")
        settle()
        screenshot("08-search-requested")
    }

    // MARK: Helpers

    private func tab(_ name: String) -> XCUIElement {
        let inTabBar = app.tabBars.buttons[name]
        return inTabBar.exists ? inTabBar : app.buttons[name].firstMatch
    }

    /// Lets loads and animations finish before a screenshot.
    private func settle(_ seconds: TimeInterval = 2) {
        RunLoop.current.run(until: Date().addingTimeInterval(seconds))
    }

    /// The app asks for notifications once paired: Springboard shows the prompt over it.
    private func allowNotifications() {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let allow = springboard.buttons["Allow"]
        if allow.waitForExistence(timeout: 8) { allow.tap() }
    }

    private func screenshot(_ name: String) {
        let shot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        guard let directory = ProcessInfo.processInfo.environment["QUAI_SCREENSHOTS_DIR"] else { return }
        let folder = URL(fileURLWithPath: directory)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try? shot.pngRepresentation.write(to: folder.appendingPathComponent("\(name).png"))
    }

    /// A fresh `quai://pair` link from the preview server's console route, as the console's QR code.
    private static func pairingLink() async throws -> String {
        let base = ProcessInfo.processInfo.environment["QUAI_PREVIEW_URL"] ?? "http://127.0.0.1:8787"
        var request = URLRequest(url: URL(string: "\(base)/console-api/pairing-codes")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["serverUrls": [base]])
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200,
              let body = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let link = body["link"] as? String
        else {
            throw PreviewUnavailable(base: base)
        }
        return link
    }
}

private struct PreviewUnavailable: LocalizedError {
    let base: String
    var errorDescription: String? {
        "The preview server at \(base) didn't give a pairing link. Start it with `pnpm --filter @quai/cloud preview`."
    }
}
