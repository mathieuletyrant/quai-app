#if DEBUG
import Foundation

/// A simulator started with `QUAI_PREVIEW_PAIRING` (a `quai://pair` link) pairs to the preview server
/// (`pnpm --filter @quai/cloud preview`), through the same pairing as the console's QR code.
enum PreviewPairing {
    static let environmentKey = "QUAI_PREVIEW_PAIRING"

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
