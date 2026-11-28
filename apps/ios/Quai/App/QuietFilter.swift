import AppIntents

/// Quai's Focus filter (iPhone Settings → Focus → a Focus → Add Filter → Quai). While a Focus that
/// has it on is on, this iPhone is quiet: a download starts no Live Activity, Quai notifies it once
/// ready instead.
struct QuietFilter: SetFocusFilterIntent {
    static let title: LocalizedStringResource = "Quiet downloads"
    static let description: IntentDescription? = IntentDescription(
        "While this Focus is on, a download starts no Live Activity: Quai notifies you once it's ready to watch."
    )

    /// iOS runs `perform` again with the default when the Focus ends: off is the default.
    @Parameter(title: "Notify only when ready", default: false)
    var quiet: Bool

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: quiet ? "Downloads: notify when ready" : "Downloads: Live Activities")
    }

    func perform() async throws -> some IntentResult {
        let quiet = quiet
        await BackgroundCall.send { client in
            _ = try await client.updateDevice(body: .json(.init(quiet: quiet))).noContent
        }
        return .result()
    }
}
