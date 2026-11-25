import SwiftUI
import UserNotifications

typealias AlertKind = Components.Schemas.AlertKind

extension AlertKind {
    var label: String {
        switch self {
        case .serviceDown: "A service stops answering"
        case .diskLow: "The media disk runs low"
        case .arrHealth: "Radarr, Sonarr or Prowlarr report a problem"
        case .plannedDeletion: "Reclaimerr plans to delete a title"
        }
    }
}

/// Settings → Notifications: which alerts this iPhone is notified of. Saved on the server, per
/// iPhone. The alerts themselves are turned on and set up in the console.
struct NotificationSettingsView: View {
    @Environment(Connection.self) private var connection
    @State private var preferences: Components.Schemas.DevicePreferences?
    @State private var allowed = true
    @State private var status: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if !allowed {
                    MessageTile(
                        title: "Notifications are off",
                        message: "Allow them for Quai in the iPhone's Settings → Notifications to get the alerts.",
                        systemImage: "bell.slash.fill",
                        color: Palette.toFix
                    )
                }
                if let preferences {
                    GroupedSection(footer: "Each alert sends one notification when it starts and one when it's over. These settings are only for this iPhone: the alerts are set up in Quai's console.") {
                        ForEach(AlertKind.allCases, id: \.self) { kind in
                            Toggle(isOn: Binding(
                                get: { !(preferences.mutedAlerts ?? []).contains(kind) },
                                set: { on in update(kind, on: on) }
                            )) {
                                Text(kind.label).font(QuaiFont.body).foregroundStyle(Palette.primaryText)
                            }
                            .tint(.quaiAccent)
                            .padding(.horizontal, 14)
                            .frame(minHeight: 52)
                        }
                    }
                } else {
                    ProgressView().frame(maxWidth: .infinity).padding(.vertical, 24)
                }
                if let status {
                    Text(status)
                        .font(QuaiFont.caption)
                        .foregroundStyle(Palette.toFix)
                        .padding(.horizontal, 8)
                }
            }
            .padding(.horizontal, Metrics.gutter)
            .padding(.vertical, 8)
        }
        .background(Palette.background.ignoresSafeArea())
        .navigationTitle("Notifications")
        .navigationBarTitleDisplayMode(.large)
        .toolbar(.visible, for: .navigationBar)
        .task { await load() }
    }

    private func load() async {
        allowed = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus == .authorized
        do {
            preferences = try await connection.preferences()
        } catch {
            status = error.message(replacing: status)
        }
    }

    private func update(_ kind: AlertKind, on: Bool) {
        guard var next = preferences else { return }
        var muted = Set(next.mutedAlerts ?? [])
        if on { muted.remove(kind) } else { muted.insert(kind) }
        next.mutedAlerts = AlertKind.allCases.filter(muted.contains)
        preferences = next
        let saved = next
        Task {
            do {
                try await connection.save(saved)
                status = nil
            } catch {
                status = error.message(replacing: status)
            }
        }
    }
}
