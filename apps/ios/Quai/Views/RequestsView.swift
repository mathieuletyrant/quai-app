import SwiftUI

typealias MediaRequest = Components.Schemas.MediaRequest

extension MediaRequest {
    /// "Julie · Series · Seasons 1, 2 · 4K"
    var facts: String {
        var parts = [requester, kind == .movie ? "Movie" : "Series"]
        if let year { parts.append(String(year)) }
        if !seasons.isEmpty {
            parts.append((seasons.count == 1 ? "Season " : "Seasons ") + seasons.map(String.init).joined(separator: ", "))
        }
        if is4k { parts.append("4K") }
        return parts.joined(separator: " · ")
    }
}

/// A request's poster; a symbol on its square without one.
struct RequestPoster: View {
    let request: MediaRequest
    var width: CGFloat = 52

    var body: some View {
        PosterThumbnail(url: PosterSize.small.url(request.posterUrl), width: width, cornerRadius: width * 0.2) {
            SymbolSquare(systemImage: request.kind == .movie ? "film" : "tv", color: Palette.requests, size: width)
        }
        .frame(width: width, height: width * 1.5)
    }
}

/// Seerr's requests waiting for approval: Approve or Decline each one (Decline asks first).
struct RequestsView: View {
    @Environment(Connection.self) private var connection
    @Environment(\.dismiss) private var dismiss
    @State private var declining: MediaRequest?
    @State private var working: Int?
    @State private var failure: String?

    private var items: [MediaRequest] { connection.requests?.items ?? [] }

    private var summary: String? {
        guard let requests = connection.requests else { return nil }
        return requests.items.isEmpty ? "Nothing waits" : "\(requests.items.count) to approve"
    }

    var body: some View {
        Screen {
            HStack {
                GlassIconButton(systemImage: "chevron.left", label: "Back") { dismiss() }
                Spacer()
            }
            ScreenHeader(title: "Requests", subtitle: summary)
        } content: {
            if let error = connection.requestsError {
                MessageTile(title: "Can't load the requests", message: error, systemImage: "exclamationmark.triangle.fill", color: Palette.toFix)
            }
            if connection.requests?.status == .unavailable {
                MessageTile(title: "Seerr didn't answer", message: "Pull to try again.", systemImage: "exclamationmark.triangle.fill", color: Palette.toFix)
            }
            if connection.requests == nil && connection.requestsError == nil {
                ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
            } else if connection.requests?.status == .ok && items.isEmpty {
                MessageTile(
                    title: "All answered",
                    message: "No request waits for your approval.",
                    systemImage: "checkmark.seal.fill",
                    color: Palette.ok
                )
            }
            ForEach(items, id: \.id) { request in
                RequestCard(
                    request: request,
                    busy: working == request.id,
                    approve: { run(request) { try await connection.approve(request) } },
                    decline: { declining = request }
                )
            }
        }
        .refreshable { await connection.loadRequests() }
        .task { await connection.loadRequests() }
        .confirmationDialog(
            "Decline this request?",
            isPresented: Binding(get: { declining != nil }, set: { if !$0 { declining = nil } }),
            titleVisibility: .visible,
            presenting: declining
        ) { request in
            Button("Decline", role: .destructive) { run(request) { try await connection.decline(request) } }
            Button("Cancel", role: .cancel) {}
        } message: { request in
            Text("\(request.requester) asked for \(request.title). Seerr tells them it was declined.")
        }
        .alert("Couldn't do it", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(failure ?? "")
        }
    }

    private func run(_ request: MediaRequest, _ work: @escaping @MainActor () async throws -> Void) {
        working = request.id
        Task {
            do { try await work() } catch { failure = error.message(replacing: failure) }
            working = nil
        }
    }
}

private struct RequestCard: View {
    let request: MediaRequest
    let busy: Bool
    let approve: () -> Void
    let decline: () -> Void

    var body: some View {
        Card(spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                RequestPoster(request: request)
                VStack(alignment: .leading, spacing: 3) {
                    Text(request.title)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Palette.primaryText)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(request.facts)
                        .font(QuaiFont.caption)
                        .foregroundStyle(Palette.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                if busy { ProgressView() }
            }
            .accessibilityElement(children: .combine)
            HStack(spacing: 8) {
                Button("Approve", action: approve).buttonStyle(FixButtonStyle())
                Button("Decline", action: decline).buttonStyle(FixButtonStyle(prominent: false))
            }
            .disabled(busy)
        }
    }
}
