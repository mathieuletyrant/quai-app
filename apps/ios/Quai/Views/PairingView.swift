import SwiftUI

struct PairingView: View {
    @Environment(Connection.self) private var connection
    @Binding var link: PairingLink?
    @State private var address = ""
    @State private var code = ""
    @State private var name = "iPhone"
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Connect to your Quai server").font(.title2.bold())
                        Text("In Quai's console, open **iPhones** and show a QR code. Scan it with the Camera app: it opens Quai and fills this in.")
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)
                }
                Section("Or type it") {
                    TextField("Server address", text: $address, prompt: Text(verbatim: "http://umbrel.local:3078"))
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    TextField("Code", text: $code, prompt: Text(verbatim: "ABCD2345"))
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .font(.body.monospaced())
                }
                Section("This iPhone") {
                    TextField("Name in the console", text: $name)
                }
                Section {
                    Button {
                        Task { await submit() }
                    } label: {
                        HStack {
                            Text("Connect")
                            if busy { Spacer(); ProgressView() }
                        }
                    }
                    .disabled(busy || code.isEmpty || address.isEmpty)
                } footer: {
                    if let error { Text(error).foregroundStyle(.red) }
                }
            }
            .navigationTitle("Quai")
        }
        .onChange(of: link, initial: true) { _, link in
            guard let link else { return }
            code = link.code
            address = link.serverURLs.first?.absoluteString ?? address
            Task { await submit(link) }
        }
    }

    private func submit(_ scanned: PairingLink? = nil) async {
        let typed = URL(string: address.trimmingCharacters(in: .whitespaces)).map { [$0] } ?? []
        let target = scanned ?? PairingLink(code: code.trimmingCharacters(in: .whitespaces), serverURLs: typed)
        busy = true
        defer { busy = false }
        do {
            try await connection.pair(target, name: name)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}
