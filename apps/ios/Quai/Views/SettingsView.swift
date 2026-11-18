import SwiftUI

struct SettingsView: View {
    @Environment(Connection.self) private var connection
    @State private var confirmDisconnect = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    NavigationLink {
                        LiveActivitySettingsView()
                    } label: {
                        Label("Live Activities", systemImage: "rectangle.badge.checkmark")
                    }
                }
                Section("Server") {
                    LabeledContent("Address", value: connection.serverURL?.absoluteString ?? "—")
                    LabeledContent("Push server", value: Connection.apnsEnvironment == .development ? "Development (Xcode)" : "Production")
                }
                Section {
                    Button("Disconnect this iPhone", role: .destructive) { confirmDisconnect = true }
                } footer: {
                    Text("To stop receiving Live Activities for good, also remove this iPhone in the console.")
                }
            }
            .navigationTitle("Settings")
            .confirmationDialog("Disconnect from the server?", isPresented: $confirmDisconnect, titleVisibility: .visible) {
                Button("Disconnect", role: .destructive) { connection.disconnect() }
            }
        }
    }
}
