import SwiftUI

/// Settings → On this iPhone: per flow, whether this iPhone shows it and which steps. Saved on the
/// server, per iPhone. Flows themselves are made, and tested, in the console.
struct LiveActivitySettingsView: View {
    @Environment(Connection.self) private var connection
    @State private var flows: [Components.Schemas.FlowSummary] = []
    @State private var preferences: [String: Components.Schemas.FlowPreference] = [:]
    @State private var status: String?
    @State private var loaded = false

    var body: some View {
        List {
            Section {} footer: {
                Text("Which Live Activities this iPhone shows, and which of their steps. Flows are made, and tested, in Quai's console.")
            }
            if !loaded {
                ProgressView().frame(maxWidth: .infinity)
            }
            ForEach(flows, id: \.id) { flow in
                FlowSection(
                    flow: flow,
                    preference: preference(flow.id),
                    onChange: { change in update(flow.id, change) }
                )
            }
            if let status {
                Section { Text(status).font(.footnote).foregroundStyle(.secondary) }
            }
        }
        .navigationTitle("On this iPhone")
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
            preferences = try await saved.flows.additionalProperties
            loaded = true
        } catch {
            status = error.localizedDescription
            loaded = true
        }
    }

    private func update(_ id: String, _ change: (inout Components.Schemas.FlowPreference) -> Void) {
        var next = preference(id)
        change(&next)
        preferences[id] = next
        let all = preferences
        Task {
            do {
                try await connection.save(.init(flows: .init(additionalProperties: all)))
                status = nil
            } catch {
                status = error.localizedDescription
            }
        }
    }
}

private struct FlowSection: View {
    let flow: Components.Schemas.FlowSummary
    let preference: Components.Schemas.FlowPreference
    let onChange: ((inout Components.Schemas.FlowPreference) -> Void) -> Void

    var body: some View {
        Section {
            Toggle(isOn: Binding(get: { preference.enabled }, set: { value in onChange { $0.enabled = value } })) {
                Label {
                    Text(flow.name)
                } icon: {
                    Image(systemName: flow.icon).foregroundStyle(Color(hex: flow.color))
                }
            }
            .tint(.quaiAccent)
            .disabled(!flow.enabled)

            if preference.enabled && flow.enabled {
                ForEach(Array(flow.steps.enumerated()), id: \.element.id) { index, step in
                    if index == flow.steps.count - 1 {
                        LabeledContent(step.label, value: "Always")
                    } else {
                        Toggle(step.label, isOn: Binding(
                            get: { !preference.hiddenSteps.contains(step.id) },
                            set: { shown in
                                onChange { pref in
                                    var hidden = Set(pref.hiddenSteps)
                                    if shown { hidden.remove(step.id) } else { hidden.insert(step.id) }
                                    pref.hiddenSteps = flow.steps.map(\.id).filter(hidden.contains)
                                }
                            }
                        ))
                        .tint(.quaiAccent)
                        .padding(.leading, 8)
                    }
                }
            }
        } footer: {
            if !flow.enabled {
                Text("Turned off in the console, for every iPhone.")
            }
        }
    }
}
