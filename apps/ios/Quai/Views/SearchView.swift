import SwiftUI

typealias SearchResult = Components.Schemas.SearchResult

extension Components.Schemas.SearchResult: Identifiable {}

extension Components.Schemas.SearchResult {
    /// "Movie · 2021"
    var caption: String { [kind == .movie ? "Movie" : "Series", year.map { String($0) }].compactMap { $0 }.joined(separator: " · ") }

    /// Only a title neither Radarr nor Sonarr has, with the TMDB id Seerr needs.
    var canBeRequested: Bool { state == .notAdded && tmdbId != nil }
}

/// The Library's way in to the search: looks like a search field, opens the Search screen.
struct SearchEntry: View {
    var body: some View {
        NavigationLink { SearchView() } label: {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                Text("Search movies and series")
                Spacer()
            }
            .font(QuaiFont.body)
            .foregroundStyle(Palette.tertiaryText)
            .padding(.horizontal, 14)
            .frame(height: 44)
            .background(Palette.raised, in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("searchEntry")
    }
}

/// Search: movies through Radarr, series through Sonarr, each with where it stands in the home,
/// and one tap to request a title on Seerr.
struct SearchView: View {
    @Environment(Connection.self) private var connection
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var results: Components.Schemas.SearchResults?
    @State private var searching = false
    @State private var error: String?
    /// Requested from here: shown at once, whatever the next search says.
    @State private var requested: Set<String> = []
    @State private var working: String?
    @State private var failures: [String: String] = [:]
    @FocusState private var fieldFocused: Bool

    private var trimmed: String { query.trimmingCharacters(in: .whitespaces) }

    var body: some View {
        Screen {
            HStack {
                GlassIconButton(systemImage: "chevron.left", label: "Back") { dismiss() }
                Spacer()
            }
            ScreenHeader(title: "Search", subtitle: "Movies from Radarr, series from Sonarr")
        } content: {
            SearchField(text: $query, focused: $fieldFocused)
            if let error {
                MessageTile(title: "Can't search", message: error, systemImage: "exclamationmark.triangle.fill", color: Palette.toFix)
            }
            if let unavailable = results?.unavailable, !unavailable.isEmpty {
                Text(unavailableNote(unavailable))
                    .font(QuaiFont.caption)
                    .foregroundStyle(Palette.secondaryText)
                    .padding(.horizontal, 4)
            }
            resultsList
        }
        .task { fieldFocused = true }
        // Typing waits a moment before asking: one search per pause, not one per letter.
        .task(id: trimmed) {
            guard !trimmed.isEmpty else {
                results = nil
                error = nil
                return
            }
            try? await Task.sleep(for: .milliseconds(350))
            guard !Task.isCancelled else { return }
            await search(trimmed)
        }
    }

    @ViewBuilder private var resultsList: some View {
        if trimmed.isEmpty {
            EmptyView()
        } else if results == nil && searching {
            ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
        } else if let results, results.items.isEmpty {
            MessageTile(title: "Nothing found", message: "Neither Radarr nor Sonarr knows “\(trimmed)”.", systemImage: "magnifyingglass", color: Palette.accent)
        } else if let results {
            VStack(spacing: 10) {
                ForEach(results.items) { result in
                    SearchRow(
                        result: result,
                        canRequest: results.canRequest,
                        requested: requested.contains(result.id),
                        working: working == result.id,
                        failure: failures[result.id]
                    ) {
                        Task { await request(result) }
                    }
                }
            }
            if !results.canRequest {
                Text("Set up Seerr in Quai Home to request a title from here.")
                    .font(QuaiFont.caption)
                    .foregroundStyle(Palette.secondaryText)
                    .padding(.horizontal, 4)
            }
        }
    }

    private func search(_ term: String) async {
        searching = true
        defer { searching = false }
        do {
            results = try await connection.search(term)
            error = nil
        } catch {
            self.error = error.quaiMessage
        }
    }

    private func request(_ result: SearchResult) async {
        working = result.id
        failures[result.id] = nil
        defer { working = nil }
        do {
            try await connection.request(result)
            requested.insert(result.id)
        } catch {
            failures[result.id] = error.quaiMessage
        }
    }

    private func unavailableNote(_ services: [Components.Schemas.LibraryService]) -> String {
        let names = services.map { $0 == .radarr ? "Radarr" : "Sonarr" }.joined(separator: " and ")
        return "\(names) didn't answer: \(services.count == 1 ? "its" : "their") titles are missing."
    }
}

/// The search field: a capsule like the system's, with a clear button.
private struct SearchField: View {
    @Binding var text: String
    var focused: FocusState<Bool>.Binding

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(Palette.tertiaryText)
            TextField("Movies and series", text: $text)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .focused(focused)
                .foregroundStyle(Palette.primaryText)
                .accessibilityIdentifier("searchField")
            if !text.isEmpty {
                Button { text = "" } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(Palette.tertiaryText)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear")
            }
        }
        .font(QuaiFont.body)
        .padding(.horizontal, 14)
        .frame(height: 44)
        .background(Palette.raised, in: Capsule())
    }
}

/// One title found: its poster, what it is, where it stands, and "Request on Seerr" when it can be requested.
private struct SearchRow: View {
    let result: SearchResult
    let canRequest: Bool
    let requested: Bool
    let working: Bool
    let failure: String?
    let add: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Poster(url: PosterSize.small.url(result.posterUrl), title: result.title, cornerRadius: 8)
                .frame(width: 58)
            VStack(alignment: .leading, spacing: 3) {
                Text(result.title)
                    .font(QuaiFont.bodyEmphasized)
                    .foregroundStyle(Palette.primaryText)
                    .lineLimit(2)
                Text(result.caption)
                    .font(QuaiFont.caption)
                    .foregroundStyle(Palette.secondaryText)
                if let state = stateLabel {
                    Text(state.text)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(state.color)
                        .padding(.top, 2)
                }
                if let failure {
                    Text(failure)
                        .font(QuaiFont.caption)
                        .foregroundStyle(Palette.toFix)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 8)
            trailing
        }
        .padding(10)
        .background(Palette.tile, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    /// Where the title stands; nothing for one not added yet, unless just requested.
    private var stateLabel: (text: String, color: Color)? {
        if requested { return ("Requested on Seerr", Palette.requests) }
        switch result.state {
        case .available: return ("In your library", Palette.ok)
        case .wanted: return ("Wanted", Palette.wantedText)
        case .notAdded: return nil
        }
    }

    @ViewBuilder private var trailing: some View {
        if working {
            ProgressView().frame(width: 64, height: 32)
        } else if requested {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Palette.requests)
                .frame(width: 64, height: 32)
                .accessibilityLabel("Requested")
        } else if canRequest && result.canBeRequested {
            Button(action: add) {
                Text("Request on Seerr")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Palette.onAccent)
                    .padding(.horizontal, 12)
                    .frame(height: 32)
                    .background(Palette.accent, in: Capsule())
                    .fixedSize()
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Request \(result.title) on Seerr")
            .accessibilityIdentifier("request-\(result.id)")
        }
    }
}
