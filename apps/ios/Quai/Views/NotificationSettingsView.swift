import SwiftUI
import UserNotifications

typealias AlertKind = Components.Schemas.AlertKind
typealias GoneKind = Components.Schemas.GoneKind

/// What a notification setting is about: what happens, and the services it comes from (by the
/// name the API gives them; none: any service).
protocol NotificationTopic {
    var services: [String] { get }
    var label: String { get }
}

extension NotificationTopic {
    /// Its services that Quai Home reaches (`home`, unknown: all of them); nil when it can't happen.
    func reached(by home: [String]?) -> [String]? {
        guard let home, !services.isEmpty else { return services }
        let reached = services.filter(home.contains)
        return reached.isEmpty ? nil : reached
    }
}

extension AlertKind: NotificationTopic {
    var services: [String] {
        switch self {
        case .serviceDown: []
        case .diskLow: ["radarr", "sonarr"]
        case .arrHealth: ["radarr", "sonarr", "prowlarr"]
        case .plannedDeletion: ["reclaimerr"]
        }
    }

    var label: String {
        switch self {
        case .serviceDown: "A service stops answering"
        case .diskLow: "The media disk runs low"
        case .arrHealth: "A service reports a problem"
        case .plannedDeletion: "A deletion is planned"
        }
    }
}

extension GoneKind: NotificationTopic {
    var services: [String] {
        switch self {
        case .plannedDeletion: ["reclaimerr"]
        case .stuckRemoval, .seedCleanup: ["cleanuparr"]
        }
    }

    var label: String {
        switch self {
        case .plannedDeletion: "A title was deleted"
        case .stuckRemoval: "A stuck download was removed"
        case .seedCleanup: "A torrent was cleaned after seeding"
        }
    }
}

/// The settings that can fire: the alerts turned on in the console (`enabled`, unknown: all), whose
/// services Quai Home reaches, each with the services it shows.
enum NotificationRows {
    static func alerts(enabled: [AlertKind]?, home: [String]?) -> [(kind: AlertKind, services: [String])] {
        AlertKind.allCases.compactMap { kind in
            guard enabled?.contains(kind) ?? true, let services = kind.reached(by: home) else { return nil }
            return (kind, services)
        }
    }

    static func gone(home: [String]?) -> [(kind: GoneKind, services: [String])] {
        GoneKind.allCases.compactMap { kind in kind.reached(by: home).map { (kind, $0) } }
    }
}

/// Settings → Notifications: which alerts this iPhone is notified of, and what it hears once gone.
/// Saved on the server, per iPhone. The alerts themselves are turned on and set up in the console;
/// what is gone is off until turned on here.
struct NotificationSettingsView: View {
    @Environment(Connection.self) private var connection
    @State private var preferences: Components.Schemas.DevicePreferences?
    @State private var allowed = true
    @State private var status: String?

    private var home: [String]? { connection.alerts?.services?.map(\.rawValue) }
    private var alertRows: [(kind: AlertKind, services: [String])] {
        NotificationRows.alerts(enabled: connection.alerts?.enabled, home: home)
    }

    private var goneRows: [(kind: GoneKind, services: [String])] { NotificationRows.gone(home: home) }
    private var alertsOffInConsole: Bool {
        connection.alerts.map { $0.enabled.count < AlertKind.allCases.count } ?? false
    }

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
                    if !alertRows.isEmpty {
                        GroupedSection(header: "Alerts", footer: alertsOffInConsole ? "Some alerts are off in Quai's console." : nil) {
                            ForEach(alertRows, id: \.kind) { row in
                                NotificationToggle(label: row.kind.label, services: row.services, isOn: Binding(
                                    get: { !(preferences.mutedAlerts ?? []).contains(row.kind) },
                                    set: { on in update(row.kind, on: on) }
                                ))
                            }
                        }
                    }
                    if !goneRows.isEmpty {
                        GroupedSection(header: "Gone") {
                            ForEach(goneRows, id: \.kind) { row in
                                NotificationToggle(label: row.kind.label, services: row.services, isOn: Binding(
                                    get: { (preferences.gone ?? []).contains(row.kind) },
                                    set: { on in update(row.kind, on: on) }
                                ))
                            }
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
        await connection.loadAlerts()
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

/// A setting's toggle: what it notifies, over the services it comes from.
private struct NotificationToggle: View {
    let label: String
    let services: [String]
    @Binding var isOn: Bool

    var body: some View {
        Toggle(isOn: $isOn) {
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(QuaiFont.body)
                    .foregroundStyle(Palette.primaryText)
                ServiceLine(services: services)
            }
        }
        .tint(.quaiAccent)
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .frame(minHeight: 62)
    }
}
