import SwiftUI
import UserNotifications

typealias AlertKind = Components.Schemas.AlertKind
typealias GoneKind = Components.Schemas.GoneKind

/// What a notification setting is about, as Upcoming names a service over its row: who, in
/// the color of what it means (red for what's wrong, orange for what goes).
protocol NotificationTopic {
    var service: String { get }
    var label: String { get }
    var tint: Color { get }
}

extension AlertKind: NotificationTopic {
    var service: String {
        switch self {
        case .serviceDown: "Any service"
        case .diskLow: "Radarr · Sonarr"
        case .arrHealth: "Radarr · Sonarr · Prowlarr"
        case .plannedDeletion: "Reclaimerr"
        }
    }

    var label: String {
        switch self {
        case .serviceDown: "Stops answering"
        case .diskLow: "The media disk runs low"
        case .arrHealth: "Report a problem"
        case .plannedDeletion: "Plans to delete a title"
        }
    }

    var tint: Color { self == .plannedDeletion ? Palette.toFix : Palette.alert }
}

extension GoneKind: NotificationTopic {
    var service: String {
        switch self {
        case .plannedDeletion: "Reclaimerr"
        case .stuckRemoval, .seedCleanup: "Cleanuparr"
        }
    }

    var label: String {
        switch self {
        case .plannedDeletion: "Deleted a title"
        case .stuckRemoval: "Removed a stuck download"
        case .seedCleanup: "Cleaned a torrent after seeding"
        }
    }

    var tint: Color { Palette.toFix }
}

/// Settings → Notifications: which alerts this iPhone is notified of, and what it hears once gone.
/// Saved on the server, per iPhone. The alerts themselves are turned on and set up in the console;
/// what is gone is off until turned on here.
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
                    GroupedSection(header: "Alerts", footer: "You're notified when a problem starts and when it's resolved, and of a planned deletion the day it's planned and the day before. Alerts are set up in Quai's console.") {
                        ForEach(AlertKind.allCases, id: \.self) { kind in
                            NotificationToggle(topic: kind, isOn: Binding(
                                get: { !(preferences.mutedAlerts ?? []).contains(kind) },
                                set: { on in update(kind, on: on) }
                            ))
                        }
                    }
                    GroupedSection(header: "Gone", footer: "You're notified once something shown as going in Upcoming is done. These settings apply to this iPhone only.") {
                        ForEach(GoneKind.allCases, id: \.self) { kind in
                            NotificationToggle(topic: kind, isOn: Binding(
                                get: { (preferences.gone ?? []).contains(kind) },
                                set: { on in update(kind, on: on) }
                            ))
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
        save(next)
    }

    private func update(_ kind: GoneKind, on: Bool) {
        guard var next = preferences else { return }
        var wanted = Set(next.gone ?? [])
        if on { wanted.insert(kind) } else { wanted.remove(kind) }
        next.gone = GoneKind.allCases.filter(wanted.contains)
        save(next)
    }

    private func save(_ next: Components.Schemas.DevicePreferences) {
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

/// A setting's toggle: its service over what it notifies, like a row of Upcoming.
private struct NotificationToggle: View {
    let topic: any NotificationTopic
    @Binding var isOn: Bool

    var body: some View {
        Toggle(isOn: $isOn) {
            VStack(alignment: .leading, spacing: 2) {
                Text(topic.service.uppercased())
                    .font(QuaiFont.tag)
                    .tracking(0.6)
                    .foregroundStyle(topic.tint)
                Text(topic.label)
                    .font(QuaiFont.body)
                    .foregroundStyle(Palette.primaryText)
            }
        }
        .tint(.quaiAccent)
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .frame(minHeight: 62)
    }
}
