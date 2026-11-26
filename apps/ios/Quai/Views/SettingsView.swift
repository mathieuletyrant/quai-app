import SwiftUI

/// The Settings tab: this iPhone's Live Activities, notifications and requester, the connection, disconnecting.
struct SettingsView: View {
    @Environment(Connection.self) private var connection
    @Environment(\.openURL) private var openURL
    @State private var confirmDisconnect = false

    private var host: String { connection.serverURL?.host() ?? connection.serverURL?.absoluteString ?? "—" }

    /// "umbrel.local:3078", "quai.example.com".
    private static func address(_ url: URL) -> String {
        guard let host = url.host() else { return url.absoluteString }
        return url.port.map { "\(host):\($0)" } ?? host
    }

    private var statusColor: Color {
        switch connection.status {
        case .connecting: Palette.secondaryText
        case .connected: Palette.ok
        case .unreachable: Palette.toFix
        }
    }

    /// The header names, never their values: "CF-Access-Client-Id, CF-Access-Client-Secret".
    private var headerSummary: String {
        let names = connection.accessHeaders.map(\.name)
        return names.isEmpty ? "None" : names.joined(separator: ", ")
    }

    var body: some View {
        NavigationStack {
            Screen {
                TabHeader(eyebrow: "\(connection.status.label) · \(host)", title: "Settings")
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
                            Text(connection.status.label.lowercased())
                                .font(QuaiFont.subheadline)
                                .foregroundStyle(statusColor)
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
                        NavigationLink {
                            NotificationSettingsView()
                        } label: {
                            ListRow(title: "Notifications", systemImage: "bell.badge.fill", iconColor: Palette.alert, chevron: true)
                        }
                        .buttonStyle(.plain)
                        // Who requests in Seerr: nothing to choose without Seerr.
                        if connection.reaches(.seerr) {
                            NavigationLink {
                                RequesterSettingsView()
                            } label: {
                                ListRow(title: "Request as", systemImage: "person.crop.circle", iconColor: Palette.requests, chevron: true)
                            }
                            .buttonStyle(.plain)
                        }
                    }

                    if !connection.consoleURLs.isEmpty {
                        GroupedSection(footer: "Services, flows and iPhones are set up in Quai's console.") {
                            Button {
                                Task { if let console = await connection.consoleToOpen() { openURL(console) } }
                            } label: {
                                ListRow(title: "Open the console", systemImage: "macwindow", iconColor: Palette.accent, chevron: true)
                            }
                            .buttonStyle(.plain)
                        }
                    }

                    GroupedSection(header: "Connection", footer: "The app tries every address at once and uses the first that answers.") {
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
                                Text("Disconnect this iPhone").font(QuaiFont.body).foregroundStyle(Palette.alert)
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
                Button("Disconnect", role: .destructive) { connection.disconnect() }
            }
            // Which services Quai Home reaches decides the settings worth offering.
            .task { await connection.loadAlerts() }
        }
    }
}
