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
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("PAIR THIS IPHONE")
                        .font(QuaiFont.eyebrow)
                        .foregroundStyle(Palette.accent)
                    Text("Connect the app to your Quai server")
                        .font(.system(size: 30, weight: .bold))
                        .tracking(-0.4)
                        .foregroundStyle(Palette.primaryText)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("In Quai's console, open **iPhones** and show a QR code. Scan it with the Camera app: it opens Quai and fills this in.")
                        .font(QuaiFont.subheadline)
                        .foregroundStyle(Palette.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }

                ScanHint()

                VStack(alignment: .leading, spacing: 12) {
                    FormField(label: "Or type the server address") {
                        TextField("Server address", text: $address, prompt: Text(verbatim: "http://umbrel.local:3078"))
                            .keyboardType(.URL)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    }
                    FormField(label: "Code") {
                        TextField("Code", text: $code, prompt: Text(verbatim: "ABCD2345"))
                            .textInputAutocapitalization(.characters)
                            .autocorrectionDisabled()
                            .font(.body.monospaced())
                    }
                    FormField(label: "This iPhone's name in the console") {
                        TextField("Name in the console", text: $name)
                    }
                }

                VStack(spacing: 10) {
                    Button {
                        Task { await submit() }
                    } label: {
                        HStack(spacing: 8) {
                            if busy { ProgressView().tint(Palette.onAccent) }
                            Text("Connect")
                        }
                    }
                    .buttonStyle(PillButtonStyle())
                    .disabled(busy || code.isEmpty || address.isEmpty)
                    .opacity(busy || code.isEmpty || address.isEmpty ? 0.5 : 1)

                    if let error {
                        Text(error)
                            .font(QuaiFont.caption)
                            .foregroundStyle(Palette.incident)
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: .infinity)
                    } else {
                        Text("Then allow Live Activities when iOS asks.")
                            .font(QuaiFont.caption)
                            .foregroundStyle(Palette.secondaryText)
                            .frame(maxWidth: .infinity)
                    }
                }
            }
            .padding(.horizontal, 24)
            .padding(.top, 48)
            .padding(.bottom, 32)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Palette.background.ignoresSafeArea())
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
            self.error = error.quaiMessage
        }
    }
}

/// The console's QR code, as a reminder: the Camera app reads it and opens Quai.
private struct ScanHint: View {
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 28, style: .continuous).fill(Color(hex: "#16161C"))
            Image(systemName: "qrcode.viewfinder")
                .font(.system(size: 72, weight: .regular))
                .foregroundStyle(Palette.accent)
        }
        .frame(height: 200)
        .accessibilityElement()
        .accessibilityLabel("Scan the console's QR code with the Camera app")
    }
}
