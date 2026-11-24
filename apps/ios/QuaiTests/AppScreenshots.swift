import SwiftUI
import Testing
import UIKit
@testable import Quai

/// Outside the suite: its `@Suite` attribute can't refer to the suite's own members.
private let previewURL = ProcessInfo.processInfo.environment["QUAI_PREVIEW_URL"].flatMap(URL.init(string:))

/// The app paired to the preview server (`pnpm --filter @quai/cloud preview`: the real Quai Cloud
/// and a fake Quai Home answering from the recorded fixtures), photographed screen by screen.
/// The views are hosted in a window of the test host: no UI automation, no app launch per screen.
///
/// `QUAI_PREVIEW_URL` is where the preview server listens (the suite is off without it);
/// `QUAI_SCREENSHOTS_DIR`, a folder of the Mac the PNGs are written to. From xcodebuild, pass them
/// as `TEST_RUNNER_QUAI_PREVIEW_URL` and `TEST_RUNNER_QUAI_SCREENSHOTS_DIR`.
@MainActor
@Suite(.serialized, .enabled(if: previewURL != nil, "needs the preview server"))
struct AppScreenshots {

    @Test func homeLoading() async throws {
        let connection = try await Self.pairedConnection()
        // Long enough for the Home to show its skeleton before any read answers.
        connection.readDelay = .seconds(30)
        let window = try Self.show(RootView(pendingLink: .constant(nil), tab: .home), connection)
        try await Self.settle(1)
        Self.screenshot(window, "00-home-loading")
    }

    @Test func home() async throws {
        let connection = try await Self.pairedConnection()
        let window = try Self.show(RootView(pendingLink: .constant(nil), tab: .home), connection)
        try await Self.until("the Home's tiles") {
            connection.fixes != nil && connection.requests != nil && connection.releases != nil
        }
        try await Self.settle()
        Self.screenshot(window, "01-home")
    }

    @Test func library() async throws {
        let connection = try await Self.pairedConnection()
        let window = try Self.show(RootView(pendingLink: .constant(nil), tab: .library), connection)
        try await Self.until("the library") { connection.library != nil }
        try await Self.settle()
        Self.screenshot(window, "02-library")

        let item = try #require(connection.library?.items.first { $0.id == "movie:12" }, "Dune isn't in the preview's library")
        let detail = try Self.show(
            LibraryView().sheet(isPresented: .constant(true)) {
                TitleDetailView(item: item)
                    .presentationDetents([.medium, .large])
                    .presentationDragIndicator(.visible)
            }
            .tint(.quaiAccent)
            .preferredColorScheme(.dark),
            connection
        )
        try await Self.settle()
        Self.screenshot(detail, "02-library-title")
    }

    @Test func activity() async throws {
        let connection = try await Self.pairedConnection()
        let window = try Self.show(RootView(pendingLink: .constant(nil), tab: .activity), connection)
        try await Self.until("the journal") { !connection.journal.isEmpty || connection.journalError != nil }
        try await Self.settle()
        Self.screenshot(window, "03-activity")
    }

    @Test func settings() async throws {
        let connection = try await Self.pairedConnection()
        let window = try Self.show(RootView(pendingLink: .constant(nil), tab: .settings), connection)
        try await Self.settle()
        Self.screenshot(window, "04-settings")

        let notifications = try Self.show(
            NavigationStack { NotificationSettingsView() }.tint(.quaiAccent).preferredColorScheme(.dark),
            connection
        )
        try await Self.settle()
        Self.screenshot(notifications, "05-settings-notifications")
    }

    @Test func liveSheet() async throws {
        let connection = try await Self.pairedConnection()
        // The preview's download becomes an activity a few seconds after the start.
        for _ in 0..<30 where connection.activities.isEmpty {
            try await Task.sleep(for: .seconds(1))
            await connection.refresh()
        }
        #expect(!connection.activities.isEmpty, "No live bar: the preview's download didn't reach the app")
        let window = try Self.show(RootView(pendingLink: .constant(nil), tab: .home, showsLive: true), connection)
        try await Self.settle()
        Self.screenshot(window, "06-live-sheet")
    }

