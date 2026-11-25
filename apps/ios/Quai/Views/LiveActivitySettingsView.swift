import SwiftUI

/// Settings → Live Activities: per flow, whether this iPhone shows it and which steps. Saved on the
/// server, per iPhone. Flows themselves are made, and tested, in the console.
struct LiveActivitySettingsView: View {
    @Environment(Connection.self) private var connection
    @State private var flows: [Components.Schemas.FlowSummary] = []
    @State private var preferences: [String: Components.Schemas.FlowPreference] = [:]
    /// Kept as loaded: saved again with the flows, so this screen never unmutes an alert.
    @State private var mutedAlerts: [Components.Schemas.AlertKind]?
    @State private var status: String?
    @State private var loaded = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if !loaded {
                    ProgressView().frame(maxWidth: .infinity).padding(.vertical, 24)
                } else if !flows.isEmpty {
                    GroupedSection(footer: "Which Live Activities this iPhone shows, and which of their steps. These settings are only for this iPhone: flows are made, and tested, in Quai's console.") {
                        ForEach(flows, id: \.id) { flow in
                            FlowSection(
                                flow: flow,
                                preference: preference(flow.id),
                                onChange: { change in update(flow.id, change) }
                            )
                        }
                    }
                }
                if let status {
                    Text(status)
                        .font(QuaiFont.caption)
                        .foregroundStyle(Palette.toFix)
                        .padding(.horizontal, 8)
                }
            }
            .padding(.horizontal, Metrics.gutter)
            .padding(.vertical, 8)
        }
        .background(Palette.background.ignoresSafeArea())
        .navigationTitle("Live Activities")
        .navigationBarTitleDisplayMode(.large)
        .toolbar(.visible, for: .navigationBar)
        .task { await load() }
        .refreshable { await load() }
    }

    private func preference(_ id: String) -> Components.Schemas.FlowPreference {
        preferences[id] ?? .init(enabled: true, hiddenSteps: [])
    }

    private func load() async {
        do {
            async let all = connection.flows()
            async let saved = connection.preferences()
            flows = try await all
            let read = try await saved
            preferences = read.flows.additionalProperties
            mutedAlerts = read.mutedAlerts
            loaded = true
        } catch {
            status = error.message(replacing: status)
            loaded = true
        }
    }

    private func update(_ id: String, _ change: (inout Components.Schemas.FlowPreference) -> Void) {
        var next = preference(id)
        change(&next)
        preferences[id] = next
        let all = preferences
        let muted = mutedAlerts
        Task {
            do {
                try await connection.save(.init(flows: .init(additionalProperties: all), mutedAlerts: muted))
                status = nil
            } catch {
                status = error.message(replacing: status)
            }
        }
    }
}

private struct FlowSection: View {
    let flow: Components.Schemas.FlowSummary
    let preference: Components.Schemas.FlowPreference
    let onChange: ((inout Components.Schemas.FlowPreference) -> Void) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Toggle(isOn: Binding(get: { preference.enabled }, set: { value in onChange { $0.enabled = value } })) {
                HStack(spacing: 12) {
                    Circle().fill(Color(hex: flow.color)).frame(width: 10, height: 10)
                    Text(flow.name).font(QuaiFont.bodyEmphasized).foregroundStyle(Palette.primaryText)
                }
            }
            .tint(.quaiAccent)
            .disabled(!flow.enabled)

            if !flow.enabled {
                Text("Turned off in the console, for every iPhone.")
                    .font(QuaiFont.caption)
                    .foregroundStyle(Palette.secondaryText)
                    .padding(.leading, 22)
            } else if preference.enabled {
                ForEach(Array(flow.steps.enumerated()), id: \.element.id) { index, step in
                    if index == flow.steps.count - 1 {
                        HStack {
                            Text(step.label)
                            Spacer()
                            Text("Always").foregroundStyle(Palette.secondaryText)
                        }
                        .font(QuaiFont.subheadline)
                        .foregroundStyle(Palette.primaryText)
                        .padding(.leading, 22)
                    } else {
                        Toggle(isOn: Binding(
                            get: { !preference.hiddenSteps.contains(step.id) },
                            set: { shown in
                                onChange { pref in
                                    var hidden = Set(pref.hiddenSteps)
                                    if shown { hidden.remove(step.id) } else { hidden.insert(step.id) }
                                    pref.hiddenSteps = flow.steps.map(\.id).filter(hidden.contains)
                                }
                            }
                        )) {
                            Text(step.label).font(QuaiFont.subheadline).foregroundStyle(Palette.primaryText)
                        }
                        .tint(.quaiAccent)
                        .padding(.leading, 22)
                    }
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .opacity(flow.enabled ? 1 : 0.55)
    }
}
