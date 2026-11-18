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
                        ForEach(connection.activities, id: \.attributes.key) { activity in
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

    private var tint: Color { Palette.tint(tone: activity.content.tone.rawValue, color: activity.attributes.color) }

    private var stepLabel: String {
        let steps = activity.attributes.steps
        return steps.indices.contains(activity.content.step) ? steps[activity.content.step].label : ""
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 10) {
                Image(systemName: activity.attributes.icon).foregroundStyle(tint)
                Text(activity.attributes.title).font(.headline).lineLimit(1)
                Spacer()
                if let progress = activity.content.progress {
                    Text(progress, format: .percent.precision(.fractionLength(0)))
                        .monospacedDigit()
                        .foregroundStyle(tint)
                }
            }
            if let progress = activity.content.progress {
                ProgressView(value: progress).tint(tint)
            }
            Text([stepLabel, activity.content.detail].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }
}
