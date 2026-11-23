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
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView(pendingLink: $pendingLink)
                .environment(connection)
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
                #if DEBUG
                .task { await PreviewPairing.pairIfRequested(connection) }
                #endif
                // The live bar shows on every tab: the running activities are read while the app is in front.
                .task(id: connection.isPaired && scenePhase == .active) {
                    guard connection.isPaired, scenePhase == .active else { return }
                    while !Task.isCancelled {
                        await connection.refresh()
                        try? await Task.sleep(for: .seconds(15))
                    }
                }
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

/// What the window shows: the tabs once paired, the pairing screen before. The screenshot tests
/// host it as is, on a given tab.
struct RootView: View {
    @Environment(Connection.self) private var connection
    @Binding var pendingLink: PairingLink?
    @State private var tab: AppTab
    @State private var showsLive: Bool

    init(pendingLink: Binding<PairingLink?>, tab: AppTab = .home, showsLive: Bool = false) {
        _pendingLink = pendingLink
        _tab = State(initialValue: tab)
        _showsLive = State(initialValue: showsLive)
    }

    var body: some View {
        Group {
            if connection.isPaired {
                TabView(selection: $tab) {
                    Tab("Home", systemImage: "house.fill", value: AppTab.home) { HomeView(tab: $tab) }
                    Tab("Library", systemImage: "film.stack", value: AppTab.library) { LibraryView() }
                    Tab("Activity", systemImage: "waveform.path.ecg", value: AppTab.activity) { ActivityListView() }
                    Tab("Settings", systemImage: "gearshape", value: AppTab.settings) { SettingsView() }
                }
                .modifier(LiveAccessory(live: LiveNow(Today(connection.activities, subjects: connection.flowSubjects))) { showsLive = true })
                .sheet(isPresented: $showsLive) { LiveSheet() }
            } else {
                PairingView(link: $pendingLink)
            }
        }
        .tint(.quaiAccent)
        .preferredColorScheme(.dark)
    }
}

/// The live bar under the tabs, only while something plays or downloads.
private struct LiveAccessory: ViewModifier {
    let live: LiveNow
    let open: () -> Void

    func body(content: Content) -> some View {
        #if compiler(>=6.2.1)
        if #available(iOS 26.1, *) {
            content.tabViewBottomAccessory(isEnabled: !live.isEmpty) { LiveBar(live: live, open: open) }
        } else {
            content.tabViewBottomAccessory { LiveBar(live: live, open: open) }
        }
        #else
        content.tabViewBottomAccessory { LiveBar(live: live, open: open) }
        #endif
    }
}
