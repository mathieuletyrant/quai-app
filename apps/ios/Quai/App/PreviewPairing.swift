#if DEBUG
import Foundation

/// QuaiUITests start the app paired to the preview server (`pnpm --filter @quai/cloud preview`),
/// through the same pairing as the console's QR code.
enum PreviewPairing {
    static let environmentKey = "QUAI_PREVIEW_PAIRING"
    /// Seconds every read waits before going out, so the tests can photograph the loading states.
    static let readDelayKey = "QUAI_PREVIEW_READ_DELAY"

    static var readDelay: Duration? {
        guard let value = ProcessInfo.processInfo.environment[readDelayKey], let seconds = Double(value) else { return nil }
        return .seconds(seconds)
    }

    @MainActor static func pairIfRequested(_ connection: Connection) async {
        guard let value = ProcessInfo.processInfo.environment[environmentKey],
              let url = URL(string: value),
              let link = PairingLink(url)
        else { return }
        connection.disconnect()
        do {
            try await connection.pair(link, name: "Preview")
        } catch {
            print("Preview pairing failed: \(error.quaiMessage)")
        }
    }
}
#endif