    // MARK: iPhone Duo

    /// The iPhone Duo's inner display, in points (2007 × 2853 pixels at 3×). The simulators don't
    /// have it yet: its screens are drawn in a window of that size.
    private static let duoInner = CGSize(width: 669, height: 951)

    @Test func duoHome() async throws {
        let connection = try await Self.pairedConnection()
        let window = try Self.show(RootView(pendingLink: .constant(nil), tab: .home), connection, size: Self.duoInner)
        try await Self.until("the Home's tiles") {
            connection.fixes != nil && connection.requests != nil && connection.releases != nil
        }
        try await Self.settle()
        Self.screenshot(window, "duo-01-home")
    }

    @Test func duoLibrary() async throws {
        let connection = try await Self.pairedConnection()
        let window = try Self.show(RootView(pendingLink: .constant(nil), tab: .library), connection, size: Self.duoInner)
        try await Self.until("the library") { connection.library != nil }
        try await Self.settle()
        Self.screenshot(window, "duo-02-library")
    }

    @Test func duoActivity() async throws {
        let connection = try await Self.pairedConnection()
        let window = try Self.show(RootView(pendingLink: .constant(nil), tab: .activity), connection, size: Self.duoInner)
        try await Self.until("the journal") { !connection.journal.isEmpty || connection.journalError != nil }
        try await Self.settle()
        Self.screenshot(window, "duo-03-activity")
    }

    @Test func duoSettings() async throws {
        let connection = try await Self.pairedConnection()
        let window = try Self.show(RootView(pendingLink: .constant(nil), tab: .settings), connection, size: Self.duoInner)
        try await Self.settle()
        Self.screenshot(window, "duo-04-settings")
    }

    // MARK: Helpers

    /// The windows shown so far: kept until the end of the run, so a screen's tasks don't stop under it.
    private static var windows: [UIWindow] = []

    /// A new connection paired with a fresh code from the preview server's console route, as the console's QR code.
    private static func pairedConnection() async throws -> Connection {
        let base = try #require(previewURL)
        var request = URLRequest(url: base.appending(path: "console-api/pairing-codes"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["serverUrls": [base.absoluteString]])
        let (data, response) = try await URLSession.shared.data(for: request)
        #expect((response as? HTTPURLResponse)?.statusCode == 200, "The preview server at \(base) gave no pairing code")
        let body = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        let link = try #require((body["link"] as? String).flatMap(URL.init(string:)).flatMap(PairingLink.init))
        let connection = Connection()
        connection.disconnect()
        try await connection.pair(link, name: "Screenshots")
        return connection
    }

    /// The view full screen, in a window of its own above the test host's; at `size` when given.
    private static func show(_ view: some View, _ connection: Connection, size: CGSize? = nil) throws -> UIWindow {
        for window in windows { window.isHidden = true }
        let scene = try #require(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        window.overrideUserInterfaceStyle = .dark
        window.rootViewController = UIHostingController(rootView: view.environment(connection))
        if let size { window.frame = CGRect(origin: .zero, size: size) }
        window.makeKeyAndVisible()
        windows.append(window)
        return window
    }

    private static func until(
        _ what: String,
        timeout: Duration = .seconds(20),
        _ condition: () -> Bool
    ) async throws {
        let deadline = ContinuousClock.now + timeout
        while !condition() {
            guard ContinuousClock.now < deadline else {
                Issue.record("Waited \(timeout) for \(what)")
                return
            }
            try await Task.sleep(for: .milliseconds(100))
        }
    }

    /// Lets images and animations finish before a screenshot.
    private static func settle(_ seconds: Double = 2) async throws {
        try await Task.sleep(for: .seconds(seconds))
    }

    private static func screenshot(_ window: UIWindow, _ name: String) {
        let image = UIGraphicsImageRenderer(bounds: window.bounds).image { _ in
            _ = window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
        }
        guard let directory = ProcessInfo.processInfo.environment["QUAI_SCREENSHOTS_DIR"] else { return }
        let folder = URL(fileURLWithPath: directory)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try? image.pngData()?.write(to: folder.appending(path: "\(name).png"))
    }
}
