import SwiftUI

/// Settings → Connection → Access headers: what the reverse proxy in front of Quai Cloud requires
/// (a Cloudflare Access service token, say). They come with the console's QR code; here they can
/// be typed by hand, for a proxy set up after pairing. Values are never shown again once saved.
struct AccessHeadersView: View {
    @Environment(Connection.self) private var connection
    @State private var name = ""
    @State private var value = ""
    @State private var problem: String?
    @State private var saving = false

    private var headers: [AccessHeader] { connection.accessHeaders }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if !headers.isEmpty {
                    GroupedSection(footer: "Sent on every request to Quai Cloud. The values stay in this iPhone's Keychain.") {
                        ForEach(headers, id: \.name) { header in
                            ListRow(title: header.name) {
                                HStack(spacing: 12) {
                                    Text(AccessHeader.masked)
                                    Button {
                                        save(headers.filter { $0.name != header.name })
                                    } label: {
                                        Image(systemName: "minus.circle.fill")
                                            .font(.system(size: 18))
                                            .foregroundStyle(Palette.alert)
                                    }
                                    .buttonStyle(.plain)
                                    .accessibilityLabel("Remove \(header.name)")
                                }
                            }
                        }
                    }
                }

                VStack(alignment: .leading, spacing: 12) {
                    SectionHeader(title: "Add a header")
                    FormField(label: "Name") {
                        TextField("Name", text: $name, prompt: Text(verbatim: "CF-Access-Client-Id"))
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    }
                    FormField(label: "Value") {
                        SecureField("Value", text: $value)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    }
                    Button("Add") { add() }
                        .buttonStyle(PillButtonStyle())
                        .disabled(saving || name.isEmpty || value.isEmpty)
                        .opacity(saving || name.isEmpty || value.isEmpty ? 0.5 : 1)
                    Text(problem ?? "Only if a proxy in front of Quai Cloud asks for them. Showing a new QR code in the console brings them too.")
                        .font(QuaiFont.caption)
                        .foregroundStyle(problem == nil ? Palette.secondaryText : Palette.alert)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(.horizontal, Metrics.gutter)
            .padding(.vertical, 8)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Palette.background.ignoresSafeArea())
        .navigationTitle("Access headers")
        .navigationBarTitleDisplayMode(.large)
        .toolbar(.visible, for: .navigationBar)
    }

    private func add() {
        let name = name.trimmingCharacters(in: .whitespaces)
        let value = value.trimmingCharacters(in: .whitespaces)
        if let problem = AccessHeader.problem(name: name, value: value, among: headers) {
            self.problem = problem
            return
        }
        problem = nil
        self.name = ""
        self.value = ""
        save(headers + [AccessHeader(name: name, value: value)])
    }

    private func save(_ next: [AccessHeader]) {
        saving = true
        Task {
            await connection.setAccessHeaders(next)
            saving = false
        }
    }
}
