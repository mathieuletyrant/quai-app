import Foundation

/// A call made with no screen to report to (a Live Activity's token, a Focus turning on), often
/// while iOS runs the app in the background: the stored session, tried again a few times when the
/// server can't be reached.
enum BackgroundCall {
    /// At once, past a network blip, then twice more before iOS suspends the app.
    static let delays: [Duration] = [.zero, .seconds(2), .seconds(10), .seconds(30)]

    static func send(_ call: @Sendable (Client) async throws -> Void) async {
        for delay in delays {
            try? await Task.sleep(for: delay)
            guard let session = ServerSession.stored() else { return }
            do {
                let (_, client) = try await session.connect()
                try await call(client)
                return
            } catch {
                continue
            }
        }
    }
}
