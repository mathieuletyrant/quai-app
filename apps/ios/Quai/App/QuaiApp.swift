import SwiftUI

/// The tabs of the floating tab bar.
enum AppTab: Hashable {
    case home, library, activity, settings, search
}

@main
struct QuaiApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var connection = Connection()
    @State private var pendingLink: PairingLink?
    /// The search, opened from the Lock Screen widget or the control.
    @State private var searchLink: SearchLink?
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView(pendingLink: $pendingLink, searchLink: $searchLink)
                .environment(connection)
                // The Camera app opens the console's QR code as a quai://pair link; the Lock
                // Screen's widget and control, quai://search.
                .onOpenURL { url in
                    if let link = PairingLink(url) { pendingLink = link }
                    if let link = SearchLink(url) { searchLink = link }
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
                        connection.didBecomeActive()
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
    @Environment(\.scenePhase) private var scenePhase
    @Binding var pendingLink: PairingLink?
    @Binding var searchLink: SearchLink?
    @State private var tab: AppTab
    @State private var showsLive: Bool
    /// The Library's filter, also set by the Home's tiles that open it.
    @State private var libraryFilter = LibraryFilter.recent

    init(pendingLink: Binding<PairingLink?>, searchLink: Binding<SearchLink?> = .constant(nil), tab: AppTab = .home, showsLive: Bool = false) {
        _pendingLink = pendingLink
        _searchLink = searchLink
        _tab = State(initialValue: tab)
        _showsLive = State(initialValue: showsLive)
    }

    var body: some View {
        Group {
            if connection.isPaired {
                TabView(selection: $tab) {
                    Tab("Home", systemImage: "house.fill", value: AppTab.home) { HomeView(tab: $tab, libraryFilter: $libraryFilter) }
                    Tab("Library", systemImage: "film.stack", value: AppTab.library) { LibraryView(filter: $libraryFilter) }
                    Tab("Activity", systemImage: "waveform.path.ecg", value: AppTab.activity) { ActivityListView() }
                    Tab("Settings", systemImage: "gearshape", value: AppTab.settings) { SettingsView() }
                    Tab("Search", systemImage: "magnifyingglass", value: AppTab.search, role: .search) { SearchView(link: $searchLink) }
                }
                .modifier(LiveAccessory(live: LiveNow(Today(connection.activities, subjects: connection.flowSubjects))) { showsLive = true })
                .sheet(isPresented: $showsLive) { LiveSheet() }
                // What the tab shows, read each time it opens and each time the app comes back to the front on it.
                .task(id: tab) { await connection.reload(tab) }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active { Task { await connection.reload(tab) } }
                }
                .onChange(of: searchLink, initial: true) { _, link in
                    if link != nil {
                        showsLive = false
                        tab = .search
                    }
                }
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
