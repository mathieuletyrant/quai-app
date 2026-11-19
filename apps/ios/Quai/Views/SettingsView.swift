import SwiftUI

/// Settings, opened from the Home header: this iPhone's Live Activities, the connection, disconnecting.
struct SettingsView: View {
    @Environment(Connection.self) private var connection
    @Environment(\.dismiss) private var dismiss
    @State private var confirmDisconnect = false

    private var host: String { connection.serverURL?.host() ?? connection.serverURL?.absoluteString ?? "—" }

    /// "umbrel.local:3078", "quai.example.com".
    private static func address(_ url: URL) -> String {
        guard let host = url.host() else { return url.absoluteString }
        return url.port.map { "\(host):\($0)" } ?? host
    }

    /// The header names, never their values: "CF-Access-Client-Id, CF-Access-Client-Secret".
    private var headerSummary: String {
        let names = connection.accessHeaders.map(\.name)
        return names.isEmpty ? "None" : names.joined(separator: ", ")
    }

    var body: some View {
        NavigationStack {
            Screen {
                ScreenHeader(title: "Settings") {
                    GlassIconButton(systemImage: "xmark", label: "Close") { dismiss() }
                }
            } content: {
                VStack(alignment: .leading, spacing: 18) {
                    GroupedSection {
                        HStack(spacing: 12) {
                            Text("Q")
                                .font(.system(size: 17, weight: .bold))
                                .foregroundStyle(Palette.accent)
                                .frame(width: 40, height: 40)
                                .background(Color(hex: "#1E3A35"), in: Circle())
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Quai Cloud").font(QuaiFont.bodyEmphasized).foregroundStyle(Palette.primaryText)
                                Text(host).font(QuaiFont.caption).foregroundStyle(Palette.secondaryText).lineLimit(1)
                            }
                            Spacer(minLength: 8)
                            Text(connection.lastError == nil ? "connected" : "not reachable")
                                .font(QuaiFont.subheadline)
                                .foregroundStyle(connection.lastError == nil ? Palette.ok : Palette.toFix)
                        }
                        .padding(.horizontal, 14)
                        .frame(minHeight: 64)
                    }

                    GroupedSection(header: "On this iPhone") {
                        NavigationLink {
                            LiveActivitySettingsView()
                        } label: {
                            ListRow(title: "Live Activities", systemImage: "iphone", iconColor: Palette.downloads, chevron: true)
                        }
                        .buttonStyle(.plain)
                    }

                    GroupedSection(header: "Connection", footer: "The app tries each address, the one that answered last first.") {
                        ForEach(connection.serverURLs, id: \.self) { url in
                            ListRow(title: Self.address(url)) {
                                if url == connection.serverURL { Text("In use") }
                            }
                        }
                        NavigationLink {
                            AccessHeadersView()
                        } label: {
                            ListRow(title: "Access headers", chevron: true) {
                                Text(headerSummary).lineLimit(1)
                            }
                        }
                        .buttonStyle(.plain)
                        ListRow(title: "Push server", value: Connection.apnsEnvironment == .development ? "Development (Xcode)" : "Production")
                    }

                    GroupedSection(footer: "To stop receiving Live Activities for good, also remove this iPhone in the console.") {
                        Button { confirmDisconnect = true } label: {
                            HStack {
                                Text("Disconnect this iPhone").font(QuaiFont.body).foregroundStyle(Palette.incident)
                                Spacer()
                            }
                            .padding(.horizontal, 14)
                            .frame(minHeight: 48)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .confirmationDialog("Disconnect from the server?", isPresented: $confirmDisconnect, titleVisibility: .visible) {
                Button("Disconnect", role: .destructive) {
                    dismiss()
                    connection.disconnect()
                }
            }
        }
        .presentationBackground(Palette.background)
    }
}
