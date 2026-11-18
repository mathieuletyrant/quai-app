import SwiftUI

@main
struct QuaiApp: App {
    var body: some Scene {
        WindowGroup {
            TabView {
                Tab("Activité", systemImage: "dot.radiowaves.left.and.right") { ActivityView() }
                Tab("Réglages", systemImage: "gearshape") { SettingsView() }
            }
            .preferredColorScheme(.dark)
            .task { DemoActivity.startIfRequested() }
        }
    }
}

struct ActivityView: View {
    var body: some View {
        NavigationStack {
            ContentUnavailableView("Aucune activité", systemImage: "tray",
                                   description: Text("Relie l'app à ton serveur Quai pour commencer."))
                .navigationTitle("Activité")
        }
    }
}

struct SettingsView: View {
    var body: some View {
        NavigationStack {
            List { Section("Serveur") { Text("Non relié") } }
                .navigationTitle("Réglages")
        }
    }
}
