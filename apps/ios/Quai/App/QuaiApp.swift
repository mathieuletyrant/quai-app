import SwiftUI

@main
struct QuaiApp: App {
    @State private var connection = Connection()
    @State private var pendingLink: PairingLink?

    var body: some Scene {
        WindowGroup {
            Group {
                if connection.isPaired {
                    TabView {
                        Tab("Activity", systemImage: "dot.radiowaves.left.and.right") { ActivityListView() }
                        Tab("Settings", systemImage: "gearshape") { SettingsView() }
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
            .task { DemoActivity.startIfRequested() }
        }
    }
}
