import SwiftUI

/// The tabs of the floating tab bar.
enum AppTab: Hashable {
    case home, library, activity, settings
}

@main
struct QuaiApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var connection = Connection()
    @State private var pendingLink: PairingLink?
    @State private var tab = AppTab.home
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            Group {
                if connection.isPaired {
                    TabView(selection: $tab) {
                        Tab("Home", systemImage: "house.fill", value: AppTab.home) { HomeView(tab: $tab) }
                        Tab("Library", systemImage: "film.stack", value: AppTab.library) { LibraryView() }
                        Tab("Activity", systemImage: "waveform.path.ecg", value: AppTab.activity) { ActivityListView() }
                        Tab("Settings", systemImage: "gearshape", value: AppTab.settings) { SettingsView() }
                    }
                } else {
                    PairingView(link: $pendingLink)
                }
            }
            .environment(connection)
            .tint(.quaiAccent)
            .preferredColorScheme(.dark)
            // The Camera app opens the console's QR code as a quai://pair link.
            .onOpenURL { url in
                if let link = PairingLink(url) { pendingLink = link }
            }
            .task { await connection.watchPushToStartTokens() }
            .task { await connection.watchActivities() }
            .task { await connection.watchNotificationTokens() }
            // Asked once paired: alerts mean nothing before there is a server to send them.
            .task(id: connection.isPaired) {
                if connection.isPaired { await Notifications.register() }
            }
            .task { DemoActivity.startIfRequested() }
            // Activities swiped away while the app wasn't running: the server learns it here.
            .onChange(of: scenePhase, initial: true) { _, phase in
                if phase == .active {
                    Task { await connection.reportShownActivities() }
                    Task { await connection.reportTimeZone() }
                }
            }
        }
    }
}
