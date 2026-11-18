import SwiftUI

/// Settings → Live Activities: what this iPhone receives. Saved on the server, per iPhone.
struct LiveActivitySettingsView: View {
    @Environment(Connection.self) private var connection
    @State private var preferences: Components.Schemas.DevicePreferences?
    @State private var status: String?
    @State private var testing = false

    private static let order: [Components.Schemas.DownloadStep] = [.searching, .downloading, .importing, .available]
    private static let optionalSteps: [Components.Schemas.DownloadStep] = [.searching, .downloading, .importing]

    var body: some View {
        List {
            if let preferences {
                Section {
                    Toggle(isOn: binding(\.enabled, preferences)) {
                        Label("Download", systemImage: "arrow.down.circle.fill").foregroundStyle(.primary)
                    }
                    .tint(.quaiAccent)
                } footer: {
                    Text("From the request to “Ready to watch”, on the Lock Screen and in the Dynamic Island.")
                }

                if preferences.download.enabled {
                    Section {
                        ForEach(Self.optionalSteps, id: \.self) { step in
                            Toggle(Self.label(step), isOn: stepBinding(step, preferences)).tint(.quaiAccent)
                        }
                        LabeledContent("Ready to watch", value: "Always")
                    } header: {
                        Text("Steps shown")
                    } footer: {
                        Text("The activity starts at the first step you keep. Ready to watch ends it.")
                    }

                    Section("Once ready") {
                        Picker("Stay on screen", selection: lingerBinding(preferences)) {
                            Text("15 min").tag(15.0)
                            Text("1 hour").tag(60.0)
                        }
                    }
                }

                Section {
                    Button {
                        Task { await sendTest() }
                    } label: {
                        HStack {
                            Label("Send a test activity", systemImage: "play.circle.fill")
                            if testing { Spacer(); ProgressView() }
                        }
                    }
                    .disabled(testing)
                } footer: {
                    Text(status ?? "A pretend download of about 45 s, with your steps, through the real push path. Lock the iPhone to see it.")
                }
            } else {
                ProgressView().frame(maxWidth: .infinity)
            }
        }
        .navigationTitle("Live Activities")
        .task { await load() }
    }

    private static func label(_ step: Components.Schemas.DownloadStep) -> String {
        switch step {
        case .searching: "Searching"
        case .downloading: "Downloading"
        case .importing: "Importing"
        case .available: "Ready to watch"
        }
    }

    private func load() async {
        do { preferences = try await connection.preferences() } catch { status = error.localizedDescription }
    }

    private func update(_ change: (inout Components.Schemas.DevicePreferences) -> Void) {
        guard var next = preferences else { return }
        change(&next)
        preferences = next
        Task {
            do {
                try await connection.save(next)
                status = nil
            } catch {
                status = error.localizedDescription
            }
        }
    }

    private func binding(_ keyPath: WritableKeyPath<Components.Schemas.DownloadPreferences, Bool>, _ current: Components.Schemas.DevicePreferences) -> Binding<Bool> {
        Binding(get: { current.download[keyPath: keyPath] }, set: { value in update { $0.download[keyPath: keyPath] = value } })
    }

    private func stepBinding(_ step: Components.Schemas.DownloadStep, _ current: Components.Schemas.DevicePreferences) -> Binding<Bool> {
        Binding(
            get: { current.download.steps.contains(step) },
            set: { on in
                update { prefs in
                    var steps = Set(prefs.download.steps)
                    if on { steps.insert(step) } else { steps.remove(step) }
                    steps.insert(.available)
                    prefs.download.steps = Self.order.filter(steps.contains)
                }
            }
        )
    }

    private func lingerBinding(_ current: Components.Schemas.DevicePreferences) -> Binding<Double> {
        Binding(get: { current.download.lingerMinutes }, set: { value in update { $0.download.lingerMinutes = value } })
    }

    private func sendTest() async {
        testing = true
        defer { testing = false }
        do {
            try await connection.sendTestActivity()
            status = "Sent. Lock the iPhone: it runs for about 45 s."
        } catch {
            status = error.localizedDescription
        }
    }
}
