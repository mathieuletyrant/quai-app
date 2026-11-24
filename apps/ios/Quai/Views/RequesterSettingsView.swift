import SwiftUI

/// Settings → Request as: the Seerr user this iPhone's requests are made for. Saved on the server,
/// per iPhone, so each person of the house requests as themselves.
struct RequesterSettingsView: View {
    @Environment(Connection.self) private var connection
    @State private var preferences: Components.Schemas.DevicePreferences?
    @State private var users: Components.Schemas.SeerrUsers?
    @State private var status: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if let users, let preferences {
                    switch users.status {
                    case .ok:
                        GroupedSection(footer: footer) {
                            RequesterRow(name: "Seerr's admin", detail: "The owner of Quai Home's key", selected: preferences.seerrUserId == nil) {
                                choose(nil)
                            }
                            ForEach(users.items, id: \.id) { user in
                                RequesterRow(name: user.name, selected: preferences.seerrUserId == user.id) { choose(user.id) }
                            }
                        }
                    case .notConfigured:
                        MessageTile(title: "No Seerr", message: "Quai Home has no Seerr: add it in the console's Services page.", systemImage: "person.crop.circle.badge.questionmark", color: Palette.toFix)
                    case .outdated:
                        MessageTile(title: "Update Quai Home", message: "Your Quai Home is too old to request from the app.", systemImage: "arrow.down.circle.fill", color: Palette.toFix)
                    case .unavailable:
                        MessageTile(title: "Seerr didn't answer", message: "Come back in a moment.", systemImage: "exclamationmark.triangle.fill", color: Palette.toFix)
                    }
                } else if status == nil {
                    ProgressView().frame(maxWidth: .infinity).padding(.vertical, 24)
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
        .navigationTitle("Request as")
        .navigationBarTitleDisplayMode(.large)
        .toolbar(.visible, for: .navigationBar)
        .task { await load() }
    }

    private var footer: String {
        "Requests from this iPhone's search are made in Seerr for this person: their auto-approval and quotas apply. Only for this iPhone."
    }

    private func load() async {
        do {
            let read = try await connection.preferences()
            let listed = try await connection.seerrUsers()
            preferences = read
            users = listed
            status = nil
        } catch {
            status = error.quaiMessage
        }
    }

    private func choose(_ userId: Int?) {
        guard var next = preferences, next.seerrUserId != userId else { return }
        next.seerrUserId = userId
        preferences = next
        let saved = next
        Task {
            do {
                try await connection.save(saved)
                status = nil
            } catch {
                status = error.quaiMessage
            }
        }
    }
}

private struct RequesterRow: View {
    let name: String
    var detail: String?
    let selected: Bool
    let choose: () -> Void

    var body: some View {
        Button(action: choose) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(name).font(QuaiFont.body).foregroundStyle(Palette.primaryText)
                    if let detail {
                        Text(detail).font(QuaiFont.caption).foregroundStyle(Palette.secondaryText)
                    }
                }
                Spacer(minLength: 8)
                if selected {
                    Image(systemName: "checkmark")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Palette.accent)
                }
            }
            .padding(.horizontal, 14)
            .frame(minHeight: 52)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
