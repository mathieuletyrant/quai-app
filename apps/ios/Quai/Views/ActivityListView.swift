import SwiftUI

struct ActivityListView: View {
    @Environment(Connection.self) private var connection

    var body: some View {
        NavigationStack {
            List {
                if let error = connection.lastError {
                    Section { Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.orange) }
                }
                if connection.activities.isEmpty {
                    ContentUnavailableView(
                        "Nothing in progress",
                        systemImage: "tray",
                        description: Text("Add a movie in Seerr or Radarr: it shows up here and on the Lock Screen.")
                    )
                    .listRowBackground(Color.clear)
                } else {
                    Section("In progress") {
                        ForEach(connection.activities, id: \.attributes.mediaKey) { activity in
                            ActivityRow(activity: activity)
                        }
                    }
                }
            }
            .navigationTitle("Activity")
            .refreshable { await connection.refresh() }
            .task {
                // Light polling while the screen is open; the Live Activities themselves are pushed.
                while !Task.isCancelled {
                    await connection.refresh()
                    try? await Task.sleep(for: .seconds(15))
                }
            }
        }
    }
}

struct ActivityRow: View {
    let activity: Components.Schemas.RunningActivity

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(activity.attributes.title).font(.headline).lineLimit(1)
                Spacer()
                if let progress = activity.content.progress, activity.content.step == .downloading {
                    Text(progress, format: .percent.precision(.fractionLength(0)))
                        .monospacedDigit()
                        .foregroundStyle(Color.quaiAccent)
                }
            }
            if let progress = activity.content.progress, activity.content.step == .downloading {
                ProgressView(value: progress).tint(activity.content.stalled ? .gray : .quaiAccent)
            }
            Text(label).font(.subheadline).foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }

    private var label: String {
        if activity.content.stalled { return "No source for 2 h" }
        switch activity.content.step {
        case .searching: return "Searching"
        case .downloading: return "Downloading"
        case .importing: return "Importing"
        case .available: return "Ready to watch"
        }
    }
}
