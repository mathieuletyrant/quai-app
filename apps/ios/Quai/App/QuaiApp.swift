import SwiftUI

@main
struct QuaiApp: App {
    var body: some Scene {
        WindowGroup {
            TabView {
                Tab("Activity", systemImage: "dot.radiowaves.left.and.right") { ActivityView() }
                Tab("Settings", systemImage: "gearshape") { SettingsView() }
            }
            .preferredColorScheme(.dark)
            .task { DemoActivity.startIfRequested() }
        }
    }
}

struct ActivityView: View {
    var body: some View {
        NavigationStack {
            ContentUnavailableView("No activity", systemImage: "tray",
                                   description: Text("Connect the app to your Quai server to get started."))
                .navigationTitle("Activity")
        }
    }
}

struct SettingsView: View {
    var body: some View {
        NavigationStack {
            List { Section("Server") { Text("Not connected") } }
                .navigationTitle("Settings")
        }
    }
}
